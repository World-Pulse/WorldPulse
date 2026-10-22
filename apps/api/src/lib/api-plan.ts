/**
 * Pro API keys (plan V3d; Devon, Oct 21, 2026, 8:10 PM: "A Pro key gets its
 * own budget: 600 a minute and 50,000 a day; free stays as today").
 *
 * A request that sends a key (X-Api-Key, or Authorization: Bearer wp_live_…)
 * whose account is on Pro counts in that key's own budget, not in the
 * address's it shares with everyone else there:
 * - 600 requests a minute across the API (the free budget is 200 a minute
 *   per user or address: lib/rate-limit-options.ts);
 * - a read endpoint (GET) with a lower limit of its own (most allow 30–60 a
 *   minute) allows a Pro key ten times that, up to 600; endpoints that change
 *   things (sign-in, sign-up, forms) keep their limits;
 * - 50,000 requests a day, counted per key in Redis (apikey:day:<id>:<UTC
 *   day>), past which the key gets 429 until midnight UTC.
 * A free key, a key that isn't valid and no key at all count as before. An
 * enterprise key (issued by the team) keeps its stored limits, at least
 * Pro's.
 *
 * The account's plan decides, at most a minute after it changes (lookups are
 * kept 60 seconds): a Pro account's keys are Pro, also one made before it
 * upgraded, and none is once the subscription ends (lib/key-tier.ts).
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'
import type Redis from 'ioredis'
import { db } from '../db/postgres'
import { hashKey } from './api-keys'
import { maxKeyTier, asKeyTier, type KeyTier } from './key-tier'

export interface ApiPlan {
  keyId: string
  tier: 'pro' | 'enterprise'
  perMinute: number
  perDay: number
}

declare module 'fastify' {
  interface FastifyRequest {
    /** The sent key's Pro budget, or null (no key, a free key, an unknown key) */
    apiPlan: ApiPlan | null
  }
}

export const PRO_KEY_LIMITS = { perMinute: 600, perDay: 50_000 } as const
/** A Pro key's limit on a read endpoint with its own lower limit: this many times it, up to its per-minute budget */
export const ROUTE_MULTIPLIER = 10
/** How long a key's plan is kept before it is looked up again */
const KEEP_MS = 60_000
const MAX_KEPT = 5_000

const WELL_FORMED_KEY = /^wp_live_[0-9a-f]{32}$/

/** The API key a request sends, or null */
export function sentKey(headers: Record<string, unknown>): string | null {
  const x = headers['x-api-key']
  if (typeof x === 'string' && x.trim() !== '') return x.trim()
  const auth = headers['authorization']
  if (typeof auth === 'string' && auth.startsWith('Bearer wp_live_')) return auth.slice('Bearer '.length).trim()
  return null
}

/** The tier a key counts as: its account's plan decides; an enterprise key needs an admin account */
export function effectiveTier(stored: KeyTier, account: KeyTier): KeyTier {
  if (account === 'free') return 'free'
  if (account === 'pro') return 'pro'
  return stored === 'enterprise' ? 'enterprise' : 'pro'
}

/** The budget of a key that counts as `tier`, or null for a free one */
export function keyLimits(tier: KeyTier, stored: { perMinute?: number | null; perDay?: number | null } = {}): { perMinute: number; perDay: number } | null {
  if (tier === 'free') return null
  if (tier === 'pro') return { ...PRO_KEY_LIMITS }
  return {
    perMinute: Math.max(Number(stored.perMinute) || 0, PRO_KEY_LIMITS.perMinute),
    perDay: Math.max(Number(stored.perDay) || 0, PRO_KEY_LIMITS.perDay),
  }
}

const kept = new Map<string, { at: number; plan: ApiPlan | null }>()

/** Forget every kept lookup (tests) */
export function forgetApiPlans(): void {
  kept.clear()
}

/** The Pro budget of the key a request sends, or null; looked up at most once a minute per key */
export async function resolveApiPlan(headers: Record<string, unknown>, now = Date.now()): Promise<ApiPlan | null> {
  const raw = sentKey(headers)
  // A made-up key is no reason to ask the database: every key we issue is wp_live_ and 32 hex characters
  if (!raw || !WELL_FORMED_KEY.test(raw)) return null
  const hash = hashKey(raw)
  const hit = kept.get(hash)
  if (hit && now - hit.at < KEEP_MS) return hit.plan

  const row = await db('api_keys')
    .where({ key_hash: hash, is_active: true })
    .first(['id', 'user_id', 'tier', 'rate_limit_per_min', 'rate_limit_per_day']) as
    { id: string; user_id: string; tier: string; rate_limit_per_min: number | null; rate_limit_per_day: number | null } | undefined

  let plan: ApiPlan | null = null
  if (row) {
    const tier = effectiveTier(asKeyTier(row.tier), await maxKeyTier(row.user_id))
    const limits = keyLimits(tier, { perMinute: row.rate_limit_per_min, perDay: row.rate_limit_per_day })
    if (limits && tier !== 'free') plan = { keyId: String(row.id), tier, ...limits }
  }
  if (kept.size >= MAX_KEPT) kept.delete(kept.keys().next().value as string)
  kept.set(hash, { at: now, plan })
  return plan
}

/** The Redis key counting a key's requests on one UTC day */
export function dayKey(keyId: string, now = new Date()): string {
  return `apikey:day:${keyId}:${now.toISOString().slice(0, 10)}`
}

/** Seconds to the next midnight UTC, when a day's budget starts again */
export function secondsToMidnightUtc(now = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000))
}

/** A Pro key's limit on an endpoint whose own limit is `max` (a read endpoint) */
export function routeMaxFor(plan: ApiPlan | null, max: number): number {
  return plan ? Math.max(max, Math.min(plan.perMinute, max * ROUTE_MULTIPLIER)) : max
}

/**
 * Wire Pro keys into the API. Call before registering @fastify/rate-limit:
 * its route hook reads req.apiPlan (set here, on each request, first), and
 * the read endpoints' own limits become functions of it before the plugin
 * reads them (onRoute hooks run in the order they were added).
 */
export function registerApiPlans(app: FastifyInstance, redis: Redis): void {
  app.decorateRequest('apiPlan', null)

  app.addHook('onRoute', (route) => {
    const config = route.config as { rateLimit?: unknown } | undefined
    const rl = config?.rateLimit as { max?: unknown } | false | undefined
    if (!rl || typeof rl !== 'object' || typeof rl.max !== 'number') return
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    if (!methods.every(m => m === 'GET' || m === 'HEAD')) return
    const max = rl.max
    // Copies, not the objects themselves: one config can be shared by a route's GET and its PUT
    route.config = { ...config, rateLimit: { ...rl, max: (req: FastifyRequest) => routeMaxFor(req.apiPlan, max) } } as typeof route.config
  })

  app.addHook('onRequest', async (req, reply) => {
    let plan: ApiPlan | null = null
    try {
      plan = await resolveApiPlan(req.headers as Record<string, unknown>)
    } catch (err) {
      req.log.warn({ err }, 'api plan: key lookup failed; counted as no key')
    }
    req.apiPlan = plan
    if (!plan) return
    try {
      const k = dayKey(plan.keyId)
      const used = await redis.incr(k)
      if (used === 1) await redis.expire(k, 2 * 86_400)
      if (used > plan.perDay) {
        reply.header('Retry-After', String(secondsToMidnightUtc()))
        return reply.code(429).send({
          success: false,
          statusCode: 429,
          code: 'RATE_LIMITED',
          error: `This key's ${plan.perDay.toLocaleString('en-US')} requests for today are used up. They start again at midnight UTC.`,
        })
      }
    } catch {
      // Redis can't count: serve the request, as the per-minute limit does (skipOnError)
    }
  })
}
