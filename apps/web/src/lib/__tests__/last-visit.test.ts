import { describe, it, expect } from 'vitest'
import { readLastVisit, writeLastVisit, awayLabel, sinceLastVisit, LAST_VISIT_KEY, MIN_AWAY_MS } from '../last-visit'

const memory = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
}

describe('last visit storage', () => {
  it('reads what it wrote, and nothing from empty, junk or broken storage', () => {
    const s = memory()
    expect(readLastVisit(s)).toBeNull()
    writeLastVisit(s, 1_700_000_000_000)
    expect(readLastVisit(s)).toBe(1_700_000_000_000)
    s.setItem(LAST_VISIT_KEY, 'yesterday')
    expect(readLastVisit(s)).toBeNull()
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(readLastVisit(broken)).toBeNull()
    expect(() => writeLastVisit(broken)).not.toThrow()
    expect(readLastVisit(null)).toBeNull()
  })
})

describe('awayLabel', () => {
  const now = Date.parse('2026-10-11T06:00:00Z')
  it('says how long ago in plain words', () => {
    expect(awayLabel(now - 45 * 60_000, now)).toBe('45 min ago')
    expect(awayLabel(now - 3 * 3_600_000, now)).toBe('3h ago')
    expect(awayLabel(now - 3 * 86_400_000, now)).toBe('3 days ago')
  })
})

describe('sinceLastVisit', () => {
  const now = Date.parse('2026-10-11T06:00:00Z')
  const at = (h: number) => new Date(now - h * 3_600_000).toISOString()
  const signals = [
    { id: 'a', created_at: at(0.5), severity: 'critical', status: 'pending' },
    { id: 'b', created_at: at(2), severity: 'medium', status: 'verified' },
    { id: 'c', created_at: at(5), severity: 'high', status: 'pending' },
    { id: 'd', created_at: at(30), severity: 'low', status: 'pending' },
  ]

  it('counts what came in since the last look', () => {
    const r = sinceLastVisit(signals, now - 3 * 3_600_000, now - 24 * 3_600_000, now)!
    expect(r.fresh.map(s => s.id)).toEqual(['a', 'b'])
    expect(r).toMatchObject({ serious: 1, verified: 1, capped: false })
  })

  it("only counts the map's time window when the last look was before it", () => {
    const r = sinceLastVisit(signals, now - 3 * 86_400_000, now - 24 * 3_600_000, now)!
    expect(r.fresh.map(s => s.id)).toEqual(['a', 'b', 'c'])
    expect(r.capped).toBe(true)
  })

  it('has nothing to say on a first visit or a quick return', () => {
    expect(sinceLastVisit(signals, null, null, now)).toBeNull()
    expect(sinceLastVisit(signals, now - MIN_AWAY_MS + 1, null, now)).toBeNull()
  })
})
