/**
 * Follow a story (plan 8; Devon, Oct 21, 2026: "Yes, add it"): the routes
 * under /api/v1/stories, signed in only, keyed by the story a story id or
 * signal id belongs to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyRequest } from 'fastify'

const h = vi.hoisted(() => ({
  ready: true,
  user: { id: 'u1', accountType: 'user' } as { id: string; accountType: string } | null,
  follows: new Map<string, { lastSeenAt: string }>(),
  full: false,
}))

vi.mock('../middleware/auth', () => ({
  authenticate: async (req: FastifyRequest, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (!h.user) return reply.status(401).send({ success: false, code: 'UNAUTHORIZED' })
    ;(req as unknown as { user: typeof h.user }).user = h.user
  },
}))

const STORY = '00000000-0000-0000-0000-0000000000a1'
const MEMBER = '00000000-0000-0000-0000-0000000000a2'

vi.mock('../lib/story-follows', () => ({
  MAX_FOLLOWS: 200,
  followsReady: () => h.ready,
  storyKeyOf: async (id: string) => (id === STORY || id === MEMBER ? STORY : null),
  followState: async (userId: string, key: string) => {
    const f = h.follows.get(`${userId}:${key}`)
    return f
      ? { following: true, followedAt: '2026-10-21T10:00:00.000Z', lastSeenAt: f.lastSeenAt, since: { reports: 2, outlets: 1 }, latestReportAt: '2026-10-21T14:00:00.000Z' }
      : { following: false, followedAt: null, lastSeenAt: null, since: null, latestReportAt: null }
  },
  followStory: async (userId: string, key: string) => {
    if (h.full) return false
    h.follows.set(`${userId}:${key}`, { lastSeenAt: '2026-10-21T10:00:00.000Z' })
    return true
  },
  unfollowStory: async (userId: string, key: string) => { h.follows.delete(`${userId}:${key}`) },
  markStorySeen: async (userId: string, key: string) => {
    const f = h.follows.get(`${userId}:${key}`)
    if (f) f.lastSeenAt = '2026-10-21T15:00:00.000Z'
  },
  followedStories: async () => [{ storyId: STORY, title: 'Quake: aftershock', leadId: MEMBER, reports: 3, latestReportAt: null, lastSeenAt: null, newReports: 2 }],
}))

import { registerStoryFollowRoutes } from '../routes/story-follows'

async function app() {
  const a = Fastify()
  await a.register(registerStoryFollowRoutes, { prefix: '/api/v1/stories' })
  return a
}

beforeEach(() => {
  h.ready = true
  h.user = { id: 'u1', accountType: 'user' }
  h.follows.clear()
  h.full = false
})

describe('follow a story', () => {
  it('follows by any of its reports, and says what changed since the last visit', async () => {
    const a = await app()
    const put = await a.inject({ method: 'PUT', url: `/api/v1/stories/${MEMBER}/follow` })
    expect(put.statusCode).toBe(200)
    expect(put.json().data).toMatchObject({ storyId: STORY, following: true, since: { reports: 2, outlets: 1 } })
    const got = await a.inject({ method: 'GET', url: `/api/v1/stories/${STORY}/follow` })
    expect(got.json().data.following).toBe(true)
    await a.inject({ method: 'POST', url: `/api/v1/stories/${STORY}/follow/seen` })
    expect(h.follows.get(`u1:${STORY}`)?.lastSeenAt).toBe('2026-10-21T15:00:00.000Z')
    const del = await a.inject({ method: 'DELETE', url: `/api/v1/stories/${STORY}/follow` })
    expect(del.json().data).toEqual({ storyId: STORY, following: false })
    expect((await a.inject({ method: 'GET', url: `/api/v1/stories/${STORY}/follow` })).json().data.following).toBe(false)
  })

  it('lists the stories a reader follows', async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/stories/following' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.stories[0]).toMatchObject({ storyId: STORY, newReports: 2 })
  })

  it('needs a sign-in, a real id and a story', async () => {
    const a = await app()
    expect((await a.inject({ method: 'GET', url: '/api/v1/stories/not-an-id/follow' })).statusCode).toBe(400)
    expect((await a.inject({ method: 'PUT', url: '/api/v1/stories/00000000-0000-0000-0000-00000000ffff/follow' })).statusCode).toBe(404)
    h.user = null
    expect((await a.inject({ method: 'PUT', url: `/api/v1/stories/${STORY}/follow` })).statusCode).toBe(401)
  })

  it('says "starting up" before its table exists, and stops at 200 stories', async () => {
    const a = await app()
    h.ready = false
    expect((await a.inject({ method: 'PUT', url: `/api/v1/stories/${STORY}/follow` })).statusCode).toBe(503)
    expect((await a.inject({ method: 'GET', url: '/api/v1/stories/following' })).statusCode).toBe(503)
    h.ready = true
    h.full = true
    const res = await a.inject({ method: 'PUT', url: `/api/v1/stories/${STORY}/follow` })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/200 stories/)
  })
})
