/**
 * The ADS-B poller's OpenSky budget (Oct 17, 2026): anonymous users get 400
 * credits a day per IP and a worldwide poll costs 4, so the poller asks every
 * 20 minutes and, after a 429, waits as long as OpenSky says.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}))
vi.mock('../../pipeline/insert-signal', () => ({ insertAndCorrelate: vi.fn() }))

import { adsbIntervalMs, pauseAfter429Ms, ADSB_DEFAULT_INTERVAL_MS, ADSB_MIN_INTERVAL_MS } from '../adsb'

describe('ADS-B poll interval', () => {
  it('defaults to 20 minutes: 72 worldwide polls, 288 of the 400 daily credits', () => {
    expect(adsbIntervalMs(undefined)).toBe(20 * 60_000)
    expect((86_400_000 / ADSB_DEFAULT_INTERVAL_MS) * 4).toBe(288)
  })

  it('ignores an empty or unreadable setting (docker compose passes unset variables as empty)', () => {
    expect(adsbIntervalMs('')).toBe(ADSB_DEFAULT_INTERVAL_MS)
    expect(adsbIntervalMs('soon')).toBe(ADSB_DEFAULT_INTERVAL_MS)
  })

  it('never polls faster than every 5 minutes', () => {
    expect(adsbIntervalMs('1000')).toBe(ADSB_DEFAULT_INTERVAL_MS)
    expect(adsbIntervalMs(String(ADSB_MIN_INTERVAL_MS))).toBe(ADSB_MIN_INTERVAL_MS)
    expect(adsbIntervalMs(String(30 * 60_000))).toBe(30 * 60_000)
  })
})

describe('after OpenSky answers 429', () => {
  it("waits OpenSky's own retry time", () => {
    expect(pauseAfter429Ms('5400')).toBe(5_400_000)
    expect(pauseAfter429Ms(['120'])).toBe(120_000)
  })

  it('waits an hour when no retry time is given, and never more than a day', () => {
    expect(pauseAfter429Ms(undefined)).toBe(3_600_000)
    expect(pauseAfter429Ms('nonsense')).toBe(3_600_000)
    expect(pauseAfter429Ms('-5')).toBe(3_600_000)
    expect(pauseAfter429Ms(String(3 * 86_400))).toBe(86_400_000)
  })
})
