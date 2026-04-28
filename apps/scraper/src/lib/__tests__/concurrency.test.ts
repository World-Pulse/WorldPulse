import { describe, it, expect } from 'vitest'
import { createSemaphore } from '../concurrency.js'

describe('createSemaphore', () => {
  it('throws for maxConcurrent < 1', () => {
    expect(() => createSemaphore(0)).toThrow(RangeError)
    expect(() => createSemaphore(-1)).toThrow(RangeError)
  })

  it('runs a single task', async () => {
    const limit = createSemaphore(1)
    const result = await limit(() => Promise.resolve(42))
    expect(result).toBe(42)
  })

  it('caps concurrency at maxConcurrent', async () => {
    const maxConcurrent = 3
    const limit = createSemaphore(maxConcurrent)

    let activeConcurrent = 0
    let peakConcurrent = 0

    const task = () =>
      limit(async () => {
        activeConcurrent++
        peakConcurrent = Math.max(peakConcurrent, activeConcurrent)
        // Yield control so other tasks can start if semaphore allows
        await new Promise(resolve => setTimeout(resolve, 10))
        activeConcurrent--
        return true
      })

    await Promise.all(Array.from({ length: 10 }, task))

    expect(peakConcurrent).toBeLessThanOrEqual(maxConcurrent)
  })

  it('resolves all tasks', async () => {
    const limit = createSemaphore(2)
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map(n => limit(() => Promise.resolve(n * 2)))
    )
    expect(results).toEqual([2, 4, 6, 8, 10])
  })

  it('propagates errors without breaking the semaphore', async () => {
    const limit = createSemaphore(2)

    const results = await Promise.allSettled([
      limit(() => Promise.reject(new Error('fail'))),
      limit(() => Promise.resolve('ok')),
      limit(() => Promise.resolve('also ok')),
    ])

    expect(results[0].status).toBe('rejected')
    expect(results[1].status).toBe('fulfilled')
    expect(results[2].status).toBe('fulfilled')
  })

  it('processes tasks in FIFO order when concurrency is 1', async () => {
    const limit = createSemaphore(1)
    const order: number[] = []

    await Promise.all(
      [1, 2, 3].map(n =>
        limit(async () => {
          order.push(n)
          await new Promise(resolve => setTimeout(resolve, 5))
        })
      )
    )

    expect(order).toEqual([1, 2, 3])
  })
})

// ─── ADAPTIVE POLLING LOGIC ──────────────────────────────────────────────────
describe('adaptive polling offset calculation', () => {
  const HIGH_VELOCITY_THRESHOLD = 5
  const ADAPTIVE_ACCELERATION_FACTOR = 0.5

  function computeOffset(newCount: number, scrapeInterval: number): number {
    return newCount >= HIGH_VELOCITY_THRESHOLD
      ? Math.round(scrapeInterval * ADAPTIVE_ACCELERATION_FACTOR)
      : 0
  }

  it('returns 0 for low-velocity sources', () => {
    expect(computeOffset(0, 30)).toBe(0)
    expect(computeOffset(4, 30)).toBe(0)
  })

  it('returns half interval for high-velocity sources', () => {
    expect(computeOffset(5, 30)).toBe(15)
    expect(computeOffset(10, 60)).toBe(30)
    expect(computeOffset(100, 120)).toBe(60)
  })

  it('rounds fractional intervals', () => {
    expect(computeOffset(5, 31)).toBe(16) // round(15.5) = 16 in JS
    expect(computeOffset(5, 15)).toBe(8)  // round(7.5) = 8 in JS
  })
})

// ─── TIER PRIORITY SORTING ───────────────────────────────────────────────────
describe('tier priority sorting', () => {
  const TIER_PRIORITY: Record<string, number> = {
    wire:          0,
    breaking:      1,
    institutional: 2,
    regional:      3,
    community:     4,
  }

  function sortByPriority<T extends { tier: string }>(sources: T[]): T[] {
    return [...sources].sort((a, b) => {
      const pa = TIER_PRIORITY[a.tier] ?? 5
      const pb = TIER_PRIORITY[b.tier] ?? 5
      return pa - pb
    })
  }

  it('puts wire sources before community sources', () => {
    const sources = [
      { tier: 'community', name: 'Blog' },
      { tier: 'wire', name: 'Reuters' },
      { tier: 'regional', name: 'Local' },
    ]
    const sorted = sortByPriority(sources)
    expect(sorted[0].tier).toBe('wire')
    expect(sorted[sorted.length - 1].tier).toBe('community')
  })

  it('preserves relative order within same tier', () => {
    const sources = [
      { tier: 'wire', name: 'AP' },
      { tier: 'wire', name: 'Reuters' },
    ]
    const sorted = sortByPriority(sources)
    expect(sorted.map(s => s.name)).toEqual(['AP', 'Reuters'])
  })

  it('puts unknown tiers at the end', () => {
    const sources = [
      { tier: 'unknown_tier', name: 'X' },
      { tier: 'wire', name: 'Reuters' },
    ]
    const sorted = sortByPriority(sources)
    expect(sorted[0].name).toBe('Reuters')
    expect(sorted[1].name).toBe('X')
  })

  it('handles full priority order', () => {
    const sources = [
      { tier: 'community' },
      { tier: 'regional' },
      { tier: 'institutional' },
      { tier: 'breaking' },
      { tier: 'wire' },
    ]
    const sorted = sortByPriority(sources)
    expect(sorted.map(s => s.tier)).toEqual([
      'wire', 'breaking', 'institutional', 'regional', 'community',
    ])
  })
})
