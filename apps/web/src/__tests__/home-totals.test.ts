/**
 * The home page's day totals (plan N1, fixed Oct 23, 2026): read from the
 * server's status file, not from one page of the stories list ("20+") or the
 * sources API's database table (19 of the 651 sources read).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { cachedFetch } = vi.hoisted(() => ({ cachedFetch: vi.fn() }))
vi.mock('@/lib/server-fetch', () => ({ cachedFetch }))

import { totalsOf, fetchHomeTotals, resetHomeTotals } from '@/lib/home-totals'

// The shape of /ops-status.json on Oct 23, 2026 (trimmed)
const STATUS = {
  updated: '2026-10-23T11:00:02+00:00',
  pipeline: {
    db: [
      { created: 14345, verified: 2163, pending: 12182, multi_source: 2332, outlets: 1763 },
      { verified_any_age: 2388 },
      { stories_verified_24h: 803, stories_verified_days: [{ day: '2026-10-22', stories: 704 }] },
      { flagged_for_review: 0 },
      { reported_for_review: 0 },
    ],
    sources: { tracked: 651, failing: 2, paused: 0, stale: 3, switched_off: 11 },
  },
}

describe("the home page's day totals", () => {
  it("are the status file's verified stories of the last 24 hours and the sources read", () => {
    expect(totalsOf(STATUS)).toEqual({ verified24h: 803, sources: 651 })
  })

  it('find the stories wherever they sit among the database answers, some of them null', () => {
    const status = { pipeline: { db: [null, null, { stories_verified_24h: '1204' }], sources: { tracked: 651 } } }
    expect(totalsOf(status)).toEqual({ verified24h: 1204, sources: 651 })
  })

  it('are null, not zero or a guess, when the file lacks them', () => {
    expect(totalsOf({ pipeline: { db: [null, null, null, null, null], sources: { tracked: 0 } } })).toEqual({ verified24h: null, sources: null })
    expect(totalsOf({ pipeline: { db: 'timed out', sources: null } })).toEqual({ verified24h: null, sources: null })
    expect(totalsOf({ pipeline: { db: [{ stories_verified_24h: 'unknown' }], sources: { tracked: -3 } } })).toEqual({ verified24h: null, sources: null })
    expect(totalsOf(null)).toEqual({ verified24h: null, sources: null })
    expect(totalsOf('<html>not json</html>')).toEqual({ verified24h: null, sources: null })
  })
})

describe('reading the status file', () => {
  beforeEach(() => { cachedFetch.mockReset(); resetHomeTotals() })

  it('asks the site for /ops-status.json, kept 10 minutes, waiting at most 3 seconds', async () => {
    cachedFetch.mockResolvedValue(new Response(JSON.stringify(STATUS), { status: 200 }))
    expect(await fetchHomeTotals()).toEqual({ verified24h: 803, sources: 651 })
    expect(cachedFetch).toHaveBeenCalledWith('https://world-pulse.io/ops-status.json', 600_000, 3_000)
  })

  it('after a failed read, gives nulls without asking again for 10 minutes', async () => {
    const t0 = Date.UTC(2026, 9, 23, 11, 0)
    cachedFetch.mockRejectedValue(new Error('timed out'))
    expect(await fetchHomeTotals(t0)).toEqual({ verified24h: null, sources: null })
    expect(await fetchHomeTotals(t0 + 9 * 60_000)).toEqual({ verified24h: null, sources: null })
    expect(cachedFetch).toHaveBeenCalledTimes(1)
    cachedFetch.mockResolvedValue(new Response(JSON.stringify(STATUS), { status: 200 }))
    expect(await fetchHomeTotals(t0 + 11 * 60_000)).toEqual({ verified24h: 803, sources: 651 })
    expect(cachedFetch).toHaveBeenCalledTimes(2)
  })
})
