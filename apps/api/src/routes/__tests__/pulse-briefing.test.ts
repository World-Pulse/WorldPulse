/**
 * The morning briefing's events (GET /api/v1/pulse/briefing, Oct 13, 2026):
 * one per story, then at most 3 per category.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../db/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn(), schema: { hasColumn: vi.fn() } }) }))
vi.mock('../../db/redis', () => ({ redis: { get: vi.fn(), setex: vi.fn(), set: vi.fn(), incr: vi.fn(), expire: vi.fn() } }))

import { oneEventPerStory, diverseEvents, BRIEFING_STALE_TTL } from '../pulse'

describe('oneEventPerStory', () => {
  it('keeps the first report of each story, in order', () => {
    const rows = [
      { id: 'a1', story_id: 'S1', title: 'Saudi Arabia vows serious response after Houthi airport attacks kill 18' },
      { id: 'b1', story_id: 'S2', title: 'Saudi warning system stayed silent before deadly airport attacks' },
      { id: 'a2', story_id: 'S1', title: 'Saudi vows response after deadly airport attacks' },
      { id: 'c1', story_id: null, title: 'A report with no story yet' },
    ]
    expect(oneEventPerStory(rows).map(r => r.id)).toEqual(['a1', 'b1', 'c1'])
  })

  it('treats each report as its own story when there are no story ids', () => {
    expect(oneEventPerStory([{ id: 'x' }, { id: 'y' }]).map(r => r.id)).toEqual(['x', 'y'])
  })
})

describe('diverseEvents', () => {
  it('keeps at most 3 per category, then the first `limit`', () => {
    const rows = ['conflict', 'conflict', 'conflict', 'conflict', 'disaster', 'health', 'conflict', 'disaster']
      .map((category, i) => ({ id: String(i), category }))
    expect(diverseEvents(rows, 10).map(r => r.id)).toEqual(['0', '1', '2', '4', '5', '7'])
    expect(diverseEvents(rows, 4).map(r => r.id)).toEqual(['0', '1', '2', '4'])
  })
})

describe('how long a briefing is kept', () => {
  it('serves one up to 6 hours old while the next is made, so a quiet time zone is not made while its reader waits', () => {
    expect(BRIEFING_STALE_TTL).toBe(6 * 60 * 60)
  })
})
