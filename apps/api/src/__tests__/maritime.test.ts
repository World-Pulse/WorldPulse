import { describe, it, expect } from 'vitest'

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
