/**
 * GET /api/v1/public/languages and /api/v1/public/unconfirmed-places (Nov 10, 2026): the open counts the evening's
 * five AI tools ask. The newest verified reports come per language (its newest 25) and for the stories with no report
 * in English (their newest 80): one list of the newest 80 of all languages held only the last hour or so of a day.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: Array<{ sql: string; bindings: unknown[] }> = []
let fail = false

vi.mock('../db/redis', () => ({ redis: { get: async () => null, setex: async () => 'OK' } }))
vi.mock('../db/postgres', () => ({ db: Object.assign(() => ({}), { raw: (s: string) => s }) }))
vi.mock('../lib/categories', () => ({ signalCategories: async () => ['conflict'] }))
vi.mock('../lib/stories', () => ({ signalsHaveStoryIds: async () => true }))
vi.mock('../lib/swr-cache', () => ({
  staleWhileRevalidate: async (_key: string, _opts: unknown, compute: () => Promise<unknown>) => compute(),
}))
vi.mock('../lib/long-query', () => ({
  longQuery: async (_seconds: number, run: (trx: unknown) => Promise<unknown>) => {
    if (fail) throw new Error('canceling statement due to statement timeout')
    return run({
      raw: async (sql: string, bindings: unknown[]) => {
        calls.push({ sql, bindings })
        if (sql.includes('WITH v AS')) {
          return { rows: [
            { id: 'a1', title: 'Sénégal : 34 morts dans un naufrage', language: 'fr', country_code: 'SN', severity: 'high', category: 'disaster',
              verified_at: '2026-11-10T20:00:00Z', story_id: 's1', story_languages: ['fr', 'wo1', 'en'] },
            { id: 'a2', title: 'مقتل 12 في قصف', language: 'ar', country_code: 'XX1', severity: 'high', category: 'conflict',
              verified_at: '2026-11-10T09:00:00Z', story_id: null, story_languages: null },
          ] }
        }
        if (sql.includes('GROUP BY 1\n      ORDER BY reports DESC')) {
          return { rows: [{ language: 'en', reports: '9000', verified: '2700', waiting: '6000', countries: '190' }, { language: 'fr', reports: 800, verified: 120, waiting: 600, countries: 70 }] }
        }
        return { rows: [{ country: 'BI', reports: 40, verified: 1, waiting: 36, waiting_serious: 6, languages: ['fr', 'en'] }] }
      },
    })
  },
}))

import Fastify from 'fastify'
import { registerPublicRoutes } from '../routes/public'

async function app() {
  const a = Fastify()
  await a.register(registerPublicRoutes, { prefix: '/api/v1/public' })
  return a
}

beforeEach(() => { calls.length = 0; fail = false })

describe('GET /api/v1/public/languages', () => {
  it("answers each language's counts as numbers, and the verified reports with their story's languages", async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/public/languages?hours=24' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('*')
    const { data } = res.json()
    expect(data.hours).toBe(24)
    expect(data.languages[0]).toEqual({ language: 'en', reports: 9000, verified: 2700, waiting: 6000, countries: 190 })
    expect(data.verified[0]).toMatchObject({ id: 'a1', language: 'fr', country: 'SN', storyId: 's1', storyLanguages: ['en', 'fr'] })
    // a report without a story is its own story, in its own language; a country that isn't a code is none
    expect(data.verified[1]).toMatchObject({ id: 'a2', country: null, storyId: null, storyLanguages: ['ar'] })
  })

  it("keeps each language's newest 25 and the newest 80 stories without English, not one list of the newest", async () => {
    await (await app()).inject({ method: 'GET', url: '/api/v1/public/languages?hours=72' })
    const verified = calls.find(c => c.sql.includes('WITH v AS'))!
    expect(verified.sql).toContain('PARTITION BY v.language ORDER BY v.verified_at DESC')
    expect(verified.sql).toContain('WHERE in_language <= 25 OR (NOT with_english AND in_kind <= 80)')
    expect(verified.sql).not.toMatch(/LIMIT 80/)
    // reports made in the window and a day before it, verified in the window
    expect(verified.bindings).toEqual([96, 72])
  })

  it('takes 1 to 72 hours, else 24', async () => {
    const a = await app()
    for (const [given, used] of [['0', 24], ['73', 24], ['abc', 24], ['6', 6], ['72', 72]] as const) {
      const res = await a.inject({ method: 'GET', url: `/api/v1/public/languages?hours=${given}` })
      expect(res.json().data.hours, given).toBe(used)
    }
  })

  it('answers 503 when the counts fail', async () => {
    fail = true
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/public/languages' })
    expect(res.statusCode).toBe(503)
    expect(res.json().code).toBe('SERVICE_UNAVAILABLE')
  })
})

describe('GET /api/v1/public/unconfirmed-places', () => {
  it("answers each country's news reports, verified and waiting, leaving the machine feeds out", async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/public/unconfirmed-places?days=3' })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.days).toBe(3)
    expect(data.places).toEqual([{ country: 'BI', reports: 40, verified: 1, waiting: 36, waitingSerious: 6, languages: ['en', 'fr'] }])
    const sql = calls.at(-1)!.sql
    expect(sql).toContain("(NOT (tags @> ARRAY['osint']::text[]) OR tags @> ARRAY['gdelt']::text[])")
    expect(sql).toContain("status = 'pending' AND COALESCE(source_count, 1) <= 1")
    expect(calls.at(-1)!.bindings).toEqual([3])
  })

  it('takes 1 to 14 days, else 7', async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/public/unconfirmed-places?days=15' })
    expect(res.json().data.days).toBe(7)
  })
})
