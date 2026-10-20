/**
 * A request with no sign-in token is told to sign in, not that its token is
 * bad (V3f, Oct 20, 2026: both answered "Invalid or expired token").
 */
import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import jwt from '@fastify/jwt'

vi.mock('../db/postgres', () => ({ db: vi.fn() }))
vi.mock('../lib/api-keys', () => ({ hashKey: vi.fn() }))

import { authenticate } from '../middleware/auth'

async function app() {
  const a = Fastify({ logger: false })
  await a.register(jwt, { secret: 'test-secret' })
  a.get('/private', { preHandler: [authenticate] }, async () => ({ ok: true }))
  return a
}

describe('authenticate', () => {
  it('asks a request without a token to sign in', async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/private' })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toMatchObject({ success: false, code: 'UNAUTHORIZED', error: expect.stringMatching(/^Sign-in required/) })
  })

  it('still says a token it was sent is invalid', async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/private', headers: { authorization: 'Bearer not-a-token' } })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('Invalid or expired token')
  })
})
