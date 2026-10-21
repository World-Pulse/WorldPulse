/**
 * The API-wide rate limit must not take the API down with Redis (Oct 12,
 * 2026: with the disk full, Redis refused writes and every request, /health
 * included, answered 500).
 */
import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import type Redis from 'ioredis'
import { rateLimitOptions } from '../lib/rate-limit-options'
import { errorReply } from '../lib/error-reply'

// A Redis that refuses every write the way a full disk makes it
function refusingRedis(): Redis {
  const r: Record<string, unknown> = {
    defineCommand(name: string) {
      r[name] = (...args: unknown[]) => {
        const cb = args[args.length - 1] as (err: Error | null, res?: unknown) => void
        cb(new Error("MISCONF Redis is configured to save RDB snapshots, but it's currently unable to persist to disk"))
      }
    },
  }
  return r as unknown as Redis
}

// A Redis that counts in memory, to check the limit itself still works
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

async function appWith(options: ReturnType<typeof rateLimitOptions>) {
  const app = Fastify()
  // The API's own error handler (index.ts)
  app.setErrorHandler((err, _req, reply) => {
    const { status, body } = errorReply(err as Parameters<typeof errorReply>[0])
    return reply.status(status).send(body)
  })
  await app.register(rateLimit, options)
  app.get('/health', async () => ({ status: 'ok' }))
  app.get('/limited', { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } }, async () => ({ ok: true }))
  await app.ready()
  return app
}

describe('rate limit when Redis refuses writes', () => {
  it('still answers requests', async () => {
    const app = await appWith(rateLimitOptions(refusingRedis()))
    expect((await app.inject({ method: 'GET', url: '/health', remoteAddress: '203.0.113.5' })).statusCode).toBe(200)
    // routes with their own limit inherit it
    expect((await app.inject({ method: 'GET', url: '/limited', remoteAddress: '203.0.113.5' })).statusCode).toBe(200)
  })

  it('would fail every request without skipOnError (what happened on Oct 12)', async () => {
    const app = await appWith({ ...rateLimitOptions(refusingRedis()), skipOnError: false })
    expect((await app.inject({ method: 'GET', url: '/health', remoteAddress: '203.0.113.5' })).statusCode).toBe(500)
  })

  it('still limits when Redis works, with a 429 (it used to answer 500)', async () => {
    const app = await appWith(rateLimitOptions(countingRedis()))
    const res = []
    // a client from outside (the server's own addresses aren't limited: lib/site-calls.ts)
    for (let i = 0; i < 3; i++) res.push(await app.inject({ method: 'GET', url: '/limited', remoteAddress: '203.0.113.5' }))
    expect(res.map(r => r.statusCode)).toEqual([200, 200, 429])
    expect(JSON.parse(res[2].body)).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED', message: 'Too many requests. Slow down.' })
    expect(res[2].headers['retry-after']).toBeDefined()
  })
})
