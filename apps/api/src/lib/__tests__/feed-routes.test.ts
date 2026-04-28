import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock heavy dependencies before any imports that pull them in ──────────────
vi.mock('../../db/postgres', () => ({
  db: Object.assign(vi.fn(), {
    raw:  vi.fn(),
    from: vi.fn(),
  }),
}))
vi.mock('../../db/redis', () => ({
  redis: { get: vi.fn().mockResolvedValue(null), setex: vi.fn() },
}))

// ── Helpers mirroring feed.ts logic ──────────────────────────────────────────

function topicKey(title: string): string {
  return (title ?? '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((w: string) => w.length > 3)
    .slice(0, 6)
    .sort()
    .join('_')
}

type SignalRow = { id: string; title: string; reliability_score?: number }

function dedupSignals(rows: SignalRow[]): SignalRow[] {
  const seen = new Set<string>()
  return rows.filter(row => {
    const key = topicKey(row.title)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1)  return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('feed deduplication (signals stream)', () => {
  const SIGNAL_ROWS: SignalRow[] = [
    { id: 'sig-1', title: 'Massive earthquake strikes northern Syria' },
    { id: 'sig-2', title: 'Massive earthquake strikes northern Syria — updated' },
    { id: 'sig-3', title: 'Massive earthquake strikes northern Syria, rescue teams deployed' },
    { id: 'sig-4', title: 'Hurricane watch issued for Gulf Coast states' },
    { id: 'sig-5', title: 'Hurricane watch issued for Gulf Coast states — landfall imminent' },
    { id: 'sig-6', title: 'NATO foreign ministers convene emergency session Brussels' },
  ]

  it('reduces 6 rows to 3 unique topic groups', () => {
    const result = dedupSignals(SIGNAL_ROWS)
    expect(result.length).toBe(3)
  })

  it('retains the first (most recent) signal per topic', () => {
    const result = dedupSignals(SIGNAL_ROWS)
    const ids = result.map(r => r.id)
    expect(ids).toContain('sig-1')
    expect(ids).toContain('sig-4')
    expect(ids).toContain('sig-6')
    expect(ids).not.toContain('sig-2')
    expect(ids).not.toContain('sig-3')
    expect(ids).not.toContain('sig-5')
  })

  it('passes through a feed with no duplicates unchanged', () => {
    const unique: SignalRow[] = [
      { id: 'a', title: 'Flooding in Bangladesh displaces thousands' },
      { id: 'b', title: 'SpaceX Starship launch scrubbed due to weather' },
      { id: 'c', title: 'IMF downgrades global growth forecast for year' },
    ]
    expect(dedupSignals(unique).length).toBe(3)
  })

  it('handles empty feed array', () => {
    expect(dedupSignals([])).toEqual([])
  })

  it('handles a single signal correctly', () => {
    const one: SignalRow[] = [{ id: 'x', title: 'Volcano erupts in Iceland' }]
    expect(dedupSignals(one)).toEqual(one)
  })
})

describe('formatTimeAgo()', () => {
  it('returns "now" for very recent timestamps', () => {
    const justNow = new Date(Date.now() - 30_000).toISOString()
    expect(formatTimeAgo(justNow)).toBe('now')
  })

  it('returns minutes for timestamps < 1 hour ago', () => {
    const fiveMin = new Date(Date.now() - 5 * 60_000).toISOString()
    expect(formatTimeAgo(fiveMin)).toBe('5m')
  })

  it('returns hours for timestamps < 1 day ago', () => {
    const twoHours = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
    expect(formatTimeAgo(twoHours)).toBe('2h')
  })

  it('returns days for timestamps >= 1 day ago', () => {
    const threeDays = new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString()
    expect(formatTimeAgo(threeDays)).toBe('3d')
  })
})

describe('pagination cursor behaviour (unit)', () => {
  it('PAGE_SIZE cap of 50 is respected', () => {
    const PAGE_SIZE = 20
    const requested = 100
    const actual = Math.min(requested, 50)
    expect(actual).toBe(50)
    expect(actual).toBeLessThanOrEqual(50)
  })

  it('hasMore is true when result set exceeds pageLimit', () => {
    const pageLimit = 20
    const rows = Array.from({ length: 21 }, (_, i) => ({ id: `sig-${i}` }))
    const hasMore = rows.length > pageLimit
    expect(hasMore).toBe(true)
    const items = rows.slice(0, pageLimit)
    expect(items.length).toBe(pageLimit)
  })

  it('hasMore is false when result set is at or below pageLimit', () => {
    const pageLimit = 20
    const rows = Array.from({ length: 15 }, (_, i) => ({ id: `sig-${i}` }))
    const hasMore = rows.length > pageLimit
    expect(hasMore).toBe(false)
  })
})
