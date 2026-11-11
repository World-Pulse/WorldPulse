/**
 * GET /api/v1/stories/:id/fact-checks (Nov 11, 2026): the fact-checkers' checks of claims about a story,
 * found by the story's average fingerprint and its reports' headlines (lib/fact-checks.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const h = vi.hoisted(() => ({
  sqls: [] as string[],
  bindings: [] as unknown[][],
  titles: [] as string[],
  centroid: null as string | null,
  snapshot: null as string | null,
}))

vi.mock('../../db/redis', () => ({
  redis: {
    get: vi.fn(async (key: string) => (key === 'factchecks:items' ? h.snapshot : null)),
    set: vi.fn(async () => 'OK'),
    setex: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
  },
}))
vi.mock('../../middleware/auth', () => ({
  authenticate: (_req: unknown, _rep: unknown, done: () => void) => done(),
  optionalAuth: (_req: unknown, _rep: unknown, done: () => void) => done(),
}))
vi.mock('../../db/postgres', () => ({
  db: Object.assign(
    vi.fn(() => ({ where: () => ({ first: async () => ({ story_id: '11111111-1111-4111-8111-111111111111' }) }) })),
    {
      schema: { hasColumn: vi.fn(async () => true) },
      raw: vi.fn(async (sql: string, bindings: unknown[]) => {
        h.sqls.push(sql)
        h.bindings.push(bindings)
        if (/avg\(f\.vec\)/.test(sql)) return { rows: [{ centroid: h.centroid }] }
        return { rows: [{ titles: h.titles, latest_at: '2026-11-04T09:00:00Z', first_at: '2026-11-01T15:00:00Z' }] }
      }),
    },
  ),
}))

import { registerStoryRoutes } from '../stories'
import { resetFactChecks } from '../../lib/fact-checks'
import { FINGERPRINT_DIMS, FINGERPRINT_MODEL } from '../../lib/fingerprint'

const STORY = '11111111-1111-4111-8111-111111111111'
const SIGNAL = '22222222-2222-4222-8222-222222222222'

function toward(cos: number): Float32Array {
  const v = new Float32Array(FINGERPRINT_DIMS)
  v[0] = cos
  v[1] = Math.sqrt(1 - cos * cos)
  return v
}
const b64 = (v: Float32Array) => Buffer.from(v.buffer).toString('base64')

async function get(id: string) {
  const app = Fastify({ logger: false })
  await app.register(registerStoryRoutes, { prefix: '/api/v1/stories' })
  return app.inject({ method: 'GET', url: `/api/v1/stories/${id}/fact-checks` })
}

describe('GET /api/v1/stories/:id/fact-checks', () => {
  beforeEach(() => {
    resetFactChecks()
    h.sqls = []
    h.bindings = []
    h.titles = [
      'Florida jet crash: plane parts found far from the crash site',
      'Nine killed as private plane crashes near Palm Beach, Florida',
      'Palm Beach plane crash: what we know',
    ]
    h.centroid = `[${Array.from(toward(1), x => x.toFixed(6)).join(',')}]`
    h.snapshot = JSON.stringify({
      updated_at: '2026-11-11T15:00:00Z',
      checkers: [{ id: 'full-fact', name: 'Full Fact', ok: true, read_at: '2026-11-11T15:00:00Z', items: 10 }],
      items: [
        {
          id: 'a', checker: 'full-fact', name: 'Full Fact', title: 'Florida Learjet plane crash was real, not faked to cover up a missile strike',
          url: 'https://fullfact.org/online/florida-crash-real/', published: '2026-11-04T16:00:49Z', claim: null, rating: null,
          summary: 'False claims that the crash was faked have spread online.', language: 'en', model: FINGERPRINT_MODEL, vec: b64(toward(0.67)),
        },
        {
          id: 'b', checker: 'politifact', name: 'PolitiFact', title: 'Senator misleads on Florida insurance costs',
          url: 'https://www.politifact.com/factchecks/2026/nov/03/x/', published: '2026-11-03T12:00:00Z', claim: 'Insurance costs fell.',
          rating: 'Mostly False', summary: null, language: 'en', model: FINGERPRINT_MODEL, vec: b64(toward(0.7)),
        },
      ],
    })
  })

  it("gives the checks about the story in the checkers' own words, credited and linked", async () => {
    const res = await get(SIGNAL)
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data).toMatchObject({ storyId: STORY, available: true, readAt: '2026-11-11T15:00:00Z' })
    expect(data.checks).toEqual([{
      checker: 'Full Fact', checkerUrl: 'https://fullfact.org',
      title: 'Florida Learjet plane crash was real, not faked to cover up a missile strike',
      url: 'https://fullfact.org/online/florida-crash-real/', published: '2026-11-04T16:00:49Z',
      claim: null, rating: null, summary: 'False claims that the crash was faked have spread online.',
      score: 0.67, shared: ['florida', 'plane', 'crash'],
    }])
    expect(data.checkers.map((c: { name: string }) => c.name)).toEqual(['PolitiFact', 'FactCheck.org', 'Full Fact'])
    // the story's latest 150 reports, by the story it belongs to; their fingerprints of the current model
    expect(h.sqls[0]).toMatch(/LIMIT 150/)
    expect(h.bindings[0]).toEqual([STORY, STORY, STORY, STORY])
    expect(h.bindings[1]).toEqual([STORY, STORY, FINGERPRINT_MODEL])
  })

  it('has no checks before the scraper has read the feeds, without asking the database', async () => {
    h.snapshot = null
    const data = (await get(SIGNAL)).json().data
    expect(data).toMatchObject({ storyId: STORY, available: false, checks: [] })
    expect(h.sqls).toEqual([])
  })

  it('has no checks for a story whose reports have no fingerprints yet', async () => {
    h.centroid = null
    expect((await get(SIGNAL)).json().data.checks).toEqual([])
  })

  it('is a 404 for a story with no reports, and a 400 for an id that is not one', async () => {
    h.titles = []
    expect((await get(SIGNAL)).statusCode).toBe(404)
    expect((await get('not-an-id')).statusCode).toBe(400)
  })
})
