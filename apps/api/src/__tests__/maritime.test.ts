import { describe, it, expect, vi } from 'vitest'

// The route module opens the database when it loads, and a failed connection
// ended the test run with process.exit(1); these tests only check its functions
vi.mock('../db/postgres', () => ({ db: {} }))
vi.mock('../db/redis', () => ({ redis: {} }))

import {
  MARITIME_CACHE_TTL,
  MARITIME_RATE_LIMIT,
  MARITIME_CACHE_KEY,
  classifyVesselType,
  parseFleetFromTitle,
  isValidCoordinate,
  CARRIER_REGISTRY_ALIASES,
} from '../routes/maritime'

// ─── Cache TTL ───────────────────────────────────────────────────────────────

describe('MARITIME_CACHE_TTL', () => {
  it('equals 300 seconds (5 minutes)', () => {
    expect(MARITIME_CACHE_TTL).toBe(300)
  })
})

// ─── Rate limit ───────────────────────────────────────────────────────────────

describe('MARITIME_RATE_LIMIT', () => {
  it('equals 30 requests per minute', () => {
    expect(MARITIME_RATE_LIMIT).toBe(30)
  })
})

// ─── Cache key ────────────────────────────────────────────────────────────────

describe('MARITIME_CACHE_KEY', () => {
  it('is "maritime:vessels"', () => {
    expect(MARITIME_CACHE_KEY).toBe('maritime:vessels')
  })

  it('follows namespace:resource format', () => {
    expect(MARITIME_CACHE_KEY).toMatch(/^[a-z]+:[a-z]+$/)
  })
})

// ─── Vessel type classification ───────────────────────────────────────────────

describe('classifyVesselType', () => {
  it('classifies military signal with hull number as carrier', () => {
    expect(classifyVesselType('USS Gerald R. Ford (CVN-78): Port Departure', 'military')).toBe('carrier')
  })

  it('classifies military signal with carrier alias as carrier', () => {
    expect(classifyVesselType('Nimitz carrier strike group exercises in Pacific', 'military')).toBe('carrier')
  })

  it('classifies military signal with CVN abbreviation as carrier', () => {
    expect(classifyVesselType('CVN-75 Harry Truman deployment to Mediterranean', 'military')).toBe('carrier')
  })

  it('classifies military signal without carrier match as vessel', () => {
    expect(classifyVesselType('US Navy destroyer patrol in South China Sea', 'military')).toBe('vessel')
  })

  it('classifies maritime signal with dark ship keyword as dark_ship', () => {
    expect(classifyVesselType('Dark ship detected near Strait of Hormuz — AIS off', 'maritime')).toBe('dark_ship')
  })

  it('classifies maritime signal with transponder disabled as dark_ship', () => {
    expect(classifyVesselType('Vessel transponder disabled entering contested waters', 'maritime')).toBe('dark_ship')
  })

  it('classifies maritime signal with ais gap as dark_ship', () => {
    expect(classifyVesselType('Supertanker with AIS gap of 12 hours in Red Sea', 'maritime')).toBe('dark_ship')
  })

  it('classifies standard AIS distress signal as vessel', () => {
    expect(classifyVesselType('AIS distress signal: vessel in trouble near Malta', 'maritime')).toBe('vessel')
  })

  it('does not classify maritime signal as carrier even if carrier name appears', () => {
    // "maritime" category signals should never be carriers
    expect(classifyVesselType('CVN-78 spotted via AIS distress relay', 'maritime')).toBe('vessel')
  })

  it('classifies unknown category signal as vessel', () => {
    expect(classifyVesselType('Unknown vessel movement', 'other')).toBe('vessel')
  })
})

// ─── Fleet parsing ────────────────────────────────────────────────────────────

describe('parseFleetFromTitle', () => {
  it('returns fleet for Ford-class by hull number', () => {
    expect(parseFleetFromTitle('USS Gerald R. Ford (CVN-78): Deployment')).toBe('Atlantic Fleet / 2nd Fleet')
  })

  it('returns fleet for George Washington by alias', () => {
    expect(parseFleetFromTitle('USS George Washington (GW) arrives Yokosuka')).toBe('7th Fleet')
  })

  it('returns Pacific Fleet for Theodore Roosevelt', () => {
    expect(parseFleetFromTitle('CVN-71 Theodore Roosevelt transiting Pacific')).toBe('Pacific Fleet / 3rd Fleet')
  })

  it('returns Pacific Fleet for Nimitz', () => {
    expect(parseFleetFromTitle('Nimitz carrier strike group exercise')).toBe('Pacific Fleet / 3rd Fleet')
  })

  it('returns Atlantic Fleet for Eisenhower', () => {
    expect(parseFleetFromTitle('Ike (CVN-69) departs Norfolk for Mediterranean deployment')).toBe('Atlantic Fleet / 2nd Fleet')
  })

  it('returns null when no carrier match found', () => {
    expect(parseFleetFromTitle('Unknown vessel in Red Sea')).toBeNull()
  })

  it('returns null for empty title', () => {
    expect(parseFleetFromTitle('')).toBeNull()
  })

  it('matches case-insensitively', () => {
    expect(parseFleetFromTitle('uss nimitz carrier strike group')).toBe('Pacific Fleet / 3rd Fleet')
  })
})

// ─── Coordinate validation ────────────────────────────────────────────────────

describe('isValidCoordinate', () => {
  it('accepts valid mid-ocean coordinates', () => {
    expect(isValidCoordinate(35.0, 18.0)).toBe(true)
  })

  it('accepts negative coordinates (South Atlantic)', () => {
    expect(isValidCoordinate(-30.0, -15.0)).toBe(true)
  })

  it('rejects (0, 0) as invalid null island', () => {
    expect(isValidCoordinate(0, 0)).toBe(false)
  })

  it('rejects lat > 90', () => {
    expect(isValidCoordinate(91.0, 0.0)).toBe(false)
  })

  it('rejects lat < -90', () => {
    expect(isValidCoordinate(-91.0, 0.0)).toBe(false)
  })

  it('rejects lng > 180', () => {
    expect(isValidCoordinate(0.0, 181.0)).toBe(false)
  })

  it('rejects lng < -180', () => {
    expect(isValidCoordinate(0.0, -181.0)).toBe(false)
  })

  it('rejects NaN lat', () => {
    expect(isValidCoordinate(NaN, 10.0)).toBe(false)
  })

  it('rejects NaN lng', () => {
    expect(isValidCoordinate(10.0, NaN)).toBe(false)
  })

  it('rejects Infinity', () => {
    expect(isValidCoordinate(Infinity, 10.0)).toBe(false)
  })

  it('accepts boundary coordinates (+/-90 lat, +/-180 lng)', () => {
    expect(isValidCoordinate(90, 180)).toBe(true)
    expect(isValidCoordinate(-90, -180)).toBe(true)
  })
})

// ─── CARRIER_REGISTRY_ALIASES completeness ────────────────────────────────────

describe('CARRIER_REGISTRY_ALIASES', () => {
  it('covers all 11 active US Navy carriers', () => {
    expect(CARRIER_REGISTRY_ALIASES).toHaveLength(11)
  })

  it('every entry has hull, name, fleet, and aliases', () => {
    for (const entry of CARRIER_REGISTRY_ALIASES) {
      expect(entry.hull).toBeTruthy()
      expect(entry.name).toBeTruthy()
      expect(entry.fleet).toBeTruthy()
      expect(Array.isArray(entry.aliases)).toBe(true)
      expect(entry.aliases.length).toBeGreaterThan(0)
    }
  })

  it('all hulls follow CVN-NN format', () => {
    for (const entry of CARRIER_REGISTRY_ALIASES) {
      expect(entry.hull).toMatch(/^CVN-\d{2}$/)
    }
  })

  it('no duplicate hull numbers', () => {
    const hulls = CARRIER_REGISTRY_ALIASES.map(e => e.hull)
    expect(new Set(hulls).size).toBe(hulls.length)
  })
})

// ─── Oct 19, 2026: ship and naval stories found by their headlines ─────────────
import { NAVAL_HEADLINE } from '../routes/maritime'
import { MARITIME_HEADLINE, NAVAL_SHIP_NAME, NOT_AT_SEA, ROAD_TANKER, TANKER_AT_SEA, TANKER_HEADLINE, firstOfEach, headlineKey } from '../lib/sea-headlines'

/** PostgreSQL's word edges (\m, \M) as JavaScript's \b, for a check of the patterns */
const asJs = (pg: string, flags = 'i') => new RegExp(pg.replace(/\\m/g, '\\b').replace(/\\M/g, '\\b'), flags)

/** The Ships layer's filter, as GET /signals/map/maritime runs it */
const shipNews = (t: string) => !asJs(NOT_AT_SEA).test(t) &&
  (asJs(MARITIME_HEADLINE).test(t) || (asJs(TANKER_HEADLINE).test(t) && asJs(TANKER_AT_SEA).test(t) && !asJs(ROAD_TANKER).test(t)))
/** The Naval intelligence layer's, as GET /maritime/vessels runs it (ship names case-sensitive) */
const navalNews = (t: string) => !asJs(NOT_AT_SEA).test(t) && (asJs(NAVAL_HEADLINE).test(t) || asJs(NAVAL_SHIP_NAME, '').test(t))

describe('headline patterns (the categories "maritime" and "military" are no longer used)', () => {
  it('ship news: ships, tankers, ferries, straits, ports; not reports, supporters or Port Harcourt', () => {
    for (const t of ['Tanker attacked in the Red Sea', 'Ferry capsizes off Bali', 'US Navy destroyer in the Taiwan Strait', 'Ukraine hits port in Primorsk', 'Shipping rates jump']) expect(shipNews(t)).toBe(true)
    for (const t of ['Report: support for strike grows', 'Port Harcourt traffic jam', 'Southampton sign striker']) expect(shipNews(t)).toBe(false)
  })

  it('a tanker is a ship only when the headline makes it one: not a road fuel or water tanker', () => {
    for (const t of ['Oil tanker on fire after hitting mine in Hormuz', 'France seizes fifth Russian shadow tanker', 'VLCC Tanker Rates Retreated Last Week', "Gunmen fire on tanker off Yemen's coast"]) expect(shipNews(t)).toBe(true)
    for (const t of ['Tanker explosion claims two lives under Otedola Bridge', 'Malawi: 287 Fuel Tankers Expected in Malawi This Week', 'Water tanker rates go up again', 'Tanker crushes five Oyo residents']) expect(shipNews(t)).toBe(false)
  })

  it('leaves out phrases that are not about the sea', () => {
    for (const t of ['Team discovers key pathway in heart lymphatic vessel development', 'Flagship GPU will continue shipping', 'MMAG disposes a freighter aircraft', "Smoke across Auckland's Upper Harbour Motorway", "Officer killed before UTSA's game against Navy", '2027: DLA gov’ship candidates endorse Tinubu']) expect(shipNews(t)).toBe(false)
  })

  it('naval news: navies, warships, named carriers; not break-ins or a retired officer', () => {
    for (const t of ['USS Gerald R. Ford leaves Norfolk', 'Chinese warships near Taiwan', 'Royal Navy frigate shadows Russian submarine', 'Dark ship spotted near Hormuz', 'INS Trishul arrives in Lisbon']) expect(navalNews(t)).toBe(true)
    for (const t of ['Navigation app update', 'Insurance rates rise', 'Three teens charged after string of business break-ins', 'Retired Navy commodore files for congress']) expect(navalNews(t)).toBe(false)
  })

  it('the same headline shows once (the first, the newest)', () => {
    const rows = [{ id: 1, t: 'Iran says two tankers catch fire' }, { id: 2, t: 'IRAN says two tankers catch fire!' }, { id: 3, t: 'Taiwan drives away 16 ships' }]
    expect(firstOfEach(rows, r => headlineKey(r.t)).map(r => r.id)).toEqual([1, 3])
  })

  it('a named carrier is a carrier whatever its category', () => {
    expect(classifyVesselType('USS Nimitz heads to the Gulf', 'conflict', true)).toBe('carrier')
    expect(classifyVesselType('USS Nimitz heads to the Gulf', 'conflict')).toBe('vessel')
  })
})
