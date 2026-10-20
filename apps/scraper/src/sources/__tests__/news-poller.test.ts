/**
 * The news reader's poll cycle as the feed list grows to 300 and more
 * (Oct 20, 2026): its pauses shrink so a cycle fits its 30 minutes, and a
 * cycle still running lets the timer's next start go by.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: {} }))

const { sourceDelay, oneCycleAtATime, cycleStart, NEWS_SOURCE_REGISTRY } = await import('../news-rss')

describe('sourceDelay', () => {
  it('keeps 5 s while the list is small, then shortens so the pauses take at most 22.5 of the 30 minutes', () => {
    expect(sourceDelay(185)).toBe(5_000)
    expect(sourceDelay(300)).toBe(4_500)
    expect(sourceDelay(400)).toBe(3_375)
    expect(sourceDelay(5_000)).toBe(1_000)   // never under 1 s
    expect(sourceDelay(0)).toBe(5_000)
    for (const n of [200, 300, 450, 600]) expect((sourceDelay(n) * n) / 60_000).toBeLessThanOrEqual(22.5)
  })

  it("fits today's list", () => {
    expect((sourceDelay(NEWS_SOURCE_REGISTRY.length) * NEWS_SOURCE_REGISTRY.length) / 60_000).toBeLessThanOrEqual(22.5)
  })
})

describe('oneCycleAtATime', () => {
  it('lets a start go by while a cycle runs, and runs the next one after it ends', async () => {
    let finish: () => void = () => {}
    const run = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const skipped = vi.fn()
    const cycle = oneCycleAtATime(run, skipped)
    const first = cycle()
    await cycle()                        // the timer fires again while the first runs
    expect(run).toHaveBeenCalledTimes(1)
    expect(skipped).toHaveBeenCalledTimes(1)
    finish()
    await first
    const second = cycle()
    expect(run).toHaveBeenCalledTimes(2)
    finish()
    await second
  })

  it('frees the next cycle even when one fails', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined)
    const cycle = oneCycleAtATime(run)
    await expect(cycle()).rejects.toThrow('boom')
    await cycle()
    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('cycleStart', () => {
  // Every deploy restarts the scraper; a cycle started again at the top, so on
  // Oct 20, 2026 the reader never got past the first 211 feeds
  const ids = ['a', 'b', 'c', 'd']
  const now = Date.parse('2026-10-20T21:30:00Z')

  it('carries on from the feed a restart interrupted, keeping the cycle\'s start', () => {
    const startedAt = now - 20 * 60_000
    expect(cycleStart({ startedAt, nextId: 'c' }, ids, now)).toEqual({ index: 2, startedAt })
  })

  it('starts at the top when nothing is saved, the cycle is over an hour old, or its feed is gone', () => {
    expect(cycleStart(null, ids, now)).toEqual({ index: 0, startedAt: now })
    expect(cycleStart({ startedAt: now - 61 * 60_000, nextId: 'c' }, ids, now)).toEqual({ index: 0, startedAt: now })
    expect(cycleStart({ startedAt: now - 60_000, nextId: 'removed' }, ids, now)).toEqual({ index: 0, startedAt: now })
    expect(cycleStart({ startedAt: Number.NaN, nextId: 'c' } as never, ids, now)).toEqual({ index: 0, startedAt: now })
    expect(cycleStart({ startedAt: now - 60_000, nextId: 'a' }, ids, now)).toEqual({ index: 0, startedAt: now })
  })
})
