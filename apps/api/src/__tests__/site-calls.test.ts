/**
 * The website's own server is never counted by the API's rate limits (plan
 * D3, Oct 21, 2026): it calls over the server's private network, while every
 * client from outside arrives through nginx with its own public address,
 * which it can't disguise. MCP calls still count as their client. Each 429 is
 * counted by route for /ops-status.json.
 */
import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import type Redis from 'ioredis'
import { isPrivateAddress, isSiteCall } from '../lib/site-calls'
import { rateLimitOptions } from '../lib/rate-limit-options'
import { TRUSTED_PROXIES } from '../lib/client-address'
import { internalCallHeaders } from '../lib/internal-call'
import { countRefusal, refusalField, refusalsKey, REFUSALS_KEEP_S } from '../lib/refusals'
import { errorReply } from '../lib/error-reply'

describe('the server\'s own addresses', () => {
  it('private, loopback and link-local, IPv4 and IPv6', () => {
    for (const ip of ['10.0.0.5', '172.18.0.4', '172.31.255.1', '192.168.1.1', '127.0.0.1', '169.254.1.1', '::1',
      '::ffff:172.18.0.4', 'fd12:3456::1', 'fc00::1', 'fe80::1', 'FE80::abcd']) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
  })
  it('anything else is a client from outside', () => {
    for (const ip of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '203.0.113.9', '::ffff:8.8.8.8', '2001:db8::1', 'fc::1',
      'fe7f::1', '300.1.1.1', '', undefined, null]) {
      expect(isPrivateAddress(ip as string), String(ip)).toBe(false)
    }
  })
  it('an MCP call from inside counts as its client', () => {
    expect(isSiteCall({ ip: '127.0.0.1', headers: {} })).toBe(true)
    expect(isSiteCall({ ip: '127.0.0.1', headers: internalCallHeaders('ip:203.0.113.9') })).toBe(false)
  })
})

// A Redis that counts in memory (as rate-limit-options.test.ts)
function countingRedis(): Redis {
  const counts = new Map<string, number>()
  const r: Record<string, unknown> = {
    defineCommand(name: string) {
      r[name] = (key: string, timeWindow: number, ...rest: unknown[]) => {
        const cb = rest[rest.length - 1] as (err: Error | null, res?: unknown) => void
        const n = (counts.get(key) ?? 0) + 1
        counts.set(key, n)
        cb(null, [n, timeWindow])
      }
    },
  }
  return r as unknown as Redis
}

describe('the API\'s limits, as the API trusts nginx', () => {
  async function app() {
    const a = Fastify({ trustProxy: TRUSTED_PROXIES })
    a.setErrorHandler((err, _req, reply) => {
      const { status, body } = errorReply(err as Parameters<typeof errorReply>[0])
      return reply.status(status).send(body)
    })
    await a.register(rateLimit, { ...rateLimitOptions(countingRedis()), max: 3 })
    a.get('/signals/:id', { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } }, async () => ({ ok: true }))
    await a.ready()
    return a
  }
  const NGINX = '172.18.0.2'
  const SITE = '172.18.0.7'
  const statuses = async (a: Awaited<ReturnType<typeof app>>, n: number, opts: { remoteAddress: string; headers?: Record<string, string> }) => {
    const out: number[] = []
    for (let i = 0; i < n; i++) out.push((await a.inject({ method: 'GET', url: `/signals/s${i}`, ...opts })).statusCode)
    return out
  }

  it('the website\'s server is never turned away, even on a route with its own limit', async () => {
    const a = await app()
    expect(await statuses(a, 6, { remoteAddress: SITE })).toEqual([200, 200, 200, 200, 200, 200])
  })

  it('a reader through nginx is counted by their own address, and turned away past the limit', async () => {
    const a = await app()
    expect(await statuses(a, 3, { remoteAddress: NGINX, headers: { 'x-forwarded-for': '203.0.113.9' } })).toEqual([200, 200, 429])
    // another reader has their own budget
    expect(await statuses(a, 1, { remoteAddress: NGINX, headers: { 'x-forwarded-for': '198.51.100.4' } })).toEqual([200])
  })

  it('a client can\'t pass for the server by writing a private address in its header', async () => {
    const a = await app()
    // nginx adds the address it saw after whatever the client wrote
    expect(await statuses(a, 3, { remoteAddress: NGINX, headers: { 'x-forwarded-for': '10.0.0.9, 203.0.113.10' } })).toEqual([200, 200, 429])
  })

  it('a client connecting straight from outside is counted (the API\'s port isn\'t published, but if it were)', async () => {
    const a = await app()
    expect(await statuses(a, 3, { remoteAddress: '203.0.113.11', headers: { 'x-forwarded-for': '10.0.0.9' } })).toEqual([200, 200, 429])
  })
})

describe('refusals counted', () => {
  it('by route pattern, a day at a time, kept 3 days; a Redis error is ignored', async () => {
    const calls: unknown[][] = []
    const chain = {
      hincrby: (...a: unknown[]) => { calls.push(['hincrby', ...a]); return chain },
      expire: (...a: unknown[]) => { calls.push(['expire', ...a]); return chain },
      exec: async () => [],
    }
    const redis = { multi: () => chain } as unknown as Pick<Redis, 'multi'>
    const now = new Date('2026-10-21T19:30:00Z')
    await countRefusal(redis, 'GET', '/api/v1/signals/:id', now)
    expect(refusalsKey(now)).toBe('api:429:2026-10-21')
    expect(calls).toEqual([
      ['hincrby', 'api:429:2026-10-21', 'GET /api/v1/signals/:id', 1],
      ['hincrby', 'api:429:2026-10-21', 'total', 1],
      ['expire', 'api:429:2026-10-21', REFUSALS_KEEP_S],
    ])
    expect(refusalField('POST', undefined)).toBe('POST (no route)')
    const broken = { multi: () => { throw new Error('Redis down') } } as unknown as Pick<Redis, 'multi'>
    await expect(countRefusal(broken, 'GET', '/x')).resolves.toBeUndefined()
  })
})
