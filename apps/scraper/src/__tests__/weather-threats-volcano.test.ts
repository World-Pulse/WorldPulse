/**
 * Tests for NWS Weather Alerts, OTX Threat Intelligence, and GVP Volcano feeds
 * Covers severity mapping, location inference, and edge cases
 */

import { describe, it, expect } from 'vitest'
import { nwsSeverity, extractNwsLocation } from '../sources/nws-alerts'
import { otxSeverity, inferThreatRegion } from '../sources/otx-threats'
import { volcanoSeverity, lookupVolcanoCoords } from '../sources/gvp-volcano'

// ─── NWS SEVERITY TESTS ────────────────────────────────────────────────────

describe('nwsSeverity', () => {
  it('returns critical for Tornado Warning regardless of CAP severity', () => {
    expect(nwsSeverity('Severe', 'Tornado Warning', 'Immediate')).toBe('critical')
  })

  it('returns critical for Hurricane Warning', () => {
    expect(nwsSeverity('Extreme', 'Hurricane Warning', 'Immediate')).toBe('critical')
  })

  it('returns critical for Tsunami Warning', () => {
    expect(nwsSeverity('Extreme', 'Tsunami Warning', 'Immediate')).toBe('critical')
  })

  it('returns critical for Flash Flood Emergency', () => {
    expect(nwsSeverity('Extreme', 'Flash Flood Emergency', 'Immediate')).toBe('critical')
  })

  it('returns high for Severe Thunderstorm Warning', () => {
    expect(nwsSeverity('Severe', 'Severe Thunderstorm Warning', 'Immediate')).toBe('high')
  })

  it('returns high for Blizzard Warning', () => {
    expect(nwsSeverity('Severe', 'Blizzard Warning', 'Expected')).toBe('high')
  })

  it('returns high for Tornado Watch', () => {
    expect(nwsSeverity('Moderate', 'Tornado Watch', 'Expected')).toBe('high')
  })

  it('bumps severity for Immediate urgency', () => {
    expect(nwsSeverity('Severe', 'Wind Advisory', 'Immediate')).toBe('critical')
  })

  it('maps Extreme CAP severity to critical', () => {
    expect(nwsSeverity('Extreme', 'Extreme Cold Warning', 'Expected')).toBe('critical')
  })

  it('maps Moderate CAP severity to medium', () => {
    expect(nwsSeverity('Moderate', 'Heat Advisory', 'Expected')).toBe('medium')
  })

  it('defaults to medium for unknown CAP severity', () => {
    expect(nwsSeverity('Unknown', 'Special Weather Statement', 'Future')).toBe('medium')
  })
})

// ─── NWS LOCATION TESTS ────────────────────────────────────────────────────

describe('extractNwsLocation', () => {
  it('computes centroid from polygon geometry', () => {
    const geometry = {
      type: 'Polygon' as const,
      coordinates: [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]],
    }
    const result = extractNwsLocation(geometry, '')
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(4, 0) // average of 0,10,10,0,0
    expect(result!.lon).toBeCloseTo(4, 0)
  })

  it('falls back to state centroid from area description', () => {
    const result = extractNwsLocation(null, 'Central TX')
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(31.97, 1)
  })

  it('returns CONUS center for unknown area', () => {
    const result = extractNwsLocation(null, 'Some Unknown Area')
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(39.83, 1)
  })
})

// ─── OTX SEVERITY TESTS ────────────────────────────────────────────────────

describe('otxSeverity', () => {
  it('returns critical for APT groups', () => {
    expect(otxSeverity('APT29 Campaign targeting US', '', ['apt'], 10)).toBe('critical')
  })

  it('returns critical for Lazarus Group', () => {
    expect(otxSeverity('Lazarus Group New Malware', '', [], 5)).toBe('critical')
  })

  it('returns critical for LockBit ransomware', () => {
    expect(otxSeverity('LockBit 4.0 Ransomware', '', ['ransomware'], 20)).toBe('critical')
  })

  it('returns high for ransomware keyword', () => {
    expect(otxSeverity('New Ransomware Variant', 'targets healthcare', ['malware'], 15)).toBe('high')
  })

  it('returns high for zero-day', () => {
    expect(otxSeverity('Zero-day in Chrome', '', ['0-day'], 5)).toBe('high')
  })

  it('returns high for large indicator count', () => {
    expect(otxSeverity('Generic Campaign', '', [], 150)).toBe('high')
  })

  it('returns medium for phishing', () => {
    expect(otxSeverity('Phishing Campaign', 'credential theft', ['phishing'], 10)).toBe('medium')
  })

  it('returns medium for moderate indicator count', () => {
    expect(otxSeverity('Suspicious Activity', '', [], 25)).toBe('medium')
  })

  it('returns low for small informational pulse', () => {
    expect(otxSeverity('Informational Report', 'general update', ['info'], 3)).toBe('low')
  })
})

// ─── OTX LOCATION TESTS ────────────────────────────────────────────────────

describe('inferThreatRegion', () => {
  it('returns US coords for USA-targeting threats', () => {
    const result = inferThreatRegion('Attack on USA', '', [])
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(39.83, 1)
  })

  it('returns Russia coords for Russian APT', () => {
    const result = inferThreatRegion('', 'Russia-linked campaign', ['russia'])
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(55.75, 1)
  })

  it('returns China coords for Chinese targeting', () => {
    const result = inferThreatRegion('China-nexus APT', '', [])
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(39.90, 1)
  })

  it('returns null for global/unknown targeting', () => {
    const result = inferThreatRegion('Generic Malware', 'worldwide', [])
    expect(result).toBeNull()
  })
})

// ─── VOLCANO SEVERITY TESTS ────────────────────────────────────────────────

describe('volcanoSeverity', () => {
  it('returns critical for WARNING alert level', () => {
    expect(volcanoSeverity('WARNING', 'RED')).toBe('critical')
  })

  it('returns critical for RED aviation code even with WATCH alert', () => {
    expect(volcanoSeverity('WATCH', 'RED')).toBe('critical')
  })

  it('returns high for WATCH with ORANGE aviation', () => {
    expect(volcanoSeverity('WATCH', 'ORANGE')).toBe('high')
  })

  it('returns high for ADVISORY + ORANGE (takes higher)', () => {
    expect(volcanoSeverity('ADVISORY', 'ORANGE')).toBe('high')
  })

  it('returns medium for ADVISORY with YELLOW', () => {
    expect(volcanoSeverity('ADVISORY', 'YELLOW')).toBe('medium')
  })

  it('returns low for NORMAL with GREEN', () => {
    expect(volcanoSeverity('NORMAL', 'GREEN')).toBe('low')
  })

  it('handles case insensitivity', () => {
    expect(volcanoSeverity('warning', 'red')).toBe('critical')
  })

  it('handles missing aviation color', () => {
    expect(volcanoSeverity('WATCH', '')).toBe('high')
  })

  it('defaults to low for unknown values', () => {
    expect(volcanoSeverity('UNKNOWN', 'UNKNOWN')).toBe('low')
  })
})

// ─── VOLCANO LOCATION TESTS ────────────────────────────────────────────────

describe('lookupVolcanoCoords', () => {
  it('returns provided coordinates when available', () => {
    const result = lookupVolcanoCoords('SomeVolcano', 45.5, -122.5)
    expect(result).toEqual({ lat: 45.5, lon: -122.5 })
  })

  it('looks up Kilauea by name', () => {
    const result = lookupVolcanoCoords('Kilauea', null, null)
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(19.42, 1)
  })

  it('looks up Etna by name (case insensitive)', () => {
    const result = lookupVolcanoCoords('Mount Etna Eruption', null, null)
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(37.75, 1)
  })

  it('looks up Popocatépetl by name', () => {
    const result = lookupVolcanoCoords('Popocatépetl activity', null, null)
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(19.02, 1)
  })

  it('returns null for unknown volcano with no coordinates', () => {
    const result = lookupVolcanoCoords('Unknown Volcano XYZ', null, null)
    expect(result).toBeNull()
  })

  it('ignores zero coordinates', () => {
    const result = lookupVolcanoCoords('Kilauea', 0, 0)
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(19.42, 1)
  })
})
