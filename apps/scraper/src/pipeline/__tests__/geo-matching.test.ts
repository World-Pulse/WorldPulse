/**
 * Map pins come from place names in the text. These cases pinned stories in
 * the wrong country before Oct 10, 2026 (handoff H-0007).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { extractGeo, findGazetteerPlace, mentionedCountries } from '../geo'

describe('findGazetteerPlace', () => {
  it('matches whole words only', () => {
    expect(findGazetteerPlace('Climate talks stall as emissions keep rising')).toBeNull()      // "lima" in "climate"
    expect(findGazetteerPlace('A comparison of the two budget plans')).toBeNull()             // "paris" in "comparison"
    expect(findGazetteerPlace('Officials promote the new vaccine drive')).toBeNull()          // "rome" in "promote"
    expect(findGazetteerPlace('Protests continue in Lima after the vote')?.place).toBe('lima')
  })

  it('prefers the place named first, which is the headline', () => {
    expect(findGazetteerPlace('Explosion hits Kherson. Officials in Moscow deny involvement')?.place).toBe('kherson')
    expect(findGazetteerPlace('Talks in New Delhi; Delhi traffic halted')?.place).toBe('new delhi')
  })

  it('ignores newspaper names', () => {
    expect(findGazetteerPlace('US troops on Okinawa face new limits, the Washington Post reported')).toBeNull()
    expect(findGazetteerPlace('According to the New York Times, talks in Cairo resumed')?.place).toBe('cairo')
  })
})

describe('mentionedCountries', () => {
  it('does not find countries inside other words', () => {
    expect(mentionedCountries('Fresh accusations of causal links in the inquiry')).toEqual([])  // "usa"
    expect(mentionedCountries('Storms hit Indiana farms')).toEqual([])                          // "india"
    expect(mentionedCountries('Wildfires in New South Wales and New England')).toEqual([])
    expect(mentionedCountries('British Columbia floods close highways')).toEqual([])          // not Colombia
  })

  it('finds real mentions, first mentioned first', () => {
    expect(mentionedCountries('Colombian troops and Brazilian police meet')).toEqual(['CO', 'BR'])
    expect(mentionedCountries('The U.S. and Japan sign a pact')).toEqual(['US', 'JP'])
    expect(mentionedCountries('Saudi airport closed after drone attack')).toEqual(['SA'])
  })
})

describe('extractGeo', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  const nominatim = (country: string, lat = 45.9, lon = 24.9) => ({
    ok: true, json: async () => [{ lat: String(lat), lon: String(lon), display_name: 'x', address: { country_code: country } }],
  })

  it('rejects a geocoder hit in a country the text does not mention', async () => {
    fetchMock.mockResolvedValue(nominatim('ro'))  // an ambiguous name resolved to Romania
    const geo = await extractGeo('Abha airport near Khamis closed after Saudi air defences intercept a drone')
    expect(geo.countryCode).toBe('SA')
    expect(geo.name).not.toBe('Abha')
  }, 15_000)

  it('keeps a geocoder hit in a mentioned country', async () => {
    fetchMock.mockResolvedValue(nominatim('jp', 26.2, 127.7))
    const geo = await extractGeo('Protests in Okinawa over Japanese base expansion')
    expect(geo.countryCode).toBe('JP')
    expect(geo.lat).toBeCloseTo(26.2)
  }, 15_000)

  it('does not pin a climate story to Lima', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] })
    const geo = await extractGeo('Climate pledges fall short as emissions keep rising')
    expect(geo.name).not.toBe('Lima')
    expect(geo.countryCode).toBeUndefined()
  }, 15_000)
})
