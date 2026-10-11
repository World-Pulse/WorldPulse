/**
 * Map pins come from place names in the text. These cases pinned stories in
 * the wrong country before Oct 10, 2026 (handoff H-0007).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { extractGeo, findGazetteerPlace, mentionedCountries, acceptGeocoderHit, placeFromText, geocodePlace, throttleNominatim, type NominatimResult } from '../geo'
import { redis } from '../../lib/redis'

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

  // A notable city by default; tests override the kind of place and its importance
  const hit = (name: string, country: string, extra: Partial<NominatimResult> = {}, lat = 45.9, lon = 24.9): NominatimResult => ({
    lat: String(lat), lon: String(lon), display_name: name, name, addresstype: 'city', importance: 0.6,
    address: { country_code: country }, ...extra,
  })
  const nominatim = (country: string, lat = 45.9, lon = 24.9, name = 'Okinawa Prefecture', extra: Partial<NominatimResult> = {}) => ({
    ok: true, json: async () => [hit(name, country, { addresstype: 'province', importance: 0.69, ...extra }, lat, lon)],
  })

  it('rejects a geocoder hit in a country the text does not mention', async () => {
    fetchMock.mockResolvedValue(nominatim('ro', 45.9, 24.9, 'Khamis'))  // an ambiguous name resolved to Romania
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

  it('does not pin a story to a hamlet that shares a word of its headline', async () => {
    // "Trump" is a US hamlet; before Oct 11, 2026 the story got the pin "trump"
    fetchMock.mockResolvedValue({ ok: true, json: async () => [hit('Trump', 'us', { addresstype: 'hamlet', importance: 0.33 })] })
    const geo = await extractGeo('US opens antitrust probe into TV networks halting Trump coverage')
    expect(geo.name).not.toBe('Trump')
    expect(geo).toMatchObject({ name: 'United States', countryCode: 'US' })   // "US" in capitals names the country
  }, 15_000)

  it('names a geocoded place properly, and takes a later answer in the country the text names', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        hit('Erie', 'us', { importance: 0.59 }, 42.13, -80.08),            // Erie, Pennsylvania
        hit('Erie', 'ca', { addresstype: 'town', importance: 0.52 }, 42.9, -79.9),
      ],
    })
    const geo = await extractGeo('Shooting leaves 9 dead in Erie as Canadian officials offer help')
    expect(geo.name).toBe('Erie')          // not "erie"
    expect(geo.countryCode).toBe('CA')     // the text names Canada, not the US
    expect(geo.lat).toBeCloseTo(42.9)
  }, 15_000)

  it('does not pin a climate story to Lima', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] })
    const geo = await extractGeo('Climate pledges fall short as emissions keep rising')
    expect(geo.name).not.toBe('Lima')
    expect(geo.countryCode).toBeUndefined()
  }, 15_000)
})

describe('acceptGeocoderHit', () => {
  const hit = (name: string, addresstype: string, importance: number, namedetails?: Record<string, string>): NominatimResult => ({
    lat: '0', lon: '0', display_name: name, name, addresstype, importance, namedetails,
  })

  it('turns down words that only name hamlets, villages, stations and shops (real answers, Oct 11, 2026)', () => {
    expect(acceptGeocoderHit('trump', hit('Trump', 'hamlet', 0.332))).toBe(false)
    expect(acceptGeocoderHit('gravel', hit('Gravel', 'hamlet', 0.133))).toBe(false)
    expect(acceptGeocoderHit('nishiyama', hit('Nishiyama', 'railway', 0.342))).toBe(false)
    expect(acceptGeocoderHit('energy', hit('Energy', 'village', 0.454))).toBe(false)
    expect(acceptGeocoderHit('apple', hit('Apple Store', 'shop', 0.705))).toBe(false)
    expect(acceptGeocoderHit('police', hit('Police', 'municipality', 0.512))).toBe(false)
    expect(acceptGeocoderHit('hurricane', hit('Hurricane', 'town', 0.405))).toBe(false)
  })

  it('turns down a place the geocoder found under another name', () => {
    expect(acceptGeocoderHit('meta', hit('Metz', 'city', 0.694, { name: 'Metz' }))).toBe(false)
  })

  it('takes notable cities, regions and countries, by any of their names', () => {
    expect(acceptGeocoderHit('doncaster', hit('Doncaster', 'city', 0.581))).toBe(true)
    expect(acceptGeocoderHit('kherson', hit('Kherson Oblast', 'state', 0.633))).toBe(true)
    expect(acceptGeocoderHit('pokrovsk', hit('Pokrovsk', 'town', 0.536))).toBe(true)
    expect(acceptGeocoderHit('el fasher', hit('Al-Fashir', 'city', 0.435, { 'name:en': 'Al-Fashir', alt_name: 'Tendelti;El-Fashir', 'alt_name:en': 'El Fasher' }))).toBe(true)
    expect(acceptGeocoderHit('britain', hit('Great Britain', 'island', 0.749, { alt_name: 'Britain' }))).toBe(true)
    expect(acceptGeocoderHit('port-au-prince', hit('Port-au-Prince Arrondissement', 'city', 0.627))).toBe(true)
  })

  it('needs the whole word, not part of one', () => {
    expect(acceptGeocoderHit('kher', hit('Kherson Oblast', 'state', 0.633))).toBe(false)
  })
})

describe('placeFromText', () => {
  it('uses a known place, else a named country (pinned at its capital), else nothing', () => {
    expect(placeFromText('Strikes reported in Rafah overnight')).toMatchObject({ point: true, name: 'Rafah', countryCode: 'PS' })
    expect(placeFromText('Talks with Japanese officials stall')).toMatchObject({ point: true, name: 'Japan', lat: 35.6762, countryCode: 'JP' })
    expect(placeFromText('Gravel cycling championship crowns a new winner')).toEqual({ point: false })
  })

  it('knows every country, not just 34 (Oct 11, 2026: GDACS quakes in Panama were pinned to Ispra, Italy)', () => {
    expect(placeFromText('Panama struck by 2 powerful earthquakes, U.S. Geological Survey says'))
      .toMatchObject({ point: true, name: 'Panama', countryCode: 'PA' })
    expect(placeFromText('Traumatised Panamanians begin recovery from 7.7-magnitude earthquake')).toMatchObject({ countryCode: 'PA' })
    expect(placeFromText('Green flood alert in Slovenia')).toMatchObject({ name: 'Slovenia', countryCode: 'SI' })
    expect(placeFromText('Orange earthquake in Vanuatu')).toMatchObject({ name: 'Vanuatu', countryCode: 'VU' })
  })

  it('knows plural people-words ("Afghans", "Israelis"), but not "turkeys"', () => {
    expect(placeFromText('Afghans desperate to escape poverty').countryCode).toBe('AF')
    expect(placeFromText('Israelis protest in Tel Aviv').countryCode).toBe('IL')
    expect(placeFromText('Ukrainians return home').countryCode).toBe('UA')
    expect(placeFromText('Farmers raise fewer turkeys this year').countryCode).toBeUndefined()
  })

  it("doesn't take names and other places for countries", () => {
    expect(placeFromText('Michael Jordan buys a team').countryCode).toBeUndefined()
    expect(placeFromText('Oil spill in the Niger Delta').countryCode).not.toBe('NE')
    expect(placeFromText('Guinea pigs escape from a pet shop').countryCode).toBeUndefined()
    expect(placeFromText('Floods in Papua New Guinea').countryCode).toBe('PG')
    expect(placeFromText('Fighting in the Democratic Republic of the Congo').countryCode).toBe('CD')
    expect(placeFromText('Clashes in South Sudan').countryCode).toBe('SS')
  })

  it('shows gazetteer places by their usual spelling', () => {
    expect(placeFromText('Fighting near El-Fasher continues')?.name).toBe('El Fasher')
    expect(placeFromText('Protest in Port-au-Prince turns violent')?.name).toBe('Port-au-Prince')
  })
})

describe('geocoder politeness', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.mocked(redis.get).mockImplementation(async () => null) })

  it('gives callers arriving together one slot each', async () => {
    const starts: number[] = []
    await Promise.all([1, 2, 3].map(async () => { await throttleNominatim(40); starts.push(Date.now()) }))
    starts.sort((a, b) => a - b)
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(35)
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(35)
  })

  it('answers null (not "nothing found") when the geocoder refuses, and then pauses', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 429, json: async () => [] }))
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(redis.setex).mockClear()
    expect(await geocodePlace('doncaster')).toBeNull()
    expect(vi.mocked(redis.setex)).toHaveBeenCalledWith('nominatim:cooldown', 900, '429')
    expect(vi.mocked(redis.setex).mock.calls.some(c => String(c[0]).startsWith('geocode'))).toBe(false)   // not cached

    // While the pause is on, it doesn't ask at all
    vi.mocked(redis.get).mockImplementation(async (key: string) => key === 'nominatim:cooldown' ? '429' : null)
    fetchMock.mockClear()
    expect(await geocodePlace('erie')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  }, 10_000)
})
