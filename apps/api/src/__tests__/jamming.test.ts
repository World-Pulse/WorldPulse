import { describe, it, expect } from 'vitest'

import {
  JAMMING_CACHE_TTL,
  JAMMING_RATE_LIMIT,
  JAMMING_CACHE_KEY,
  classifyJammingType,
  jammingRadius,
  jammingAffectedSystems,
  jammingConfidence,
  jammingSeverityLabel,
  parseJammingZone,
  jammingDedupKey,
} from '../routes/jamming'

// ─── Cache TTL ────────────────────────────────────────────────────────────────

describe('JAMMING_CACHE_TTL', () => {
  it('equals 300 seconds (5 minutes)', () => {
    expect(JAMMING_CACHE_TTL).toBe(300)
  })
})

// ─── Rate limit ───────────────────────────────────────────────────────────────

describe('JAMMING_RATE_LIMIT', () => {
  it('equals 30 requests per minute', () => {
    expect(JAMMING_RATE_LIMIT).toBe(30)
  })
})

// ─── Cache key ────────────────────────────────────────────────────────────────

describe('JAMMING_CACHE_KEY', () => {
  it('is "jamming:zones"', () => {
    expect(JAMMING_CACHE_KEY).toBe('jamming:zones')
  })

  it('follows namespace:resource format', () => {
    expect(JAMMING_CACHE_KEY).toMatch(/^[a-z]+:[a-z]+$/)
  })
})

// ─── classifyJammingType ──────────────────────────────────────────────────────

describe('classifyJammingType', () => {
  it('returns military from jamming_type:military tag', () => {
    expect(classifyJammingType(['osint', 'jamming_type:military'], 'GPS Jamming')).toBe('military')
  })

  it('returns spoofing from jamming_type:spoofing tag', () => {
    expect(classifyJammingType(['gps_jamming', 'jamming_type:spoofing'], 'GPS Spoofing')).toBe('spoofing')
  })

  it('returns civilian from jamming_type:civilian tag', () => {
    expect(classifyJammingType(['jamming_type:civilian'], 'GPS Interference')).toBe('civilian')
  })

  it('returns unknown from jamming_type:unknown tag', () => {
    expect(classifyJammingType(['jamming_type:unknown'], 'GPS Anomaly')).toBe('unknown')
  })

  it('falls back to title — detects spoof keyword', () => {
    expect(classifyJammingType([], 'GPS Spoofing detected over Persian Gulf')).toBe('spoofing')
  })

  it('falls back to title — detects deception keyword', () => {
    expect(classifyJammingType([], 'GPS Deception operation near Strait of Hormuz')).toBe('spoofing')
  })

  it('falls back to title — detects military EW keyword', () => {
    expect(classifyJammingType([], 'GPS Jamming (Military EW) — Ukraine front lines')).toBe('military')
  })

  it('falls back to title — detects Russia keyword', () => {
    expect(classifyJammingType([], 'GNSS Degradation linked to Russia Kaliningrad EW')).toBe('military')
  })

  it('falls back to title — detects DPRK/North Korea keyword', () => {
    expect(classifyJammingType([], 'DPRK GPS jamming near Korean DMZ')).toBe('military')
  })

  it('falls back to title — detects civilian interference keyword', () => {
    expect(classifyJammingType([], 'GPS Interference (Civilian) — industrial district')).toBe('civilian')
  })

  it('returns unknown when no classification matches', () => {
    expect(classifyJammingType([], 'GPS Anomaly detected')).toBe('unknown')
  })

  it('tag takes precedence over conflicting title keywords', () => {
    // Tag says civilian, title says military — tag wins
    expect(classifyJammingType(['jamming_type:civilian'], 'GPS Jamming Military EW')).toBe('civilian')
  })
})

// ─── jammingSeverityLabel ─────────────────────────────────────────────────────

describe('jammingSeverityLabel', () => {
  it('returns critical for spoofing type regardless of jam probability', () => {
    expect(jammingSeverityLabel(0.5, 'spoofing')).toBe('critical')
    expect(jammingSeverityLabel(0.1, 'spoofing')).toBe('critical')
  })

  it('returns critical for military type with jamPct >= 0.92', () => {
    expect(jammingSeverityLabel(0.92, 'military')).toBe('critical')
    expect(jammingSeverityLabel(1.0,  'military')).toBe('critical')
  })

  it('returns high for military type with 0.75 <= jamPct < 0.92', () => {
    expect(jammingSeverityLabel(0.75, 'military')).toBe('high')
    expect(jammingSeverityLabel(0.85, 'military')).toBe('high')
    expect(jammingSeverityLabel(0.91, 'military')).toBe('high')
  })

  it('returns high for any type with jamPct >= 0.85', () => {
    expect(jammingSeverityLabel(0.85, 'civilian')).toBe('high')
    expect(jammingSeverityLabel(0.90, 'unknown')).toBe('high')
  })

  it('returns medium for civilian type', () => {
    expect(jammingSeverityLabel(0.55, 'civilian')).toBe('medium')
    expect(jammingSeverityLabel(0.64, 'civilian')).toBe('medium')
  })

  it('returns medium for jamPct >= 0.65', () => {
    expect(jammingSeverityLabel(0.65, 'unknown')).toBe('medium')
    expect(jammingSeverityLabel(0.70, 'unknown')).toBe('medium')
  })

  it('returns low for low-confidence unclassified events', () => {
    expect(jammingSeverityLabel(0.50, 'unknown')).toBe('low')
    expect(jammingSeverityLabel(0.60, 'unknown')).toBe('low')
  })

  it('severity ordering: critical > high > medium > low exists for military', () => {
    // Verify the ordering makes sense by checking a cross-section
    expect(jammingSeverityLabel(1.00, 'military')).toBe('critical')
    expect(jammingSeverityLabel(0.80, 'military')).toBe('high')
    expect(jammingSeverityLabel(0.65, 'civilian')).toBe('medium')
    expect(jammingSeverityLabel(0.50, 'unknown')).toBe('low')
  })
})

// ─── parseJammingZone ─────────────────────────────────────────────────────────

describe('parseJammingZone', () => {
  it('parses a GeoJSON Point geometry', () => {
    const result = parseJammingZone({ type: 'Point', coordinates: [36.5, 34.5] })
    expect(result).toEqual([36.5, 34.5])
  })

  it('parses a GeoJSON Polygon geometry and returns centroid', () => {
    const result = parseJammingZone({
      type: 'Polygon',
      coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
    })
    expect(result).not.toBeNull()
    const [lng, lat] = result!
    expect(lng).toBeCloseTo(0.8, 1) // avg of [0,2,2,0,0] = 4/5 = 0.8
    expect(lat).toBeCloseTo(0.8, 1)
  })

  it('returns null for an empty polygon ring', () => {
    expect(parseJammingZone({ type: 'Polygon', coordinates: [[]] })).toBeNull()
  })

  it('returns null for non-finite coordinates', () => {
    expect(parseJammingZone({ type: 'Point', coordinates: [Infinity, 34.5] })).toBeNull()
    expect(parseJammingZone({ type: 'Point', coordinates: [NaN, 34.5] })).toBeNull()
  })

  it('returns null for unknown geometry type', () => {
    expect(parseJammingZone({ type: 'LineString', coordinates: [[0, 0], [1, 1]] })).toBeNull()
  })

  it('returns null when coordinates array is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseJammingZone({ type: 'Point', coordinates: null as any })).toBeNull()
  })
})

// ─── jammingDedupKey ──────────────────────────────────────────────────────────

describe('jammingDedupKey', () => {
  it('generates a stable key for a given lng/lat', () => {
    expect(jammingDedupKey(36.5, 34.5)).toBe('gnss:jam:37:35')
  })

  it('rounds fractional coordinates to nearest degree', () => {
    expect(jammingDedupKey(36.4, 34.4)).toBe('gnss:jam:36:34')
    expect(jammingDedupKey(36.6, 34.6)).toBe('gnss:jam:37:35')
  })

  it('two nearby points within 0.5° share the same key', () => {
    expect(jammingDedupKey(36.2, 34.2)).toBe(jammingDedupKey(36.3, 34.3))
  })

  it('negative coordinates are handled correctly', () => {
    expect(jammingDedupKey(-20.5, -55.5)).toBe('gnss:jam:-21:-56')
  })

  it('starts with gnss:jam: prefix for namespace isolation', () => {
    expect(jammingDedupKey(0, 0)).toMatch(/^gnss:jam:/)
  })
})

// ─── jammingRadius ────────────────────────────────────────────────────────────

describe('jammingRadius', () => {
  it('returns 250 km for critical severity', () => {
    expect(jammingRadius('critical')).toBe(250)
  })

  it('returns 150 km for high severity', () => {
    expect(jammingRadius('high')).toBe(150)
  })

  it('returns 80 km for medium severity', () => {
    expect(jammingRadius('medium')).toBe(80)
  })

  it('returns 40 km for low severity', () => {
    expect(jammingRadius('low')).toBe(40)
  })

  it('returns default 60 km for unknown severity', () => {
    expect(jammingRadius('unknown')).toBe(60)
  })

  it('is case-insensitive', () => {
    expect(jammingRadius('CRITICAL')).toBe(250)
    expect(jammingRadius('High')).toBe(150)
  })

  it('radius decreases with severity: critical > high > medium > low', () => {
    expect(jammingRadius('critical')).toBeGreaterThan(jammingRadius('high'))
    expect(jammingRadius('high')).toBeGreaterThan(jammingRadius('medium'))
    expect(jammingRadius('medium')).toBeGreaterThan(jammingRadius('low'))
  })
})

// ─── jammingAffectedSystems ───────────────────────────────────────────────────

describe('jammingAffectedSystems', () => {
  it('returns spoofing-specific systems for spoofing type', () => {
    const systems = jammingAffectedSystems('spoofing', 'critical')
    expect(systems).toContain('Aviation GPS (position deception)')
    expect(systems).toContain('Maritime AIS positioning')
  })

  it('includes Civilian GPS receivers for military type', () => {
    const systems = jammingAffectedSystems('military', 'high')
    expect(systems).toContain('Civilian GPS receivers')
  })

  it('includes commercial aviation for military critical/high severity', () => {
    const systemsCritical = jammingAffectedSystems('military', 'critical')
    const systemsHigh     = jammingAffectedSystems('military', 'high')
    expect(systemsCritical).toContain('Commercial aviation approach procedures')
    expect(systemsHigh).toContain('Commercial aviation approach procedures')
  })

  it('returns non-empty array for every type/severity combination', () => {
    const types:      Array<'military' | 'spoofing' | 'civilian' | 'unknown'> = ['military', 'spoofing', 'civilian', 'unknown']
    const severities: string[] = ['critical', 'high', 'medium', 'low']
    for (const t of types) {
      for (const s of severities) {
        expect(jammingAffectedSystems(t, s).length).toBeGreaterThan(0)
      }
    }
  })
})

// ─── jammingConfidence ────────────────────────────────────────────────────────

describe('jammingConfidence', () => {
  it('converts 0.78 reliability score to 78%', () => {
    expect(jammingConfidence(0.78)).toBe(78)
  })

  it('converts 1.0 to 100%', () => {
    expect(jammingConfidence(1.0)).toBe(100)
  })

  it('converts 0.0 to 0%', () => {
    expect(jammingConfidence(0.0)).toBe(0)
  })

  it('defaults null to 50%', () => {
    expect(jammingConfidence(null)).toBe(50)
  })

  it('clamps values above 1.0 to 100', () => {
    expect(jammingConfidence(1.5)).toBe(100)
  })

  it('clamps negative values to 0', () => {
    expect(jammingConfidence(-0.1)).toBe(0)
  })
})
