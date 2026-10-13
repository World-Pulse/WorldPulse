/**
 * Entity pages (lib/entity-profile.ts, Oct 13, 2026). The queries were run
 * against Postgres 16 with fixture rows (a three-report story, single reports
 * on ten days, a report from 40 days ago, a malformed id); these check the
 * parts that don't need a database.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../db/postgres', () => ({ db: { raw: vi.fn() } }))
vi.mock('../db/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../routes/stories', () => ({ storiesOfSignals: vi.fn(async () => []) }))
vi.mock('../lib/stories', () => ({ signalsHaveStoryIds: vi.fn(async () => true) }))

import { mentionIds, dailySeries, ACTIVITY_DAYS } from '../lib/entity-profile'

describe('mentionIds', () => {
  it('keeps well-formed report ids, lowercase and once each', () => {
    const a = '6f1c2a3b-0000-4000-8000-000000000001'
    expect(mentionIds([a, a.toUpperCase(), 'not-a-uuid', 42, null])).toEqual([a])
    expect(mentionIds(null)).toEqual([])
  })
})

describe('dailySeries', () => {
  it('is 30 UTC days ending today, oldest first, with empty days as 0', () => {
    const now = Date.parse('2026-10-13T03:30:00Z')
    const series = dailySeries(new Map([['2026-10-13', 4], ['2026-10-01', 2]]), now)
    expect(series).toHaveLength(ACTIVITY_DAYS)
    expect(series[0]).toEqual({ day: '2026-09-14', n: 0 })
    expect(series.at(-1)).toEqual({ day: '2026-10-13', n: 4 })
    expect(series.find(d => d.day === '2026-10-01')?.n).toBe(2)
  })
})
