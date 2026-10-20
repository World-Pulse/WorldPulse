/**
 * IODA internet outages (Oct 20, 2026): which of IODA's outage events make a
 * report, and what the report says. The events are made up, in the shape
 * IODA's /v2/outages/events answers.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: {} }))
vi.mock('../../pipeline/insert-signal', () => ({ insertAndCorrelate: vi.fn() }))
vi.mock('../../lib/fetch-with-resilience', () => ({ fetchWithResilience: vi.fn(), CircuitOpenError: class extends Error {} }))

const { pickOutages, outageReport, iodaSeverity, IODA_API_BASE } = await import('../ioda')

const NOW = 1_800_000_000
const ev = (cc: string, opts: { ago?: number; score?: number; ds?: string; duration?: number; name?: string } = {}) => {
  const start = NOW - (opts.ago ?? 3600)
  return {
    location: `country/${cc}`,
    location_name: opts.name ?? cc,
    start,
    duration: opts.duration ?? NOW - start,
    datasource: opts.ds ?? 'bgp',
    method: 'median',
    score: opts.score ?? 2_000,
    status: 0,
  }
}

describe('pickOutages', () => {
  it('keeps a recent routing or probing outage with a score of 1,000 or more', () => {
    const picked = pickOutages([ev('BI'), ev('KM', { ds: 'ping-slash24', score: 1_000 })], NOW)
    expect(picked.map(o => o.code).sort()).toEqual(['BI', 'KM'])
  })

  it('leaves out low scores, old outages and the noisier measurements', () => {
    const picked = pickOutages([
      ev('KP', { score: 477 }),                       // a short blip
      ev('AM', { ago: 12 * 24 * 3600, score: 25_000 }), // began 12 days ago
      ev('LT', { ds: 'gtr', score: 600_000 }),         // Google traffic
      ev('BB', { ds: 'merit-nt', score: 9_000 }),      // network telescope
      { location: 'asn/1234', start: NOW - 60, duration: 60, datasource: 'bgp', score: 9_000 },
      { location: 'country/XX' },
    ], NOW)
    expect(picked).toEqual([])
  })

  it('makes one report per country, its worst outage', () => {
    const picked = pickOutages([ev('LS', { score: 1_200 }), ev('LS', { ago: 7200, score: 2_600 })], NOW)
    expect(picked).toHaveLength(1)
    expect(picked[0].score).toBe(2_600)
  })

  it("treats countries far apart starting together as IODA's own glitch", () => {
    // Oct 20, 2026: four island states, on two oceans, at the same minute
    const glitch = ['AI', 'CK', 'FM', 'LC'].map(cc => ev(cc, { ago: 5 * 3600, score: 1_100 }))
    expect(pickOutages(glitch, NOW)).toEqual([])
    // the same outage alone is kept
    expect(pickOutages([ev('FM', { ago: 5 * 3600, score: 1_100 })], NOW)).toHaveLength(1)
  })

  it('keeps neighbours starting together (a cut undersea cable takes out a coast)', () => {
    const coast = ['CI', 'GH', 'TG', 'BJ', 'NG'].map(cc => ev(cc, { ago: 2 * 3600, score: 3_000 }))
    expect(pickOutages(coast, NOW).map(o => o.code).sort()).toEqual(['BJ', 'CI', 'GH', 'NG', 'TG'])
  })

  it('sorts the worst first', () => {
    const picked = pickOutages([ev('BI', { score: 4_905 }), ev('KM', { score: 3_494, ago: 600 })], NOW)
    expect(picked.map(o => o.code)).toEqual(['BI', 'KM'])
  })
})

describe('outageReport', () => {
  it('says what IODA saw, in plain words, and links to its country page', () => {
    const [o] = pickOutages([ev('BI', { score: 4_905.4, name: 'Burundi' })], NOW)
    const r = outageReport(o, NOW)
    expect(r.title).toBe('Internet outage in Burundi, detected by IODA')
    expect(r.summary).toContain("IODA, Georgia Tech's internet outage monitor, detected an internet outage in Burundi from")
    expect(r.summary).toContain('routing data (BGP)')
    expect(r.summary).toContain("It had not recovered at IODA's last check.")
    expect(r.summary).toContain('score: 4,905')
    expect(r.summary.length).toBeLessThanOrEqual(600)
    expect(r.url).toBe('https://ioda.inetintel.cc.gatech.edu/country/BI')
  })

  it('says how long an outage that ended lasted', () => {
    const [o] = pickOutages([ev('MU', { ds: 'ping-slash24', score: 1_102, ago: 3 * 3600, duration: 30 * 60 })], NOW)
    const r = outageReport(o, NOW)
    expect(r.summary).toContain('It lasted about 30 minutes.')
    expect(r.summary).toContain('active probing')
    expect(r.title).toBe('Internet outage in Mauritius, detected by IODA')
  })

  it("uses IODA's name for a place we have none for", () => {
    const [o] = pickOutages([ev('GU', { name: 'Guam', score: 9_000 })], NOW)
    expect(outageReport(o, NOW).title).toBe('Internet outage in Guam, detected by IODA')
  })
})

describe('IODA', () => {
  it('asks Georgia Tech\'s API, where IODA moved', () => {
    expect(IODA_API_BASE).toBe('https://api.ioda.inetintel.cc.gatech.edu/v2')
  })

  it('grades severity by score', () => {
    expect(iodaSeverity(1_000)).toBe('medium')
    expect(iodaSeverity(5_000)).toBe('high')
    expect(iodaSeverity(20_000)).toBe('critical')
  })
})
