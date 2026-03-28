/**
 * Tests for EU Sanctions, Power Outage, and Aviation Incident OSINT sources
 * Cycle 81: 3 new feeds bringing WorldPulse to 24 OSINT feeds total
 */

import { describe, it, expect } from 'vitest'

// ─── EU CFSP SANCTIONS ──────────────────────────────────────────────────────

import {
  euSanctionsSeverity,
  inferEuSanctionsLocation,
} from '../eu-sanctions'

describe('euSanctionsSeverity', () => {
  it('returns critical for Russia sanctions', () => {
    expect(euSanctionsSeverity('Russia', 'Restrictive measures in view of Russia')).toBe('critical')
  })

  it('returns critical for Iran nuclear program', () => {
    expect(euSanctionsSeverity('Iran', 'Nuclear proliferation concerns')).toBe('critical')
  })

  it('returns critical for DPRK sanctions', () => {
    expect(euSanctionsSeverity('DPRK', 'North Korea weapons programme')).toBe('critical')
  })

  it('returns critical for Syria regime', () => {
    expect(euSanctionsSeverity('Syria', 'Syrian crisis measures')).toBe('critical')
  })

  it('returns critical for terrorism sanctions', () => {
    expect(euSanctionsSeverity('Counter-terrorism', 'terrorism financing measures')).toBe('critical')
  })

  it('returns critical for cyber sanctions', () => {
    expect(euSanctionsSeverity('Cyber-attacks', 'cyber-attacks threatening the EU')).toBe('critical')
  })

  it('returns critical for Belarus sanctions', () => {
    expect(euSanctionsSeverity('Belarus', 'Internal repression in Belarus')).toBe('critical')
  })

  it('returns high for Myanmar sanctions', () => {
    expect(euSanctionsSeverity('Myanmar/Burma', 'Coup d\'état measures')).toBe('high')
  })

  it('returns high for Mali sanctions', () => {
    expect(euSanctionsSeverity('Mali', 'Stabilisation measures')).toBe('high')
  })

  it('returns high for human rights sanctions', () => {
    expect(euSanctionsSeverity('Global Human Rights', 'Human rights violations')).toBe('high')
  })

  it('returns medium for Tunisia sanctions', () => {
    expect(euSanctionsSeverity('Tunisia', 'Misappropriation of public funds')).toBe('medium')
  })

  it('returns low for unknown/minor regimes', () => {
    expect(euSanctionsSeverity('Unknown regime', 'Minor advisory')).toBe('low')
  })
})

describe('inferEuSanctionsLocation', () => {
  it('returns Moscow coordinates for Russia', () => {
    const coords = inferEuSanctionsLocation('Russia')
    expect(coords.lat).toBeCloseTo(55.75, 1)
    expect(coords.lon).toBeCloseTo(37.62, 1)
  })

  it('returns Tehran coordinates for Iran', () => {
    const coords = inferEuSanctionsLocation('Iran nuclear programme')
    expect(coords.lat).toBeCloseTo(35.69, 1)
  })

  it('returns Pyongyang for DPRK/North Korea', () => {
    const coords = inferEuSanctionsLocation('DPRK weapons programme')
    expect(coords.lat).toBeCloseTo(39.02, 1)
  })

  it('returns Brussels for unknown regimes', () => {
    const coords = inferEuSanctionsLocation('Unknown regime ABC')
    expect(coords.lat).toBeCloseTo(50.85, 1)
    expect(coords.lon).toBeCloseTo(4.35, 1)
  })

  it('returns Minsk for Belarus', () => {
    const coords = inferEuSanctionsLocation('Belarus repression')
    expect(coords.lat).toBeCloseTo(53.90, 1)
  })

  it('returns Bamako for Mali', () => {
    const coords = inferEuSanctionsLocation('Mali stabilisation')
    expect(coords.lat).toBeCloseTo(12.64, 1)
  })
})

// ─── POWER GRID OUTAGES ─────────────────────────────────────────────────────

import {
  outageSeverity,
  isSignificantOutage,
  stateCoords,
} from '../power-outage'

describe('outageSeverity', () => {
  it('returns critical for 500K+ customers', () => {
    expect(outageSeverity(500_000)).toBe('critical')
    expect(outageSeverity(1_000_000)).toBe('critical')
  })

  it('returns high for 100K-500K customers', () => {
    expect(outageSeverity(100_000)).toBe('high')
    expect(outageSeverity(250_000)).toBe('high')
    expect(outageSeverity(499_999)).toBe('high')
  })

  it('returns medium for 25K-100K customers', () => {
    expect(outageSeverity(25_000)).toBe('medium')
    expect(outageSeverity(50_000)).toBe('medium')
    expect(outageSeverity(99_999)).toBe('medium')
  })

  it('returns low for under 25K customers', () => {
    expect(outageSeverity(10_000)).toBe('low')
    expect(outageSeverity(5_000)).toBe('low')
    expect(outageSeverity(0)).toBe('low')
  })
})

describe('isSignificantOutage', () => {
  it('returns true for 10K+ customers', () => {
    expect(isSignificantOutage(10_000)).toBe(true)
    expect(isSignificantOutage(500_000)).toBe(true)
  })

  it('returns false for under 10K', () => {
    expect(isSignificantOutage(9_999)).toBe(false)
    expect(isSignificantOutage(0)).toBe(false)
  })
})

describe('stateCoords', () => {
  it('returns California coordinates', () => {
    const coords = stateCoords('CA')
    expect(coords.lat).toBeCloseTo(36.78, 1)
  })

  it('returns Texas coordinates', () => {
    const coords = stateCoords('TX')
    expect(coords.lat).toBeCloseTo(31.97, 1)
  })

  it('returns DC coordinates', () => {
    const coords = stateCoords('DC')
    expect(coords.lat).toBeCloseTo(38.91, 1)
  })

  it('handles lowercase', () => {
    const coords = stateCoords('ny')
    expect(coords.lat).toBeCloseTo(43.30, 1)
  })

  it('returns US center for unknown state', () => {
    const coords = stateCoords('XX')
    expect(coords.lat).toBeCloseTo(39.83, 1)
    expect(coords.lon).toBeCloseTo(-98.58, 1)
  })
})

// ─── AVIATION SAFETY INCIDENTS ──────────────────────────────────────────────

import {
  aviationSeverity,
  isSignificantAviation,
  extractFatalities,
  extractAircraftType,
  inferAviationLocation,
  parseAsnRss,
} from '../aviation-incidents'

describe('aviationSeverity', () => {
  it('returns critical for 50+ fatalities', () => {
    expect(aviationSeverity(50, 'Cessna', 'crash')).toBe('critical')
    expect(aviationSeverity(150, 'Boeing 737', 'crash landing')).toBe('critical')
  })

  it('returns critical for 10+ fatalities on airliner', () => {
    expect(aviationSeverity(10, 'Boeing 737', 'Airliner crash')).toBe('critical')
    expect(aviationSeverity(15, 'Airbus A320', 'descent into terrain')).toBe('critical')
  })

  it('returns high for 10+ fatalities on non-airliner', () => {
    expect(aviationSeverity(10, 'Cessna 172', 'small aircraft')).toBe('high')
  })

  it('returns high for military aircraft with fatalities', () => {
    expect(aviationSeverity(2, 'F-16', 'Military fighter crash')).toBe('high')
  })

  it('returns medium for 1+ fatalities', () => {
    expect(aviationSeverity(1, 'Piper', 'single engine')).toBe('medium')
    expect(aviationSeverity(3, 'Cessna', 'small plane')).toBe('medium')
  })

  it('returns medium for hull loss without fatalities', () => {
    expect(aviationSeverity(0, 'Boeing 737', 'hull loss after emergency landing')).toBe('medium')
  })

  it('returns low for minor incidents', () => {
    expect(aviationSeverity(0, 'Cessna', 'minor runway excursion')).toBe('low')
  })
})

describe('isSignificantAviation', () => {
  it('returns true for fatalities', () => {
    expect(isSignificantAviation(1, 'crash')).toBe(true)
  })

  it('returns true for hull loss', () => {
    expect(isSignificantAviation(0, 'hull loss after landing')).toBe(true)
  })

  it('returns true for emergency', () => {
    expect(isSignificantAviation(0, 'emergency landing gear failure')).toBe(true)
  })

  it('returns false for routine events', () => {
    expect(isSignificantAviation(0, 'minor turbulence report')).toBe(false)
  })
})

describe('extractFatalities', () => {
  it('extracts "3 killed"', () => {
    expect(extractFatalities('Aircraft crash, 3 killed near airport')).toBe(3)
  })

  it('extracts "fatalities: 150"', () => {
    expect(extractFatalities('Major accident fatalities: 150')).toBe(150)
  })

  it('returns 0 for no fatality mention', () => {
    expect(extractFatalities('Minor runway excursion, no injuries')).toBe(0)
  })

  it('extracts "all 189 occupants killed"', () => {
    expect(extractFatalities('all 189 occupants killed')).toBe(189)
  })
})

describe('extractAircraftType', () => {
  it('extracts Boeing model', () => {
    expect(extractAircraftType('Boeing 737-800 crash')).toBe('Boeing 737-800')
  })

  it('extracts Airbus model', () => {
    expect(extractAircraftType('Airbus A320neo incident')).toBe('Airbus A320neo')
  })

  it('extracts Cessna', () => {
    expect(extractAircraftType('Cessna 172 forced landing')).toBe('Cessna 172')
  })

  it('returns Unknown type when not found', () => {
    expect(extractAircraftType('Small plane crash')).toBe('Unknown type')
  })
})

describe('inferAviationLocation', () => {
  it('locates United States incidents', () => {
    const coords = inferAviationLocation('near Dallas', 'United States')
    expect(coords.lat).toBeCloseTo(39.83, 0)
  })

  it('locates Indonesia incidents', () => {
    const coords = inferAviationLocation('Java Sea', 'Indonesia crash')
    expect(coords.lat).toBeCloseTo(-6.21, 0)
  })

  it('falls back to 0,0 for unknown locations', () => {
    const coords = inferAviationLocation('', 'unknown location')
    expect(coords.lat).toBe(0)
    expect(coords.lon).toBe(0)
  })
})

describe('parseAsnRss', () => {
  it('parses valid RSS items', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title><![CDATA[21-MAR-2026 Boeing 737 near Jakarta, 3 killed]]></title>
      <link>https://aviation-safety.net/database/record.php?id=20260321-0</link>
      <description><![CDATA[A Boeing 737 crashed near Jakarta airport, 3 killed on impact.]]></description>
      <pubDate>Sat, 21 Mar 2026 10:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`

    const entries = parseAsnRss(xml)
    expect(entries).toHaveLength(1)
    expect(entries[0].title).toContain('Boeing 737')
    expect(entries[0].fatalities).toBe(3)
    expect(entries[0].aircraftType).toBe('Boeing 737')
    expect(entries[0].link).toContain('aviation-safety.net')
  })

  it('returns empty array for malformed XML', () => {
    expect(parseAsnRss('<not-rss></not-rss>')).toHaveLength(0)
  })

  it('handles multiple items', () => {
    const xml = `<rss><channel>
      <item><title>Incident A</title><link>http://a</link><description>desc A</description><pubDate>Mon, 01 Jan 2026 00:00:00 GMT</pubDate></item>
      <item><title>Incident B</title><link>http://b</link><description>desc B</description><pubDate>Tue, 02 Jan 2026 00:00:00 GMT</pubDate></item>
    </channel></rss>`

    expect(parseAsnRss(xml)).toHaveLength(2)
  })
})
