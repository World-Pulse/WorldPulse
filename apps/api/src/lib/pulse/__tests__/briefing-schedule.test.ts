/**
 * The AI Digest's briefings (pulse/scheduler.ts checkBriefings,
 * publisher.ts briefingSlotFree). Oct 12, 2026: the API was down at 7 AM ET
 * and the morning briefing was skipped for the day, and the three briefings
 * shared one "1 a day" limit, so the mid-day update blocked the evening wrap
 * and the next morning's briefing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  morning: vi.fn(),
  update: vi.fn(),
  logRows: [] as Array<{ content_type: string; published_at: Date; metadata: Record<string, unknown> }>,
}))

vi.mock('../publisher', async (orig) => ({
  ...(await orig<typeof import('../publisher')>()),
  checkAndPublishFlashBriefs: vi.fn(async () => 0),
  publishDailyBriefing: h.morning,
  publishBriefingUpdate: h.update,
}))
vi.mock('../agents/coordinator', () => ({ runAgentBeatScan: vi.fn() }))
vi.mock('../agents/twitter-publisher', () => ({ runTwitterPublisher: vi.fn() }))
vi.mock('../agents/registry', () => ({ getAgent: vi.fn() }))
vi.mock('../../engine-loader', () => ({ loadEngine: vi.fn(async () => null) }))
vi.mock('../../claude', () => ({ CLAUDE_SMALL: 'small', CLAUDE_WRITER: 'writer', askClaude: vi.fn() }))
vi.mock('../../../db/redis', () => ({ redis: { get: vi.fn(), setex: vi.fn(), publish: vi.fn() } }))
vi.mock('../../../ws/handler', () => ({ broadcast: vi.fn() }))

// pulse_publish_log in memory, for briefingSlotFree's one query
vi.mock('../../../db/postgres', () => {
  const db = (table: string) => {
    const conds: Array<(r: (typeof h.logRows)[number]) => boolean> = []
    const q = {
      where(col: string, op: unknown, val?: unknown) {
        if (col === 'content_type') conds.push(r => r.content_type === op)
        if (col === 'published_at' && op === '>') conds.push(r => r.published_at > (val as Date))
        return q
      },
      whereRaw(sql: string, [slot]: string[]) {
        expect(sql).toContain("coalesce(metadata->>'updateType', 'morning')")
        conds.push(r => ((r.metadata.updateType as string | undefined) ?? 'morning') === slot)
        return q
      },
      count() {
        expect(table).toBe('pulse_publish_log')
        return Promise.resolve([{ count: h.logRows.filter(r => conds.every(c => c(r))).length }])
      },
    }
    return q
  }
  return { db }
})

import { checkBriefings, resetBriefingState } from '../scheduler'
import { briefingSlotFree } from '../publisher'

const at = (hhmm: string) => new Date(`${new Date().toISOString().slice(0, 10)}T${hhmm}:00Z`)
const ok = { success: true, postId: 'p1' }

beforeEach(() => {
  resetBriefingState()
  h.morning.mockReset().mockResolvedValue(ok)
  h.update.mockReset().mockResolvedValue(ok)
  h.logRows = []
})

describe('briefing schedule', () => {
  it('writes the morning briefing once at 7 AM ET', async () => {
    await checkBriefings(at('11:00'))
    await checkBriefings(at('11:01'))
    expect(h.morning).toHaveBeenCalledTimes(1)
  })

  it('catches up a missed morning later in its window, and not after it', async () => {
    await checkBriefings(at('14:20'))
    expect(h.morning).toHaveBeenCalledTimes(1)
    resetBriefingState()
    await checkBriefings(at('16:00'))
    expect(h.morning).toHaveBeenCalledTimes(1)
  })

  it('retries a failed briefing after 15 minutes, not every minute', async () => {
    h.morning.mockResolvedValue({ success: false, error: 'LLM returned empty or insufficient briefing content' })
    await checkBriefings(at('11:00'))
    await checkBriefings(at('11:05'))
    await checkBriefings(at('11:14'))
    expect(h.morning).toHaveBeenCalledTimes(1)
    await checkBriefings(at('11:16'))
    expect(h.morning).toHaveBeenCalledTimes(2)
  })

  it('stops for the day once the database says the piece is already out', async () => {
    h.morning.mockResolvedValue({ success: false, alreadyPublished: true, error: 'The morning briefing is already out today' })
    await checkBriefings(at('11:00'))
    await checkBriefings(at('11:30'))
    await checkBriefings(at('13:00'))
    expect(h.morning).toHaveBeenCalledTimes(1)
  })

  it('writes the mid-day update and the evening wrap in their own windows', async () => {
    await checkBriefings(at('18:10'))
    await checkBriefings(at('23:00'))
    expect(h.update.mock.calls.map(c => c[0])).toEqual(['midday', 'evening'])
    expect(h.morning).not.toHaveBeenCalled()
  })
})

describe('briefingSlotFree: each briefing has its own once-a-day slot', () => {
  const hoursAgo = (n: number) => new Date(Date.now() - n * 3600_000)

  it("a mid-day update doesn't take the evening's or the next morning's slot", async () => {
    h.logRows = [{ content_type: 'daily_briefing', published_at: hoursAgo(6), metadata: { updateType: 'midday' } }]
    expect(await briefingSlotFree('midday')).toBe(false)
    expect(await briefingSlotFree('evening')).toBe(true)
    expect(await briefingSlotFree('morning')).toBe(true)
  })

  it('a morning briefing (no updateType) takes only the morning slot, for 20 hours', async () => {
    h.logRows = [{ content_type: 'daily_briefing', published_at: hoursAgo(5), metadata: { date: 'Monday' } }]
    expect(await briefingSlotFree('morning')).toBe(false)
    expect(await briefingSlotFree('midday')).toBe(true)
    h.logRows[0].published_at = hoursAgo(21)
    expect(await briefingSlotFree('morning')).toBe(true)
  })
})
