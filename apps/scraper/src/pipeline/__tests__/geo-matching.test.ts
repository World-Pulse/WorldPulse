/**
 * Map pins come from place names in the text. These cases pinned stories in
 * the wrong country before Oct 10, 2026 (handoff H-0007).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { extractGeo, findGazetteerPlace, homePlaceFromText, mentionedCountries, acceptGeocoderHit, placeFromText, geocodePlace, throttleNominatim, oneArea, type NominatimResult } from '../geo'
import { redis } from '../../lib/redis'

describe('findGazetteerPlace', () => {
  it('matches whole words only', () => {
    expect(findGazetteerPlace('Climate talks stall as emissions keep rising')).toBeNull()      // "lima" in "climate"
    expect(findGazetteerPlace('A comparison of the two budget plans')).toBeNull()             // "paris" in "comparison"
    expect(findGazetteerPlace('Officials promote the new vaccine drive')).toBeNull()          // "rome" in "promote"
    expect(findGazetteerPlace('Protests continue in Lima after the vote')?.place).toBe('lima')
  })

  it('reads capital "LA" before mayor, county or a team as Los Angeles, and nothing else', () => {
    expect(findGazetteerPlace('Nithya Raman set to become LA mayor')?.place).toBe('los angeles')
    expect(findGazetteerPlace('LA County sues over wildfire fund')?.place).toBe('los angeles')
    expect(findGazetteerPlace('LA Times reports on the vote')).toBeNull()
    expect(findGazetteerPlace('Flood warning for parts of LA and the delta')).toBeNull()
  })

  it('does not pin a cannabis story to Ganja, Azerbaijan', () => {
    expect(findGazetteerPlace('Thailand shops sell ganja after the legal change')?.coords.country).not.toBe('AZ')
    expect(findGazetteerPlace('Flood in Ganja, Azerbaijan displaces families')?.coords.country).toBe('AZ')
  })

  it('pins Pavlohrad and Port Qasim at their own towns, not at the capital', () => {
    const p = findGazetteerPlace('Russian strike hits Pavlohrad rail depot')
    expect(p?.place).toBe('pavlohrad')
    expect(p?.coords.country).toBe('UA')
    expect(findGazetteerPlace('Cargo ship docks at Port Qasim')?.place).toBe('port qasim')
  })

  it('pins Vietnamese provinces, Ugandan towns and the Algarve at their own places, not at Thailand, Kampala or Dakar', () => {
    expect(findGazetteerPlace('Thai Nguyen seeks to expand tea in tourism')?.coords.country).toBe('VN')
    expect(findGazetteerPlace('Can Tho supports fishing vessel decommissioning')?.coords.country).toBe('VN')
    expect(findGazetteerPlace('193 Police Officers Graduate in Masindi')?.coords.country).toBe('UG')
    expect(findGazetteerPlace('Algarve hoteliers hail return of Dakar Rally')?.coords.country).toBe('PT')
  })

  it('pins Russian republics and cities in Russia, not in a neighbouring country', () => {
    expect(findGazetteerPlace('Drone attack reported in Ufa, Bashkortostan')?.coords.country).toBe('RU')
    expect(findGazetteerPlace('Bashkortostan oil refinery fire')?.place).toBe('bashkortostan')
    expect(findGazetteerPlace('Kazan airport closed after drone alert')?.coords.country).toBe('RU')
  })

  it('pins Cluj-Napoca and Oshkosh at their own towns, not at a capital named in the story', () => {
    const cluj = findGazetteerPlace("'King of Waltz' André Rieu returns to Cluj-Napoca in October 2027")
    expect(cluj?.place).toBe('cluj-napoca')
    expect(cluj?.coords.country).toBe('RO')
    const osh = findGazetteerPlace("Husband of deported Oshkosh teacher speaks out")
    expect(osh?.place).toBe('oshkosh')
    expect(osh?.coords.country).toBe('US')
  })

  it('pins Halton and Burlington in Ontario, not at Burlington, Vermont', () => {
    expect(findGazetteerPlace('Halton police charge man in Burlington crash')?.coords.country).toBe('CA')
    expect(findGazetteerPlace('Burlington council approves budget')?.coords.country).toBe('CA')
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
    // (Okinawa itself is on the map since Nov 14, 2026; the newspaper's Washington still isn't read)
    expect(findGazetteerPlace('US troops on Okinawa face new limits, the Washington Post reported')?.place).toBe('okinawa')
    expect(findGazetteerPlace('US troops face new limits, the Washington Post reported')).toBeNull()
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
    const geo = await extractGeo('Airport near Khamis closed after Saudi air defences intercept a drone')
    expect(geo.countryCode).toBe('SA')
    expect(geo.lat).not.toBe(45.9)
    // Abha itself has been on the map since Nov 6, 2026 (world-gazetteer.ts): the geocoder isn't asked
    expect((await extractGeo('Abha airport near Khamis closed after Saudi air defences intercept a drone')).name).toBe('Abha')
  }, 15_000)

  it('keeps a geocoder hit in a mentioned country', async () => {
    // (Ishigaki: Okinawa itself is on the map since Nov 14, 2026, so the geocoder isn't asked for it)
    fetchMock.mockResolvedValue(nominatim('jp', 24.34, 124.16, 'Ishigaki'))
    const geo = await extractGeo('Protests in Ishigaki over Japanese base expansion')
    expect(geo.countryCode).toBe('JP')
    expect(geo.lat).toBeCloseTo(24.34)
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

  it('does not ask the geocoder for "Nation" (Nov 6, 2026: Australia\'s One Nation stories sat in Brunei, kept for a day)', async () => {
    // as a cached answer from before Nov 5 would give it back
    fetchMock.mockResolvedValue({ ok: true, json: async () => [hit('Brunei', 'bn', { addresstype: 'country', importance: 0.78,
      namedetails: { name: 'Brunei', 'official_name:en': 'Nation of Brunei, the Abode of Peace' } }, 4.5, 114.7)] })
    const geo = await extractGeo('Nationals leader to run for lower house seat in possible showdown with One Nation')
    expect(geo.countryCode).not.toBe('BN')
    expect(fetchMock.mock.calls.some(([url]) => /q=nation&/.test(String(url)))).toBe(false)
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

  it('turns down a word of a long official name (Nov 5, 2026: "One Nation" stories pinned in Brunei)', () => {
    const brunei = hit('Brunei', 'country', 0.78, {
      name: 'Brunei', 'name:en': 'Brunei', official_name: 'Negara Brunei Darussalam', 'official_name:en': 'Nation of Brunei, the Abode of Peace',
    })
    expect(acceptGeocoderHit('nation', brunei)).toBe(false)
    expect(acceptGeocoderHit('peace', brunei)).toBe(false)
    expect(acceptGeocoderHit('abode', brunei)).toBe(false)
    expect(acceptGeocoderHit('brunei', brunei)).toBe(true)
    expect(acceptGeocoderHit('brunei darussalam', brunei)).toBe(true)
    const russia = hit('Russia', 'country', 0.85, { 'name:en': 'Russia', 'official_name:en': 'Russian Federation' })
    expect(acceptGeocoderHit('federation', russia)).toBe(false)
    expect(acceptGeocoderHit('russian federation', russia)).toBe(true)
    expect(acceptGeocoderHit('republic', hit('Czechia', 'country', 0.8, { 'official_name:en': 'Czech Republic' }))).toBe(false)
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

describe('M57, Oct 30, 2026: the fresh read of the live map', () => {
  it('a club or a rally named after a city is not the city', () => {
    expect(placeFromText("Bayern Munich's Kenya friendly highlights Africa's growing pull for global sport").countryCode).toBe('KE')
    expect(placeFromText('El Dakar 2027 arrancará en Portugal y tendrá a Marruecos como principal escenario').countryCode).toBe('PT')
    expect(placeFromText('Dakar Rally route announced for January').countryCode).not.toBe('SN')
    expect(placeFromText('Floods hit Dakar suburbs').countryCode).toBe('SN')
  })
  it('knows Antigua Guatemala and the Korean DMZ', () => {
    expect(placeFromText('Tres meses después, el Centro Materno Infantil de Antigua Guatemala continúa inhabilitado').countryCode).toBe('GT')
    expect(placeFromText('Germany news: Merz calls for Korean reunification at DMZ').countryCode).toBe('KR')
  })
  it('a country named where something happens comes first ("in Ghana", "visits Iran"); an actor named alone stays', () => {
    expect(placeFromText('Swiss Group unveils Jetour G700 and F700 at 2026 auto expo in Ghana').countryCode).toBe('GH')
    expect(placeFromText('JD Vance, vice de EE.UU., visitará Colombia en noviembre').countryCode).toBe('CO')
    expect(placeFromText('Qatari delegation visits Iran as US peace talks intensify').countryCode).toBe('IR')
    expect(placeFromText('Turkish President urges resolving Iran tensions through diplomacy').countryCode).toBe('TR')
    expect(placeFromText('Swiss foreign minister discusses security issues with North Korea').countryCode).toBe('CH')
  })
  it('a document named after a place is not the place ("la Convention d\'Accra")', () => {
    expect(placeFromText('Transports et logistique : le Gabon signe la Convention d’Accra pour fluidifier les échanges').countryCode).toBe('GA')
  })
  it('people named by a plural come after the country the headline names', () => {
    expect(mentionedCountries('ICE nabs Cubans for unlawfully voting in the United States')).toEqual(['US', 'CU'])
    expect(mentionedCountries('Cuba frees prisoners')).toEqual(['CU'])
  })
  it('the headline speaks first: its place, or a country it names outright, before a place in the article', async () => {
    expect((await extractGeo('Irish government to assess potential for united Ireland', 'London has to call a referendum on Irish unity if most Northern Irish voters would back it.')).countryCode).toBe('IE')
    expect((await extractGeo('Concerns Regarding Energy Prices - Radio Romania International', 'Energy ministers met in Luxembourg on Thursday.')).countryCode).toBe('RO')
    // a place in the article in the named country is taken
    expect((await extractGeo('Ukraine: drone attack on an energy plant', 'Russian drones hit a plant in Kharkiv overnight.')).name).toBe('Kharkiv')
    // an adjective names the actor: the article's place stays ("Israeli strike" in Gaza)
    expect((await extractGeo('Israeli strike kills five', 'The strike hit a house in Gaza on Tuesday.')).countryCode).toBe('PS')
  })
})

describe('places 72 hours of headlines named and the gazetteer missed (Oct 30, 2026)', () => {
  it("pins Nigeria's states, Guayaquil, Makkah and Incheon at their own places", () => {
    expect(findGazetteerPlace('Troops kill 44 terrorists, destroy IED materials in Borno')?.coords.country).toBe('NG')
    expect(findGazetteerPlace('5 arrested as NSCDC uncovers illegal diesel refinery in Kano')?.place).toBe('kano')
    expect(findGazetteerPlace('Police rescue 29 kidnap victims, arrest 34 foreigners in Benue – Official')?.coords.region).toBe('Benue')
    expect(findGazetteerPlace('Fiscalía intervino oficinas de la Alcaldía de Guayaquil por presunto peculado')?.coords.country).toBe('EC')
    expect(findGazetteerPlace('Tinubu heads to Makkah to pray for Nigeria')?.coords.country).toBe('SA')
    expect(findGazetteerPlace('13 airlines hit by check-in disruption at Incheon Airport')?.coords.country).toBe('KR')
    expect(findGazetteerPlace('Balean antigua casa de campaña de Rocha Moya en Culiacán')?.coords.region).toBe('Sinaloa')
  })
  it('pins Australian, New Zealand and Tobago local stories at their own places', () => {
    expect(findGazetteerPlace("Interstate investors sparking 'astronomical' house sales in Alice Springs")?.coords.country).toBe('AU')
    expect(findGazetteerPlace("Wairarapa drug kingpin's prison sentence cut on appeal")?.coords.country).toBe('NZ')
    // either of its two keys: since Nov 6, 2026 "wanaka" reads "Wānaka" too
    expect(findGazetteerPlace('Calls for freedom camping ban at popular Wānaka lake')?.place).toMatch(/^w[aā]naka$/)
    expect(findGazetteerPlace('Four held for drunk driving in Tobago')?.coords.country).toBe('TT')
    expect(findGazetteerPlace('Donald Trump rally threat ahead of Daytona Beach appearance')?.coords.region).toBe('Florida')
  })
  it('pins big Asian and European cities at their own places', () => {
    expect(findGazetteerPlace('Factory fire kills five in Faisalabad')?.coords.country).toBe('PK')
    expect(findGazetteerPlace('Shenzhen tech firm unveils new chip')?.coords.region).toBe('Guangdong')
    expect(findGazetteerPlace('Edinburgh council approves tram line')?.coords.country).toBe('GB')
    expect(findGazetteerPlace('Gdańsk shipyard marks anniversary')?.coords.country).toBe('PL')
    expect(findGazetteerPlace('Jakarta and Surabaya hit by floods')?.place).toBe('jakarta')
  })
  it('pins more big cities at their own places (M63)', () => {
    expect(findGazetteerPlace('Police say a man was arrested in Mombasa on Friday')?.coords.country).toBe('KE')
    expect(findGazetteerPlace('Tabriz earthquake damages homes')?.coords.country).toBe('IR')
    expect(findGazetteerPlace('Seattle council passes budget')?.coords.region).toBe('Washington')
    expect(findGazetteerPlace('Düsseldorf trade fair opens')?.coords.country).toBe('DE')
    expect(findGazetteerPlace('Ciudad Juárez shooting leaves three dead')?.coords.country).toBe('MX')
    expect(findGazetteerPlace('Aberdeen oil firm cuts jobs')?.coords.region).toBe('Scotland')
  })
  it('leaves out names that are also other words or names', () => {
    expect(findGazetteerPlace('OYO raises funds as Indian hotel chain expands')).toBeNull()
    expect(findGazetteerPlace('IMO adopts new shipping emissions rules')).toBeNull()
    expect(findGazetteerPlace('Jos Buttler leads England to victory')).toBeNull()
  })
  it('a state and a place in it are one area; two cities in one state are not', () => {
    const at = (t: string) => findGazetteerPlace(t)!
    expect(oneArea(at('Clashes in Borno'), at('Clashes in Maiduguri'))).toBe(true)
    expect(oneArea(at('Floods in Maharashtra'), at('Floods in Pune'))).toBe(true)
    expect(oneArea(at('Bolsonaro lands in Miami'), at('Bolsonaro arrives in Florida'))).toBe(true)
    expect(oneArea(at('Blast in Kiev'), at('Blast in Kyiv'))).toBe(true)
    expect(oneArea(at('Strike on Nyala market'), at('Fighting in Darfur'))).toBe(true)
    expect(oneArea(at('Floods in Pune'), at('Floods in Nagpur'))).toBe(false)
    expect(oneArea(at('Assembly in Jigawa'), at('Assembly in Ebonyi'))).toBe(false)
  })
})

describe('islands and regions headlines name plainly (M64)', () => {
  it('pins them at their own places', () => {
    expect(findGazetteerPlace('Aid reaches the Galapagos after storm')?.coords.country).toBe('EC')
    expect(findGazetteerPlace('Whale spotted in the Gulf of St. Lawrence')?.coords.country).toBe('CA')
    expect(findGazetteerPlace('Tenerife wildfire forces evacuations')?.coords.country).toBe('ES')
    expect(findGazetteerPlace('Sardinia heatwave breaks record')?.coords.country).toBe('IT')
    expect(findGazetteerPlace('Floods hit Sumatra villages')?.coords.country).toBe('ID')
    expect(findGazetteerPlace('Nunavut hamlet loses power')?.coords.country).toBe('CA')
  })
})

describe('cities that share a name with a word count with their state or country (H-0037)', () => {
  it('pins them when the state or country follows, not when the name stands alone', () => {
    expect(findGazetteerPlace('Flooding in Austin, Texas kills two')?.coords.country).toBe('US')
    expect(findGazetteerPlace('Tyre, Lebanon hit by overnight strikes')?.coords.country).toBe('LB')
    expect(findGazetteerPlace('Gao, Mali airport attacked')?.coords.country).toBe('ML')
    expect(findGazetteerPlace('Portland, Oregon protest turns tense')?.coords.region).toBe('Oregon')
    expect(findGazetteerPlace('Nice, France market reopens')?.coords.country).toBe('FR')
    expect(findGazetteerPlace('Tyre prices rise as Nice weather returns')).toBeNull()
    expect(findGazetteerPlace('Phoenix rises as Austin Butler stars')).toBeNull()
    expect(findGazetteerPlace('Springfield, Illinois crash kills three')?.coords.region).toBe('Illinois')
    expect(findGazetteerPlace('Birmingham, England stabbing: police appeal')?.coords.country).toBe('GB')
    expect(findGazetteerPlace('Kingston, Jamaica braces for storm')?.coords.country).toBe('JM')
    expect(findGazetteerPlace('Fire in San José, Costa Rica market')?.coords.country).toBe('CR')
    expect(findGazetteerPlace('Mobile phone sales fall as Madison Square crowds thin')).toBeNull()
    expect(findGazetteerPlace('Newcastle, England fans march before derby')?.coords.country).toBe('GB')
    expect(findGazetteerPlace('Santa Cruz, California wildfire spreads')?.coords.region).toBe('California')
    expect(findGazetteerPlace('York, England floods as river rises')?.coords.country).toBe('GB')
    expect(findGazetteerPlace('Reading about Bath time and a hull repair')).toBeNull()
    expect(findGazetteerPlace('Dover, England port queues grow')?.coords.country).toBe('GB')
    expect(findGazetteerPlace('Charleston, South Carolina storm surge warning')?.coords.region).toBe('South Carolina')
    expect(findGazetteerPlace('Perth, Scotland man charged')?.coords.country).toBe('GB')
    expect(findGazetteerPlace('Perth, Australia heat record')?.coords.country).toBe('AU')
    expect(findGazetteerPlace('Rugby fans in Bury wait for wells to be dug')).toBeNull()
  })
})

describe('second cities of francophone Africa, Uganda, Madagascar and Panama get their own pins', () => {
  it('pins them in their own country', () => {
    expect(findGazetteerPlace('Travaux de maintenance à Ntoum (Communiqué SEEG)')?.coords.country).toBe('GA')
    expect(findGazetteerPlace('Attaque jihadiste près de Thiès')?.coords.country).toBe('SN')
    expect(findGazetteerPlace('Fighting reaches Uvira as thousands flee')?.coords.country).toBe('CD')
    expect(findGazetteerPlace('Migrants cross the Darién Gap in record numbers')?.coords.country).toBe('PA')
    expect(findGazetteerPlace('Floods in Colon, Panama leave hundreds homeless')?.coords.country).toBe('PA')
    expect(findGazetteerPlace('Colon cancer screening expands')).toBeNull()
  })
})

describe('second cities of East Africa, Central Asia, the Caucasus and southern Africa get their own pins', () => {
  it('pins them in their own country', () => {
    expect(findGazetteerPlace('Clashes in Garissa leave five dead')?.coords.country).toBe('KE')
    expect(findGazetteerPlace('Drone strike hits Port Sudan road near Kassala')?.coords.country).toBe('SD')
    expect(findGazetteerPlace('Protesters gather in Osh over water prices')?.coords.country).toBe('KG')
    expect(findGazetteerPlace('Oil leak reported near Atyrau')?.coords.country).toBe('KZ')
    expect(findGazetteerPlace('Bus crash near Kutaisi kills six')?.coords.country).toBe('GE')
    expect(findGazetteerPlace('Cyclone damage reported in Walvis Bay')?.coords.country).toBe('NA')
  })
})

describe('names that end on an accented letter are found as whole words', () => {
  it('pins Potosí, Cuiabá and Macapá, with or without the accent, and not inside a longer word', () => {
    expect(findGazetteerPlace('Miners block roads in Potosí over pay')?.coords.country).toBe('BO')
    expect(findGazetteerPlace('Fire spreads near Cuiabá, officials say')?.coords.country).toBe('BR')
    expect(findGazetteerPlace('Flooding in Macapá displaces families')?.coords.country).toBe('BR')
    expect(findGazetteerPlace('Flooding in Macapa displaces families')?.coords.country).toBe('BR')
    expect(findGazetteerPlace('Cuiabáx festival opens')).toBeNull()
  })
})

describe('second cities of South America, Central America, Mexico and the Caribbean get their own pins', () => {
  it('pins them in their own country', () => {
    expect(findGazetteerPlace('Clashes in Cúcuta leave five dead')?.coords.country).toBe('CO')
    expect(findGazetteerPlace('Port strike in Buenaventura enters third day')?.coords.country).toBe('CO')
    expect(findGazetteerPlace('Police in Matamoros arrested a man on Friday')?.coords.country).toBe('MX')
    expect(findGazetteerPlace('Protesters gather in Santiago de Cuba over blackouts')?.coords.country).toBe('CU')
    expect(findGazetteerPlace('Gang attack in Cap-Haïtien kills four')?.coords.country).toBe('HT')
    expect(findGazetteerPlace('Fire near Punta Arenas port')?.coords.country).toBe('CL')
  })
  it('pins the ambiguous names only with their country', () => {
    expect(findGazetteerPlace('Flooding in Salvador, Brazil displaces thousands')?.coords.country).toBe('BR')
    expect(findGazetteerPlace('Police in Granada, Nicaragua arrested a man on Friday')?.coords.country).toBe('NI')
  })
})

describe('second cities of the Ukraine front, Russia, Turkey, the Levant and Europe get their own pins', () => {
  it('pins them in their own country', () => {
    expect(findGazetteerPlace('Russian drones hit an energy site in Sumy overnight')?.coords.country).toBe('UA')
    expect(findGazetteerPlace('Fighting near Kupiansk and Avdiivka intensifies')?.coords.country).toBe('UA')
    expect(findGazetteerPlace('Drone attack on Novorossiysk oil terminal')?.coords.country).toBe('RU')
    expect(findGazetteerPlace('Officials said police in Bursa arrested a man on Friday')?.coords.country).toBe('TR')
    expect(findGazetteerPlace('Strike on Qamishli kills two')?.coords.country).toBe('SY')
    expect(findGazetteerPlace('Rocket alert in Ashkelon and Sderot')?.coords.country).toBe('IL')
    expect(findGazetteerPlace('Dockers strike in Le Havre enters second week')?.coords.country).toBe('FR')
    expect(findGazetteerPlace('Fan banned after incident in Bochum')?.coords.country).toBe('DE')
    expect(findGazetteerPlace('Floods hit Murcia and Almería')?.coords.country).toBe('ES')
    expect(findGazetteerPlace('Protest in Łódź over the budget')?.coords.country).toBe('PL')
  })
  it('does not pin words that contain them', () => {
    expect(findGazetteerPlace('The summary of the bonnet recall')).toBeNull()
    expect(findGazetteerPlace('Sumyt is a made-up word')).toBeNull()
    expect(findGazetteerPlace('Foołódź festival opens')).toBeNull()
  })
})

describe('second cities of Asia, Iran, the Gulf and Central Asia get their own pins', () => {
  it('pins them in their own country', () => {
    expect(findGazetteerPlace('Officials said police in Gwadar arrested a man on Friday')?.coords.country).toBe('PK')
    expect(findGazetteerPlace('Flooding hits Pune and Nashik')?.coords.country).toBe('IN')
    expect(findGazetteerPlace('Rohingya boat reaches Cox\'s Bazar')?.coords.country).toBe('BD')
    expect(findGazetteerPlace('Fighting near Lashio displaces thousands')?.coords.country).toBe('MM')
    expect(findGazetteerPlace('Tourists evacuated in Phuket')?.coords.country).toBe('TH')
    expect(findGazetteerPlace('Typhoon makes landfall near Da Nang')?.coords.country).toBe('VN')
    expect(findGazetteerPlace('Clashes in Marawi leave two dead')?.coords.country).toBe('PH')
    expect(findGazetteerPlace('Earthquake shakes Surabaya')?.coords.country).toBe('ID')
    expect(findGazetteerPlace('Fans gather in Busan for the final')?.coords.country).toBe('KR')
    expect(findGazetteerPlace('Port strike in Shenzhen widens')?.coords.country).toBe('CN')
    expect(findGazetteerPlace('Explosion heard near Natanz')?.coords.country).toBe('IR')
    expect(findGazetteerPlace('Drone intercepted over Ras Tanura')?.coords.country).toBe('SA')
    expect(findGazetteerPlace('Houthi strike on Hodeidah port')?.coords.country).toBe('YE')
    expect(findGazetteerPlace('Rain delays flights in Samarkand')?.coords.country).toBe('UZ')
  })
  it('does not pin words that contain them', () => {
    expect(findGazetteerPlace('The punebased startup is hiring')).toBeNull()
    expect(findGazetteerPlace('Gwadarx is a made-up word')).toBeNull()
  })
})

describe('second cities of Africa get their own pins', () => {
  it('pins them in their own country', () => {
    expect(findGazetteerPlace('Officials said police in Zaria arrested a man on Friday')?.coords.country).toBe('NG')
    expect(findGazetteerPlace('Attack near Gwoza leaves dozens dead')?.coords.country).toBe('NG')
    expect(findGazetteerPlace('Cocoa traders protest in Takoradi')?.coords.country).toBe('GH')
    expect(findGazetteerPlace('Floods hit Ismailia and Damietta')?.coords.country).toBe('EG')
    expect(findGazetteerPlace('Armed groups clash in Zawiya')?.coords.country).toBe('LY')
    expect(findGazetteerPlace('Protesters gather in Oran')?.coords.country).toBe('DZ')
    expect(findGazetteerPlace('Migrants cross into Ceuta')?.coords.country).toBe('ES')
    expect(findGazetteerPlace('Hotel strike in Hammamet')?.coords.country).toBe('TN')
    expect(findGazetteerPlace('Drone strike on Kadugli')?.coords.country).toBe('SD')
    expect(findGazetteerPlace('Fresh fighting in Juba')?.coords.country).toBe('SS')
    expect(findGazetteerPlace('Mine accident near Polokwane')?.coords.country).toBe('ZA')
    expect(findGazetteerPlace('Cholera spreads in Beledweyne')?.coords.country).toBe('SO')
    expect(findGazetteerPlace('M23 advances toward Walikale')?.coords.country).toBe('CD')
    expect(findGazetteerPlace('Jihadists attack Djibo')?.coords.country).toBe('BF')
    expect(findGazetteerPlace('Rains delay flights in Dar es Salaam')?.coords.country).toBe('TZ')
  })
  it('does not pin words that contain them', () => {
    expect(findGazetteerPlace('The zariaxx festival opens')).toBeNull()
    expect(findGazetteerPlace('The Ho Chi Minh Trail museum reopens')?.coords.country).not.toBe('GH')
  })
})

describe('second cities of the Americas and Oceania get their own pins', () => {
  it('pins them in their own country', () => {
    expect(findGazetteerPlace('Officials said police in Tampico arrested a man on Friday')?.coords.country).toBe('MX')
    expect(findGazetteerPlace('Cartel gunmen kill five in Los Mochis')?.coords.country).toBe('MX')
    expect(findGazetteerPlace('Dam failure near Brumadinho')?.coords.country).toBe('BR')
    expect(findGazetteerPlace('Floods hit Petropolis')?.coords.country).toBe('BR')
    expect(findGazetteerPlace('Strike paralyses Comodoro Rivadavia')?.coords.country).toBe('AR')
    expect(findGazetteerPlace('Protesters block roads in Puno')?.coords.country).toBe('PE')
    expect(findGazetteerPlace('Gangs attack Croix-des-Bouquets')?.coords.country).toBe('HT')
    expect(findGazetteerPlace('Tulsa police shot a man')?.coords.country).toBe('US')
    expect(findGazetteerPlace('Tornado hits Fort Lauderdale')?.coords.country).toBe('US')
    expect(findGazetteerPlace('Wildfire reaches Lahaina')?.coords.country).toBe('US')
    expect(findGazetteerPlace('Wildfire smoke over Kelowna')?.coords.country).toBe('CA')
    expect(findGazetteerPlace('Floods in Lismore')?.coords.country).toBe('AU')
    expect(findGazetteerPlace('Riots in Invercargill')?.coords.country).toBe('NZ')
    expect(findGazetteerPlace('Landslide near Mount Hagen')?.coords.country).toBe('PG')
  })
  it('does not pin words that contain them', () => {
    expect(findGazetteerPlace('The tulsax festival opens')).toBeNull()
  })
})

describe('named hot spots get their own pins', () => {
  it('pins them in their own country', () => {
    expect(findGazetteerPlace('Drone strike near the Khmeimim air base')?.coords.country).toBe('SY')
    expect(findGazetteerPlace('Raid in Tulkarm refugee camp')?.coords.country).toBe('PS')
    expect(findGazetteerPlace('Yazidis return to Sinjar')?.coords.country).toBe('IQ')
    expect(findGazetteerPlace('Fighting spreads across Amhara')?.coords.country).toBe('ET')
    expect(findGazetteerPlace('Aid trucks reach Dadaab')?.coords.country).toBe('KE')
    expect(findGazetteerPlace('Satellite images show work at Punggye-ri')?.coords.country).toBe('KP')
    expect(findGazetteerPlace('Cartel violence in Sinaloa')?.coords.country).toBe('MX')
    expect(findGazetteerPlace('Cartel violence in Michoacán')?.coords.country).toBe('MX')
    expect(findGazetteerPlace('Rebels seize Mocimboa da Praia')?.coords.country).toBe('MZ')
    expect(findGazetteerPlace('Unrest in Nouméa')?.coords.country).toBe('NC')
  })
  it('does not pin words that contain them', () => {
    expect(findGazetteerPlace('The narvax festival opens')).toBeNull()
  })
})

describe('second cities of Britain, the Baltics, Europe and the Balkans get their own pins', () => {
  it('pins them in their own country', () => {
    expect(findGazetteerPlace('Stabbing in Dundee')?.coords.country).toBe('GB')
    expect(findGazetteerPlace('Protest in Klaipeda port')?.coords.country).toBe('LT')
    expect(findGazetteerPlace('Strike hits Liège')?.coords.country).toBe('BE')
    expect(findGazetteerPlace('Attack in Cologne')?.coords.country).toBe('DE')
    expect(findGazetteerPlace('Migrants land on Lesbos')?.coords.country).toBe('GR')
    expect(findGazetteerPlace('Migrants camp near Bihac')?.coords.country).toBe('BA')
    expect(findGazetteerPlace('Blast in Przemyśl')?.coords.country).toBe('PL')
    expect(findGazetteerPlace('Rally in Grodno')?.coords.country).toBe('BY')
    expect(findGazetteerPlace('Talks in Geneva')?.coords.country).toBe('CH')
  })
  it('does not pin words that contain them', () => {
    expect(findGazetteerPlace('The dundeex festival opens')).toBeNull()
  })
})

describe('second cities of the Nordics, Japan, South Korea and the Pacific get their own pins', () => {
  it('pins them in their own country', () => {
    expect(findGazetteerPlace('Fire in Esbjerg harbour')?.coords.country).toBe('DK')
    expect(findGazetteerPlace('Mine accident in Kiruna')?.coords.country).toBe('SE')
    expect(findGazetteerPlace('Strike in Luleå')?.coords.country).toBe('SE')
    expect(findGazetteerPlace('Quake shakes Shizuoka')?.coords.country).toBe('JP')
    expect(findGazetteerPlace('Protest in Hamamatsu')?.coords.country).toBe('JP')
    expect(findGazetteerPlace('Fire in Seongnam')?.coords.country).toBe('KR')
    expect(findGazetteerPlace('Typhoon hits Saipan')?.coords.country).toBe('MP')
    expect(findGazetteerPlace('Storm in Pago Pago')?.coords.country).toBe('AS')
  })
  it('does not pin words that contain them', () => {
    expect(findGazetteerPlace('The gifuu festival opens')).toBeNull()
  })
})

describe('small towns of Nigeria get their own pins', () => {
  it('pins them in Nigeria, at their own town', () => {
    expect(findGazetteerPlace('Igbokoda air crash: NAF recovers cockpit voice recorder')?.place).toBe('igbokoda')
    expect(findGazetteerPlace('Gunmen attack Kafanchan market')?.coords.country).toBe('NG')
    expect(findGazetteerPlace('Flood displaces families in Hadejia')?.coords.country).toBe('NG')
    expect(findGazetteerPlace('Students abducted near Ikare')?.coords.country).toBe('NG')
    expect(findGazetteerPlace('Fire guts market in Nnewi')?.coords.country).toBe('NG')
    expect(findGazetteerPlace('Lekki toll gate protest')?.coords.country).toBe('NG')
    expect(findGazetteerPlace('Sagamu residents protest')?.coords.country).toBe('NG')
  })
  it('does not pin words that contain them', () => {
    expect(findGazetteerPlace('The sagamux festival opens')).toBeNull()
  })
})

describe('metro communes and towns of South America get their own pins (M79)', () => {
  it('pins distinctive ones for any outlet', () => {
    expect(findGazetteerPlace('Inician desalojo en Ñuñoa')?.coords.country).toBe('CL')
    expect(findGazetteerPlace('Police in Nunoa arrested a man')?.coords.country).toBe('CL')
    expect(findGazetteerPlace('Choque en San Juan de Lurigancho')?.coords.country).toBe('PE')
    expect(findGazetteerPlace('Fire in Quilmes')?.coords.country).toBe('AR')
    expect(findGazetteerPlace('Tiroteo en Soacha')?.coords.country).toBe('CO')
    expect(findGazetteerPlace('Rescue in Puerto Ordaz')?.coords.country).toBe('VE')
  })
  it('reads names shared with a word, a person or a place only for their own country', () => {
    expect(homePlaceFromText('Inician desalojo de toma Nuevo Amanecer en Cerrillos', 'CL')?.name).toBe('Cerrillos')
    expect(homePlaceFromText('Choque en Maipú deja dos heridos', 'CL')?.countryCode).toBe('CL')
    expect(homePlaceFromText('Incendio en Tigre', 'AR')?.countryCode).toBe('AR')
    expect(homePlaceFromText('Inician desalojo de toma Nuevo Amanecer en Cerrillos', 'ES')).toBeNull()
    expect(findGazetteerPlace('Inician desalojo de toma Nuevo Amanecer en Cerrillos')).toBeNull()
  })
  it('does not read a footballer as a town', () => {
    expect(homePlaceFromText('Lautaro Martínez marcó dos goles', 'AR')).toBeNull()
    expect(findGazetteerPlace('Lautaro Martínez marcó dos goles')).toBeNull()
  })
})

describe('US air bases in England', () => {
  it('reads Lakenheath and Mildenhall as the Suffolk villages, not Suffolk in Virginia', () => {
    const p = findGazetteerPlace('RAF Lakenheath Sounds Alarm After Suspected Unauthorized Drone Activity')
    expect(p?.coords.country).toBe('GB')
    expect(p?.coords.name).toBe('Lakenheath')
    expect(findGazetteerPlace('Drones seen over RAF Mildenhall')?.coords.country).toBe('GB')
  })
})
