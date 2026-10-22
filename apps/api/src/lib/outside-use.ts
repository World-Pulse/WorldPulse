/**
 * Use from outside (Oct 22, 2026): the API and the MCP server used by anyone
 * but WorldPulse's own website, the number to watch since Devon OK'd the
 * direction on Oct 21 ("Let's get after it"): WorldPulse as the counted,
 * sourced layer other tools and AI assistants build on. Nothing counted it.
 *
 * Counted, a UTC day at a time, in Redis:
 *   use:outside:<YYYY-MM-DD>  "<METHOD> <route>" → calls, and "total",
 *                             "with_key" (an API key was sent), "ai" (an AI
 *                             agent: GPTBot, ClaudeBot, ChatGPT-User...),
 *                             "bot" (other crawlers), "client" (the rest:
 *                             scripts, apps, other websites' pages) and
 *                             "own" (WorldPulse's own checks, not in total)
 *   use:mcp:<YYYY-MM-DD>      tool → calls, and "total" (MCP tools/call)
 * kept 45 days. Counts only: no addresses, keys or user agents.
 *
 * Not counted: the website's own server (lib/site-calls.ts) and readers'
 * browsers on world-pulse.io pages (their Origin or Referer), the calls an
 * MCP tool makes to the API for its client (counted as the tool), account,
 * payment, sign-in, admin, health and status routes, preflights, addresses no
 * route answers, and server errors. WorldPulse's own checks (the autopilot's,
 * Claude's) say who they are in their user agent (WorldPulse-Autopilot): they
 * are counted apart, as "own", and left out of the total, so checking the
 * number never moves it. (A client calling itself that only lowers the
 * count, never raises it.)
 */
import type Redis from 'ioredis'
import { isInternalCall } from './internal-call'
import { isSiteCall } from './site-calls'

export const OUTSIDE_USE_KEEP_S = 45 * 86_400

const day = (now: Date) => now.toISOString().slice(0, 10)
export const outsideUseKey = (now = new Date()) => `use:outside:${day(now)}`
export const mcpUseKey = (now = new Date()) => `use:mcp:${day(now)}`

/** WorldPulse's own pages: a reader's browser calls the API from these */
const OWN_SITES = new Set(['world-pulse.io', 'www.world-pulse.io'])
/** Routes that aren't use of the data: health and status, accounts, payment, sign-in, admin, the site's own page counts */
const NOT_USE = [
  '/api/v1/health', '/api/v1/status', '/api/v1/auth', '/api/v1/admin', '/api/v1/analytics', '/api/v1/billing',
  '/api/v1/developer', '/api/v1/me', '/api/v1/users', '/api/v1/notifications', '/api/v1/alerts', '/api/v1/uploads', '/api/v1/pro',
]

/** WorldPulse's own checks name themselves so (scripts, the autopilot, Claude's checks) */
const OWN_CHECKS = /WorldPulse-Autopilot/i
/** One of WorldPulse's own checks, by its user agent */
export function isOwnCheck(userAgent: unknown): boolean {
  return typeof userAgent === 'string' && OWN_CHECKS.test(userAgent)
}

const hostOf = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null
  try { return new URL(v).hostname.toLowerCase() } catch { return null }
}

/** A reader's browser on a world-pulse.io page */
export function fromOwnPages(headers: Record<string, unknown>): boolean {
  const origin = hostOf(headers.origin) ?? hostOf(headers.referer)
  return origin !== null && OWN_SITES.has(origin)
}

const AI_AGENTS = /GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai|PerplexityBot|Perplexity-User|Google-Extended|Applebot-Extended|Bytespider|CCBot|meta-externalagent|Amazonbot|cohere-ai|DuckAssistBot|MistralAI-User/i
const BOTS = /bot\b|crawler|spider|slurp|bingpreview|facebookexternalhit|feedfetcher|headlesschrome/i

/** Who is asking, by its user agent: an AI agent, another crawler, or a client (scripts, apps, browsers elsewhere) */
export function askerKind(userAgent: unknown): 'ai' | 'bot' | 'client' {
  const ua = typeof userAgent === 'string' ? userAgent : ''
  if (AI_AGENTS.test(ua)) return 'ai'
  if (BOTS.test(ua)) return 'bot'
  return 'client'
}

export interface UseRequest {
  method: string
  ip?: string
  headers: Record<string, unknown>
  routeOptions?: { url?: string }
}

/** Whether a request answered with this status is use from outside */
export function isOutsideUse(req: UseRequest, statusCode: number): boolean {
  const route = req.routeOptions?.url
  if (!route || statusCode >= 500 || req.method === 'OPTIONS' || req.method === 'HEAD') return false
  if (!(route.startsWith('/api/v1/') || route === '/mcp' || route.startsWith('/mcp/'))) return false
  if (NOT_USE.some(p => route === p || route.startsWith(`${p}/`))) return false
  if (isInternalCall(req.headers) || isSiteCall(req) || fromOwnPages(req.headers)) return false
  return true
}

const KEY_SHAPED = /^wp_live_[0-9a-f]{32}$/
/** An API key was sent, in X-Api-Key or as a bearer token (lib/api-plan.ts reads the same two) */
export function sentApiKey(headers: Record<string, unknown>): boolean {
  const x = typeof headers['x-api-key'] === 'string' ? headers['x-api-key'].trim() : ''
  if (KEY_SHAPED.test(x)) return true
  const auth = typeof headers.authorization === 'string' ? headers.authorization.trim() : ''
  return /^bearer\s+/i.test(auth) && KEY_SHAPED.test(auth.replace(/^bearer\s+/i, ''))
}

/** Count one call from outside (true when counted in the total); never fails the request (a Redis error is ignored) */
export async function countOutsideUse(redis: Pick<Redis, 'multi'>, req: UseRequest, statusCode: number, now = new Date()): Promise<boolean> {
  if (!isOutsideUse(req, statusCode)) return false
  try {
    const key = outsideUseKey(now)
    if (isOwnCheck(req.headers['user-agent'])) {
      await redis.multi().hincrby(key, 'own', 1).expire(key, OUTSIDE_USE_KEEP_S).exec()
      return false
    }
    const m = redis.multi()
      .hincrby(key, `${req.method} ${req.routeOptions!.url}`, 1)
      .hincrby(key, 'total', 1)
      .hincrby(key, askerKind(req.headers['user-agent']), 1)
    if (sentApiKey(req.headers)) m.hincrby(key, 'with_key', 1)
    await m.expire(key, OUTSIDE_USE_KEEP_S).exec()
    return true
  } catch {
    return false
  }
}

/** Count one MCP tool call (routes/mcp.ts); never fails the call */
export async function countMcpTool(redis: Pick<Redis, 'multi'>, tool: string, now = new Date()): Promise<void> {
  try {
    const key = mcpUseKey(now)
    await redis.multi()
      .hincrby(key, /^[a-z_]{1,40}$/.test(tool) ? tool : '(other)', 1)
      .hincrby(key, 'total', 1)
      .expire(key, OUTSIDE_USE_KEEP_S)
      .exec()
  } catch { /* the call was answered */ }
}

export interface UseDay {
  day: string
  total: number
  withKey: number
  ai: number
  bots: number
  clients: number
  /** WorldPulse's own checks, left out of the total */
  own: number
  /** The routes called most, "<METHOD> <route>" → calls (10 at most) */
  routes: Record<string, number>
  mcp: { total: number; tools: Record<string, number> }
}

const num = (v: unknown) => Math.max(0, Math.round(Number(v) || 0))

/** One day's counts from its two hashes */
export function useDay(dayName: string, outside: Record<string, string> | null, mcp: Record<string, string> | null): UseDay {
  const o = outside ?? {}
  const routes = Object.entries(o)
    .filter(([field]) => / \//.test(field))
    .map(([field, n]) => [field, num(n)] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
  const m = mcp ?? {}
  const tools = Object.fromEntries(Object.entries(m).filter(([f]) => f !== 'total').map(([f, n]) => [f, num(n)]).sort((a, b) => Number(b[1]) - Number(a[1])))
  return {
    day: dayName,
    total: num(o.total),
    withKey: num(o.with_key),
    ai: num(o.ai),
    bots: num(o.bot),
    clients: num(o.client),
    own: num(o.own),
    routes: Object.fromEntries(routes),
    mcp: { total: num(m.total), tools },
  }
}

/** The last `days` days (today first) */
export async function outsideUse(redis: Pick<Redis, 'hgetall'>, days = 14, now = new Date()): Promise<UseDay[]> {
  const out: UseDay[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() - i * 86_400_000)
    const [outside, mcp] = await Promise.all([
      redis.hgetall(outsideUseKey(d)).catch(() => null),
      redis.hgetall(mcpUseKey(d)).catch(() => null),
    ])
    out.push(useDay(day(d), outside, mcp))
  }
  return out
}
