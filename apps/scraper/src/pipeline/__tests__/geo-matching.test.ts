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

  it("finds India's states and cities, not only its biggest four", () => {
    expect(findGazetteerPlace('Heavy rain floods Bengaluru suburbs in Karnataka')?.coords.name).toBe('Bangalore')
    expect(findGazetteerPlace('Telangana cabinet clears new IT policy')?.coords.country).toBe('IN')
    expect(findGazetteerPlace('Pune police arrest two over cyber fraud')?.coords.region).toBe('Maharashtra')
    expect(findGazetteerPlace('Floods hit Tamil Nadu coast')?.place).toBe('tamil nadu')
    expect(findGazetteerPlace('Assamese cuisine festival opens')).toBeNull()                   // whole words only
  })

  it('pins a named region at the region, not at its country\'s capital', () => {
    const quake = findGazetteerPlace("Magnitude 7 earthquake kills 16 people in China's Tibet, Xinhua reports")
    expect(quake?.place).toBe('tibet')
    expect(quake?.coords.country).toBe('CN')
    expect(quake?.coords.lat).toBeLessThan(35)                                                   // Beijing is 39.9
    expect(findGazetteerPlace('Tibetan monks mark the festival')).toBeNull()                    // whole words only
    expect(findGazetteerPlace('Militants attack convoy in Balochistan')?.coords.country).toBe('PK')
    expect(findGazetteerPlace('Xinjiang cotton ban widens')?.coords.region).toBe('Xinjiang')
  })

  it('pins Lyon, Taif and Ras Al Khaimah stories there, not at the capital', () => {
    expect(findGazetteerPlace('Police disperse Lyon student protest')?.place).toBe('lyon')
    expect(findGazetteerPlace('Air defenses intercept Houthi missiles at Taif and Yanbu')?.place).toBe('taif')
    expect(findGazetteerPlace('Ras Al Khaimah shuts beaches after oil leak')?.coords.country).toBe('AE')
    expect(findGazetteerPlace('Ras Al Khaimah shuts beaches after oil leak')?.coords.lat).toBeGreaterThan(25.5)  // Dubai is 25.2
    expect(findGazetteerPlace('Jordan church attack: Irbid mourns')?.place).toBe('irbid')
  })

  it('pins Sarawak, Sabah and Auckland stories there, not at their capitals', () => {
    const school = findGazetteerPlace('Police record 24 statements over Kuching school attack')
    expect(school?.coords.region).toBe('Sarawak')
    expect(school?.coords.lat).toBeLessThan(3)                                                   // Kuala Lumpur is 3.1
    expect(findGazetteerPlace('Abang Johari expected to dissolve Sarawak assembly')?.place).toBe('sarawak')
    expect(findGazetteerPlace('Woman dies after train strikes her at Auckland crossing')?.coords.country).toBe('NZ')
    expect(findGazetteerPlace('Sabahan singer wins award')).toBeNull()                           // whole words only
  })

  it('pins Melaka, Penang suburb, Selangor beach and northern Nigeria stories there, not at Kuala Lumpur or Lagos', () => {
    expect(findGazetteerPlace('Perikatan confirms using own logo for Melaka election')?.coords.region).toBe('Melaka')
    expect(findGazetteerPlace('Paya Terubong landslide slope stable for now, says MBPP mayor')?.coords.region).toBe('Penang')
    expect(findGazetteerPlace('Police warn public to avoid Bagan Lalang Beach after crocodile sighting')?.coords.region).toBe('Selangor')
    expect(findGazetteerPlace('Death toll in Taraba bandits’ attack now 50')?.coords.country).toBe('NG')
    expect(findGazetteerPlace('Death toll in Taraba bandits’ attack now 50')?.coords.lat).toBeGreaterThan(8)   // Lagos is 6.5
  })

  it('a headline that starts "Jordan says" is about the country, not Greece through "Greek"', () => {
    expect(placeFromText('Jordan says 3 arrested in deadly attack on Greek Orthodox church').countryCode).toBe('JO')
    expect(placeFromText('Jordan Henderson says he wants to stay at the club').countryCode).not.toBe('JO')
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
    expect(mentionedCountries("Witness in Chad Daybell's murder trial testifies")).toEqual([])   // a first name, not Chad
  })

  it('finds real mentions, first mentioned first', () => {
    expect(mentionedCountries('Colombian troops and Brazilian police meet')).toEqual(['CO', 'BR'])
    expect(mentionedCountries('The U.S. and Japan sign a pact')).toEqual(['US', 'JP'])
    expect(mentionedCountries('Saudi airport closed after drone attack')).toEqual(['SA'])
    expect(mentionedCountries('Floods displace thousands in Chad')).toEqual(['TD'])
    expect(mentionedCountries("Clashes in Chad's east kill 12")).toEqual(['TD'])
    expect(mentionedCountries("Chadian army says 3 killed near N'Djamena")).toEqual(['TD'])
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

  it('does not read "French" as French Guiana (live, Oct 25, 2026: Le Pen\'s campaign launch)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      // the geocoder files French Guiana under country code fr
      json: async () => [hit('French Guiana', 'fr', { addresstype: 'region', importance: 0.6 }, 4.0, -53.0)],
    })
    const geo = await extractGeo('Marine Le Pen launches French presidential campaign')
    expect(geo.name).not.toBe('French Guiana')
    expect(geo.countryCode).toBe('FR')
    expect(geo.lat).toBeCloseTo(48.8566)
  }, 15_000)

  it('does not read "Council", "Spring" or "Sabha" as the towns of those names (live, Oct 26, 2026)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [hit('Council', 'us', { importance: 0.6 }, 44.73, -116.44)],
    })
    for (const title of ['Council approves new budget for housing', 'Spring offensive plans reported by analysts', 'Sabha passes the bill after a long debate']) {
      const geo = await extractGeo(title)
      expect(geo.lat).not.toBeCloseTo(44.73)
    }
    expect(fetchMock).not.toHaveBeenCalled()
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
