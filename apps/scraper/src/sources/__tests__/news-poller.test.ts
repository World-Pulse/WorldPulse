/**
 * The news reader's poll cycle as the feed list grows to 300 and more
 * (Oct 20, 2026): its pauses shrink so a cycle fits its 30 minutes, and a
 * cycle still running lets the timer's next start go by.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: {} }))

const { sourceDelay, cyclePause, CYCLE_BUDGET, SOURCE_PAUSE_MIN, oneCycleAtATime, cycleStart, NEWS_SOURCE_REGISTRY, READ_AT_ONCE, readRounds } = await import('../news-rss')

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

describe('cyclePause', () => {
  it("shares what is left of the cycle's budget among the feeds still to read, less the time a read takes", () => {
    expect(cyclePause(100, 400_000, 1_000)).toBe(3_000)
    expect(cyclePause(10, 10 * 60_000, 500)).toBe(5_000)          // never over 5 s
    expect(cyclePause(100, -60_000, 3_000)).toBe(SOURCE_PAUSE_MIN) // behind: the shortest pause
    expect(cyclePause(0, 60_000, 100)).toBe(0)                     // after the last feed
    expect(cyclePause(5, Number.NaN, 0)).toBe(SOURCE_PAUSE_MIN)
  })

  it('ends a pass before the next start, where the fixed pause ran 44 minutes (Oct 20, 405 feeds at about 3 s a read)', () => {
    const pass = (n: number, readMs: number, paced: boolean) => {
      let t = 0
      for (let i = 0; i < n; i++) {
        t += readMs
        t += paced ? Math.min(sourceDelay(n), cyclePause(n - i - 1, CYCLE_BUDGET - t, readMs)) : sourceDelay(n)
      }
      return t / 60_000
    }
    expect(pass(405, 3_100, false)).toBeGreaterThan(43)   // what the 7:05 PM audit saw
    expect(pass(405, 3_100, true)).toBeLessThanOrEqual(CYCLE_BUDGET / 60_000 + 0.1)
    expect(pass(500, 3_100, true)).toBeLessThan(30)
    expect(pass(185, 1_000, true)).toBeLessThan(30)
  })
})

describe('two feeds at a time (Oct 20, 2026, 475 feeds)', () => {
  it('splits the cycle into rounds of READ_AT_ONCE feeds from where it starts', () => {
    expect(READ_AT_ONCE).toBe(2)
    expect(readRounds(5, 0)).toEqual([[0, 2], [2, 4], [4, 5]])
    expect(readRounds(5, 3)).toEqual([[3, 5]])            // a cycle carried on after a restart
    expect(readRounds(5, 5)).toEqual([])
    expect(readRounds(3, 0, 1)).toEqual([[0, 1], [1, 2], [2, 3]])
    expect(readRounds(4, -2, 0)).toEqual([[0, 1], [1, 2], [2, 3], [3, 4]])
    const all = readRounds(NEWS_SOURCE_REGISTRY.length, 0).flatMap(([a, b]) => Array.from({ length: b - a }, (_, k) => a + k))
    expect(all).toEqual(NEWS_SOURCE_REGISTRY.map((_, i) => i))   // every feed once, in order
  })

  it('leaves room in the 30 minutes: one at a time the reads alone filled 25 of them', () => {
    const pass = (n: number, roundMs: number, atOnce: number) => {
      const rounds = Math.ceil(n / atOnce)
      let t = 0
      for (let r = 0; r < rounds; r++) {
        t += roundMs
        t += Math.min(sourceDelay(n), cyclePause(rounds - r - 1, CYCLE_BUDGET - t, roundMs))
      }
      return t / 60_000
    }
    // the reads alone, one at a time, at about 3.1 s each
    expect((475 * 3_100) / 60_000).toBeGreaterThan(24)
    // two at a time a round takes about its slower read; still on time with slow answers or 700 feeds
    expect(pass(475, 3_600, 2)).toBeLessThanOrEqual(CYCLE_BUDGET / 60_000 + 0.1)
    expect(pass(475, 6_000, 2)).toBeLessThan(30)
    expect(pass(700, 4_000, 2)).toBeLessThan(30)
    expect(pass(475, 4_000, 1)).toBeGreaterThan(30)          // what one at a time would do if reads slowed to 4 s
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
