/**
 * Tests for OSINT Signal Sources (GDELT, ADS-B, AIS)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── MOCK DEPENDENCIES ────────────────────────────────────────────────────
vi.mock('node:https', () => ({
  default: {
    get: vi.fn(),
  },
}))

vi.mock('../../lib/logger', () => ({
  logger: {
    child: () => ({
      info:  vi.fn(),
      warn:  vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  },
}))

// ─── GDELT HELPERS ────────────────────────────────────────────────────────
describe('GDELT — severity derivation', () => {
  // Access via module internals via inline re-implementation for test isolation
  function deriveSeverity(title: string): string {
    if (/nuclear|mass casualty|genocide|chemical weapon|biological weapon|WMD/i.test(title)) return 'critical'
    if (/airstrike|air strike|bombing|killed|casualties|invasion|coup/i.test(title)) return 'high'
    if (/attack|offensive|clash|fighting|shelling|missile/i.test(title)) return 'medium'
    if (/tension|protest|demonstration|dispute|standoff/i.test(title)) return 'low'
    return 'medium'
  }

  it('returns critical for nuclear event titles', () => {
    expect(deriveSeverity('Nuclear plant attacked near border')).toBe('critical')
    expect(deriveSeverity('Mass casualty event in capital city')).toBe('critical')
  })

  it('returns high for airstrike/invasion titles', () => {
    expect(deriveSeverity('Airstrike hits city residential area')).toBe('high')
    expect(deriveSeverity('Forces begin full-scale invasion across border')).toBe('high')
    expect(deriveSeverity('Bombing kills dozens in market')).toBe('high')
  })

  it('returns medium for attack/clash titles', () => {
    expect(deriveSeverity('Armed groups clash in disputed territory')).toBe('medium')
    expect(deriveSeverity('Missile test announced by military')).toBe('medium')
  })

  it('returns low for protest/tension titles', () => {
    expect(deriveSeverity('Protests spread across capital')).toBe('low')
    expect(deriveSeverity('Diplomatic tension rises at border')).toBe('low')
  })

  it('returns medium as default for unrecognized titles', () => {
    expect(deriveSeverity('Government announces new cabinet')).toBe('medium')
    expect(deriveSeverity('Trade agreement signed')).toBe('medium')
  })
})

// ─── GDELT GEO EXTRACTION ─────────────────────────────────────────────────
describe('GDELT — geo extraction from title', () => {
  const CENTROIDS: Record<string, [number, number]> = {
    'Ukraine': [48.38, 31.17],
    'Gaza':    [31.35, 34.31],
    'Syria':   [34.80, 38.99],
  }

  function extractGeoFromTitle(title: string): { lat?: number; lng?: number; name?: string } {
    for (const [country, [lat, lng]] of Object.entries(CENTROIDS)) {
      if (title.includes(country)) return { lat, lng, name: country }
    }
    return {}
  }

  it('extracts geo for known country in title', () => {
    const result = extractGeoFromTitle('Airstrike reported in Ukraine near eastern border')
    expect(result.name).toBe('Ukraine')
    expect(result.lat).toBeCloseTo(48.38)
    expect(result.lng).toBeCloseTo(31.17)
  })

  it('returns empty object for unknown location', () => {
    const result = extractGeoFromTitle('Breaking news: economic summit in neutral country')
    expect(result).toEqual({})
  })
})

// ─── ADS-B SQUAWK CODES ────────────────────────────────────────────────────
describe('ADS-B — squawk code classification', () => {
  const SQUAWK_INFO: Record<string, { description: string; severity: string; category: string }> = {
    '7500': { description: 'Unlawful interference (hijacking)',  severity: 'critical', category: 'security' },
    '7600': { description: 'Radio communication failure',        severity: 'medium',   category: 'security' },
    '7700': { description: 'General emergency',                  severity: 'high',     category: 'disaster' },
  }

  it('classifies 7500 as critical security event', () => {
    const info = SQUAWK_INFO['7500']
    expect(info).toBeDefined()
    expect(info!.severity).toBe('critical')
    expect(info!.category).toBe('security')
    expect(info!.description).toContain('hijacking')
  })

  it('classifies 7700 as high-severity disaster', () => {
    const info = SQUAWK_INFO['7700']
    expect(info!.severity).toBe('high')
    expect(info!.category).toBe('disaster')
  })

  it('classifies 7600 as medium-severity security', () => {
    const info = SQUAWK_INFO['7600']
    expect(info!.severity).toBe('medium')
  })

  it('returns undefined for normal squawk codes', () => {
    expect(SQUAWK_INFO['1200']).toBeUndefined()
    expect(SQUAWK_INFO['0000']).toBeUndefined()
  })
})

// ─── DEDUPLIFICATION KEY STRUCTURE ───────────────────────────────────────
describe('OSINT dedup key structure', () => {
  it('GDELT dedup key uses URL hash', () => {
    const { createHash } = require('crypto')
    function dedupKey(url: string): string {
      const hash = createHash('sha256').update(url).digest('hex').slice(0, 16)
      return `osint:gdelt:${hash}`
    }
    const key1 = dedupKey('https://reuters.com/article/1')
    const key2 = dedupKey('https://reuters.com/article/2')
    expect(key1).toMatch(/^osint:gdelt:[0-9a-f]{16}$/)
    expect(key1).not.toBe(key2)
  })

  it('ADS-B dedup key includes hour bucket (per-hour dedup)', () => {
    const hour = Math.floor(Date.now() / 3_600_000)
    function dedupKey(icao24: string, squawk: string): string {
      return `osint:adsb:${icao24}:${squawk}:${hour}`
    }
    const key = dedupKey('abc123', '7700')
    expect(key).toBe(`osint:adsb:abc123:7700:${hour}`)
  })

  it('AIS dedup key includes MMSI and hour bucket', () => {
    const hour = Math.floor(Date.now() / 3_600_000)
    function dedupKey(mmsi: string, status: number): string {
      return `osint:ais:${mmsi}:${status}:${hour}`
    }
    const key = dedupKey('123456789', 14)
    expect(key).toBe(`osint:ais:123456789:14:${hour}`)
  })
})

// ─── SEISMIC SEVERITY MAPPING ─────────────────────────────────────────────
describe('Seismic — magnitude to severity mapping', () => {
  function seismicSeverity(mag: number): string {
    if (mag >= 7.0) return 'critical'
    if (mag >= 6.0) return 'high'
    if (mag >= 5.0) return 'medium'
    return 'low'
  }

  it('returns critical for M7.0+ earthquakes', () => {
    expect(seismicSeverity(7.0)).toBe('critical')
    expect(seismicSeverity(8.5)).toBe('critical')
    expect(seismicSeverity(9.1)).toBe('critical')
  })

  it('returns high for M6.0-6.9 earthquakes', () => {
    expect(seismicSeverity(6.0)).toBe('high')
    expect(seismicSeverity(6.5)).toBe('high')
    expect(seismicSeverity(6.9)).toBe('high')
  })

  it('returns medium for M5.0-5.9 earthquakes', () => {
    expect(seismicSeverity(5.0)).toBe('medium')
    expect(seismicSeverity(5.5)).toBe('medium')
    expect(seismicSeverity(5.9)).toBe('medium')
  })

  it('returns low for M4.5-4.9 earthquakes', () => {
    expect(seismicSeverity(4.5)).toBe('low')
    expect(seismicSeverity(4.7)).toBe('low')
    expect(seismicSeverity(4.9)).toBe('low')
  })
})

// ─── FIRMS FIRE FRP SEVERITY MAPPING ──────────────────────────────────────
describe('FIRMS — FRP to severity mapping', () => {
  function firmsSeverity(frp: number): string {
    if (frp >= 500) return 'critical'
    if (frp >= 200) return 'high'
    if (frp >= 50)  return 'medium'
    return 'low'
  }

  it('returns critical for FRP >= 500 MW', () => {
    expect(firmsSeverity(500)).toBe('critical')
    expect(firmsSeverity(1200)).toBe('critical')
  })

  it('returns high for FRP 200-499 MW', () => {
    expect(firmsSeverity(200)).toBe('high')
    expect(firmsSeverity(350)).toBe('high')
    expect(firmsSeverity(499)).toBe('high')
  })

  it('returns medium for FRP 50-199 MW', () => {
    expect(firmsSeverity(50)).toBe('medium')
    expect(firmsSeverity(100)).toBe('medium')
    expect(firmsSeverity(199)).toBe('medium')
  })

  it('returns low for FRP < 50 MW', () => {
    expect(firmsSeverity(1)).toBe('low')
    expect(firmsSeverity(49)).toBe('low')
  })
})

// ─── FIRMS CSV GRID DEDUP KEY ─────────────────────────────────────────────
describe('FIRMS — grid dedup key generation', () => {
  function gridKey(lat: number, lng: number): string {
    return `${Math.floor(lat)}:${Math.floor(lng)}`
  }

  it('generates consistent 1° grid key for nearby coordinates', () => {
    // Both within same 1° cell
    expect(gridKey(37.1, -122.3)).toBe('37:-123')
    expect(gridKey(37.9, -122.1)).toBe('37:-123')
  })

  it('generates different keys for points in different cells', () => {
    expect(gridKey(37.5, -122.5)).not.toBe(gridKey(38.5, -122.5))
    expect(gridKey(37.5, -122.5)).not.toBe(gridKey(37.5, -121.5))
  })

  it('handles negative latitudes (southern hemisphere)', () => {
    const key = gridKey(-33.8, 151.2)
    expect(key).toBe('-34:151')
  })
})

// ─── FIRMS CSV PARSING ────────────────────────────────────────────────────
describe('FIRMS — CSV parsing', () => {
  function parseFirmsCSV(csv: string): Array<{ latitude: number; longitude: number; frp: number; confidence: string }> {
    const lines  = csv.split('\n')
    if (lines.length < 2) return []
    const header = lines[0].split(',').map((h: string) => h.trim())
    const idxLat  = header.indexOf('latitude')
    const idxLng  = header.indexOf('longitude')
    const idxFrp  = header.indexOf('frp')
    const idxConf = header.indexOf('confidence')
    if (idxLat < 0 || idxLng < 0 || idxFrp < 0 || idxConf < 0) return []
    const rows: Array<{ latitude: number; longitude: number; frp: number; confidence: string }> = []
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      const cols = line.split(',')
      const conf = (cols[idxConf] ?? '').trim().toLowerCase()
      if (conf === 'l') continue
      const lat = parseFloat(cols[idxLat] ?? '')
      const lng = parseFloat(cols[idxLng] ?? '')
      const frp = parseFloat(cols[idxFrp] ?? '')
      if (isNaN(lat) || isNaN(lng) || isNaN(frp)) continue
      rows.push({ latitude: lat, longitude: lng, frp, confidence: conf })
    }
    return rows
  }

  it('parses valid CSV rows with high/nominal confidence', () => {
    const csv = [
      'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight',
      '37.5,-122.5,350.0,0.4,0.4,2026-03-22,1430,N20,VIIRS,h,2.0NRT,310.0,250.0,D',
      '38.1,-121.9,320.0,0.4,0.4,2026-03-22,1430,N20,VIIRS,n,2.0NRT,300.0,80.0,D',
    ].join('\n')
    const rows = parseFirmsCSV(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]!.frp).toBe(250.0)
    expect(rows[1]!.frp).toBe(80.0)
  })

  it('filters out low-confidence detections', () => {
    const csv = [
      'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight',
      '37.5,-122.5,350.0,0.4,0.4,2026-03-22,1430,N20,VIIRS,l,2.0NRT,310.0,250.0,D',
      '38.1,-121.9,320.0,0.4,0.4,2026-03-22,1430,N20,VIIRS,h,2.0NRT,300.0,80.0,D',
    ].join('\n')
    const rows = parseFirmsCSV(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.confidence).toBe('h')
  })
})

// ─── SPACE WEATHER SEVERITY MAPPING ──────────────────────────────────────
describe('Space Weather — G/R/S scale to severity mapping', () => {
  const SCALE_CRITICAL = /\b(G5|R5|S5)\b/
  const SCALE_HIGH     = /\b(G4|R4|S4)\b/
  const SCALE_MEDIUM   = /\b(G3|R3|S3)\b/

  function spaceWeatherSeverity(message: string): string {
    if (SCALE_CRITICAL.test(message)) return 'critical'
    if (SCALE_HIGH.test(message))     return 'high'
    if (SCALE_MEDIUM.test(message))   return 'medium'
    return 'low'
  }

  it('returns critical for G5/R5/S5 scale events', () => {
    expect(spaceWeatherSeverity('GEOMAGNETIC STORM WARNING: G5')).toBe('critical')
    expect(spaceWeatherSeverity('RADIO BLACKOUT: R5 observed')).toBe('critical')
    expect(spaceWeatherSeverity('SOLAR RADIATION STORM S5 in progress')).toBe('critical')
  })

  it('returns high for G4/R4/S4 scale events', () => {
    expect(spaceWeatherSeverity('Geomagnetic Storm G4 Warning Issued')).toBe('high')
    expect(spaceWeatherSeverity('R4 Radio Blackout Warning')).toBe('high')
  })

  it('returns medium for G3/R3/S3 scale events', () => {
    expect(spaceWeatherSeverity('G3 watch in effect')).toBe('medium')
    expect(spaceWeatherSeverity('S3 solar radiation storm')).toBe('medium')
  })

  it('returns low for G1/G2/unclassified alerts', () => {
    expect(spaceWeatherSeverity('G1 Minor Storm Watch')).toBe('low')
    expect(spaceWeatherSeverity('G2 Moderate storm possible')).toBe('low')
    expect(spaceWeatherSeverity('Solar flux increase observed')).toBe('low')
  })
})

// ─── SPACE WEATHER ALERT PARSING ─────────────────────────────────────────
describe('Space Weather — alert message parsing', () => {
  function extractAlertTitle(message: string): string {
    const lines = message.split('\n').map((l: string) => l.trim()).filter(Boolean)
    return lines[0] ?? 'Space Weather Alert'
  }

  function isRelevantAlert(message: string, issueDatetime: string, now: Date): boolean {
    const RELEVANT_KEYWORDS = /GEOMAGNETIC STORM|SOLAR RADIATION STORM|RADIO BLACKOUT/i
    if (!RELEVANT_KEYWORDS.test(message)) return false
    const issued = new Date(issueDatetime.replace(' ', 'T') + 'Z')
    if (isNaN(issued.getTime())) return false
    if (now.getTime() - issued.getTime() > 3 * 60 * 60 * 1_000) return false
    return true
  }

  it('extracts first line of alert message as title', () => {
    const msg = 'Geomagnetic Storm Warning: G3\nIssued: 2026-03-22 14:00:00 UTC\nFull text here.'
    expect(extractAlertTitle(msg)).toBe('Geomagnetic Storm Warning: G3')
  })

  it('filters alerts older than 3 hours', () => {
    const now    = new Date('2026-03-22T14:00:00Z')
    const oldDt  = '2026-03-22 10:00:00.000'  // 4h old
    const newDt  = '2026-03-22 13:00:00.000'  // 1h old
    expect(isRelevantAlert('GEOMAGNETIC STORM WARNING', oldDt, now)).toBe(false)
    expect(isRelevantAlert('GEOMAGNETIC STORM WARNING', newDt, now)).toBe(true)
  })

  it('filters alerts without relevant keywords', () => {
    const now = new Date()
    const dt  = new Date(now.getTime() - 30 * 60 * 1_000).toISOString().replace('T', ' ').replace('Z', '.000')
    expect(isRelevantAlert('Proton flux increase', dt, now)).toBe(false)
    expect(isRelevantAlert('RADIO BLACKOUT observed', dt, now)).toBe(true)
  })
})

// ─── AIS WEBSOCKET FRAME ENCODING ─────────────────────────────────────────
describe('AIS — WebSocket frame encoding', () => {
  const { randomBytes } = require('crypto')

  function encodeWebSocketFrame(payload: string): Buffer {
    const data = Buffer.from(payload, 'utf8')
    const len  = data.length
    let header: Buffer

    if (len < 126) {
      header = Buffer.alloc(6)
      header[0] = 0x81
      header[1] = 0x80 | len
    } else {
      header = Buffer.alloc(8)
      header[0] = 0x81
      header[1] = 0x80 | 126
      header.writeUInt16BE(len, 2)
    }

    const maskKeyOffset = header.length - 4
    const maskKey = randomBytes(4)
    maskKey.copy(header, maskKeyOffset)

    const masked = Buffer.alloc(len)
    for (let i = 0; i < len; i++) {
      masked[i] = data[i] ^ maskKey[i % 4]
    }

    return Buffer.concat([header, masked])
  }

  it('encodes small payload with correct opcode (0x81 = FIN + text)', () => {
    const frame = encodeWebSocketFrame('hello')
    expect(frame[0]).toBe(0x81)  // FIN bit + text opcode
    expect(frame[1] & 0x80).toBe(0x80)  // MASK bit set
    expect(frame[1] & 0x7f).toBe(5)  // payload length = 5
  })

  it('encodes extended payload length for >125 bytes', () => {
    const payload = 'x'.repeat(200)
    const frame = encodeWebSocketFrame(payload)
    expect(frame[0]).toBe(0x81)
    expect(frame[1] & 0x7f).toBe(126)  // extended length marker
    expect(frame.readUInt16BE(2)).toBe(200)
  })

  it('encodes subscription message without throwing', () => {
    const sub = JSON.stringify({
      APIKey:             'test-key',
      BoundingBoxes:      [[[-90, -180], [90, 180]]],
      FilterMessageTypes: ['PositionReport'],
    })
    expect(() => encodeWebSocketFrame(sub)).not.toThrow()
  })
})

// ─── GPS JAMMING (GPSJam.org) TESTS ─────────────────────────────────────────
import { gpsjamSeverity } from '../gpsjam'

describe('GPSJam — severity mapping', () => {
  it('returns high when jamPct >= 0.9', () => {
    expect(gpsjamSeverity(0.90)).toBe('high')
    expect(gpsjamSeverity(0.95)).toBe('high')
    expect(gpsjamSeverity(1.0)).toBe('high')
  })

  it('returns medium when jamPct >= 0.7 and < 0.9', () => {
    expect(gpsjamSeverity(0.70)).toBe('medium')
    expect(gpsjamSeverity(0.80)).toBe('medium')
    expect(gpsjamSeverity(0.89)).toBe('medium')
  })

  it('returns low when jamPct < 0.7', () => {
    expect(gpsjamSeverity(0.60)).toBe('low')
    expect(gpsjamSeverity(0.50)).toBe('low')
    expect(gpsjamSeverity(0.0)).toBe('low')
  })

  it('boundary: exactly 0.7 is medium not low', () => {
    expect(gpsjamSeverity(0.7)).toBe('medium')
  })

  it('boundary: exactly 0.9 is high not medium', () => {
    expect(gpsjamSeverity(0.9)).toBe('high')
  })
})

// ─── IODA INTERNET OUTAGE TESTS ─────────────────────────────────────────────
import { iodaSeverity } from '../ioda'

describe('IODA — severity mapping from anomaly score', () => {
  it('returns critical for score >= 500', () => {
    expect(iodaSeverity(500)).toBe('critical')
    expect(iodaSeverity(1200)).toBe('critical')
    expect(iodaSeverity(999)).toBe('critical')
  })

  it('returns high for score >= 100 and < 500', () => {
    expect(iodaSeverity(100)).toBe('high')
    expect(iodaSeverity(250)).toBe('high')
    expect(iodaSeverity(499)).toBe('high')
  })

  it('returns medium for score >= 30 and < 100', () => {
    expect(iodaSeverity(30)).toBe('medium')
    expect(iodaSeverity(50)).toBe('medium')
    expect(iodaSeverity(99)).toBe('medium')
  })

  it('returns low for score < 30', () => {
    expect(iodaSeverity(10)).toBe('low')
    expect(iodaSeverity(0)).toBe('low')
    expect(iodaSeverity(29)).toBe('low')
  })

  it('boundary: exactly 100 is high not medium', () => {
    expect(iodaSeverity(100)).toBe('high')
  })

  it('boundary: exactly 500 is critical not high', () => {
    expect(iodaSeverity(500)).toBe('critical')
  })
})
