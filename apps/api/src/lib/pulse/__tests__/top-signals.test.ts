/**
 * The AI Digest reads one signal per story, and knows which stories are
 * verified (pulse/publisher.ts, Oct 11, 2026).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ raws: [] as Array<{ sql: string; params?: unknown[] }>, rows: [] as unknown[] }))

vi.mock('../../claude', () => ({ CLAUDE_SMALL: 'claude-haiku-5-5', CLAUDE_WRITER: 'claude-sonnet-5-5', askClaude: vi.fn() }))
vi.mock('../../../db/postgres', () => ({
  db: Object.assign(vi.fn(), { raw: vi.fn(async (sql: string, params?: unknown[]) => { h.raws.push({ sql, params }); return { rows: h.rows } }) }),
}))
vi.mock('../../../db/redis', () => ({ redis: { get: vi.fn(), setex: vi.fn() } }))
vi.mock('../../../ws/handler', () => ({ broadcast: vi.fn() }))

import { getTopSignals, getCriticalSignals, outletsLine } from '../publisher'

describe('the stories the digest reads', () => {
  beforeEach(() => { h.raws.length = 0; h.rows = [{ id: 'a', title: 'Riyadh airport attack' }] })

  it('takes one signal per story, verified first within a severity', async () => {
    expect(await getTopSignals(24, 30)).toEqual([{ id: 'a', title: 'Riyadh airport attack' }])
    const { sql, params } = h.raws[0]!
    expect(sql).toMatch(/DISTINCT ON \(COALESCE\(story_id, id\)\)/)
    expect(sql).toMatch(/\(status = 'verified'\) DESC/)
    expect(params![1]).toBe(30)
  })

  it('reads news only: no low-severity culture, sports or "other" (editorial standards, check 5)', async () => {
    await getTopSignals(24, 30)
    expect(h.raws[0]!.sql).toMatch(/AND NOT \(category::text IN \('other', 'culture', 'sports'\) AND COALESCE\(severity::text, 'low'\) IN \('low', 'info'\)\)/)
  })

  it('briefs a story once a day, not once per outlet', async () => {
    await getCriticalSignals(15)
    const { sql } = h.raws[0]!
    expect(sql).toMatch(/DISTINCT ON \(COALESCE\(s\.story_id, s\.id\)\)/)
    expect(sql).toMatch(/NOT EXISTS[\s\S]*pulse_publish_log[\s\S]*COALESCE\(b\.story_id, b\.id\) = COALESCE\(s\.story_id, s\.id\)/)
    expect(sql).toMatch(/s\.status/)
  })
})

describe('outletsLine', () => {
  it('says whether outlets verified a story', () => {
    expect(outletsLine({ status: 'verified', source_count: 67 })).toBe('verified by 67 independent outlets')
    expect(outletsLine({ status: 'pending', source_count: 1 })).toBe('not yet verified, 1 independent outlet')
  })
})
