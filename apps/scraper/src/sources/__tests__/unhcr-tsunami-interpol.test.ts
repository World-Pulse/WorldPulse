import { describe, it, expect } from 'vitest'

// ─── UNHCR Displacement Tests ──────────────────────────────────────────────

import {
  displacementSeverity,
  inferDisplacementLocation,
} from '../unhcr-displacement'

describe('displacementSeverity', () => {
  it('returns critical for 1M+ displaced population', () => {
    expect(displacementSeverity('Syria crisis', '', 1_500_000, 3)).toBe('critical')
  })

  it('returns critical for mass displacement keyword', () => {
    expect(displacementSeverity('Mass displacement in Sudan', 'armed conflict', 50_000, 1)).toBe('critical')
  })

  it('returns critical for ethnic cleansing keyword', () => {
    expect(displacementSeverity('Crisis', 'ethnic cleansing reported', 10_000, 1)).toBe('critical')
  })

  it('returns critical for 8+ affected countries', () => {
    expect(displacementSeverity('Regional crisis', '', 50_000, 8)).toBe('critical')
  })

  it('returns high for 100K+ displaced', () => {
    expect(displacementSeverity('Flood displacement', '', 150_000, 1)).toBe('high')
  })

  it('returns high for refugee crisis keyword', () => {
    expect(displacementSeverity('Refugee crisis', 'border surge', 5_000, 1)).toBe('high')
  })

  it('returns high for 4+ countries', () => {
    expect(displacementSeverity('Regional situation', '', 5_000, 5)).toBe('high')
  })

  it('returns medium for 10K+ displaced', () => {
    expect(displacementSeverity('Displacement', '', 25_000, 1)).toBe('medium')
  })

  it('returns medium for multi-country', () => {
    expect(displacementSeverity('Situation', '', 5_000, 2)).toBe('medium')
  })

  it('returns low for small single-country situation', () => {
    expect(displacementSeverity('Small situation', '', 500, 1)).toBe('low')
  })
})

describe('inferDisplacementLocation', () => {
  it('returns Ukraine coordinates', () => {
    const loc = inferDisplacementLocation(['Ukraine'])
    expect(loc).toEqual({ lat: 48.38, lon: 31.17 })
  })

  it('returns Syria coordinates', () => {
    const loc = inferDisplacementLocation(['Syria'])
    expect(loc).toEqual({ lat: 34.80, lon: 38.99 })
  })

  it('returns null for unknown country', () => {
    expect(inferDisplacementLocation(['Atlantis'])).toBeNull()
  })

  it('returns null for empty array', () => {
    expect(inferDisplacementLocation([])).toBeNull()
  })

  it('uses first country in list', () => {
    const loc = inferDisplacementLocation(['Afghanistan', 'Pakistan'])
    expect(loc).toEqual({ lat: 33.94, lon: 67.71 })
  })
})

// ─── Tsunami Warning Tests ─────────────────────────────────────────────────

import {
  tsunamiSeverity,
  extractTsunamiLocation,
  parseAtomEntries,
} from '../tsunami-warnings'

describe('tsunamiSeverity', () => {
  it('returns critical for active tsunami warning with wave observation', () => {
    expect(tsunamiSeverity('Tsunami Warning', 'wave height measured 1.2m')).toBe('critical')
  })

  it('returns critical for any tsunami warning', () => {
    expect(tsunamiSeverity('Tsunami Warning issued for Pacific', 'bulletin')).toBe('critical')
  })

  it('returns high for tsunami watch', () => {
    expect(tsunamiSeverity('Tsunami Watch', 'monitoring M7.2 earthquake')).toBe('high')
  })

  it('returns medium for tsunami advisory', () => {
    expect(tsunamiSeverity('Tsunami Advisory', 'beach hazard expected')).toBe('medium')
  })

  it('returns low for information statement', () => {
    expect(tsunamiSeverity('Tsunami Information Statement', 'no threat')).toBe('low')
  })

  it('returns medium for unclassified bulletin', () => {
    expect(tsunamiSeverity('Seismic event', 'earthquake detected')).toBe('medium')
  })
})

describe('extractTsunamiLocation', () => {
  it('extracts coordinates from "XX.X North XX.X West" format', () => {
    const loc = extractTsunamiLocation('Earthquake', '51.3 North 178.5 West')
    expect(loc).toEqual({ lat: 51.3, lon: -178.5 })
  })

  it('extracts coordinates from South/East format', () => {
    const loc = extractTsunamiLocation('Event', '8.2 South 110.4 East')
    expect(loc).toEqual({ lat: -8.2, lon: 110.4 })
  })

  it('falls back to region inference for Pacific', () => {
    const loc = extractTsunamiLocation('Pacific Tsunami Warning', '')
    expect(loc).not.toBeNull()
    expect(loc!.lat).toBeCloseTo(19.9, 0)
  })

  it('falls back to region inference for Alaska', () => {
    const loc = extractTsunamiLocation('', 'Alaska earthquake trigger')
    expect(loc).not.toBeNull()
    expect(loc!.lat).toBeCloseTo(56, 0)
  })

  it('returns null for no location info', () => {
    const loc = extractTsunamiLocation('Generic', 'no location')
    expect(loc).toBeNull()
  })
})

describe('parseAtomEntries', () => {
  it('parses a valid Atom entry', () => {
    const xml = `<?xml version="1.0"?>
    <feed>
      <entry>
        <id>urn:tsunami:001</id>
        <title>Tsunami Warning - Pacific</title>
        <summary>M7.5 earthquake detected</summary>
        <link href="https://tsunami.gov/events/001"/>
        <updated>2026-03-24T00:00:00Z</updated>
      </entry>
    </feed>`
    const entries = parseAtomEntries(xml)
    expect(entries).toHaveLength(1)
    expect(entries[0].title).toBe('Tsunami Warning - Pacific')
    expect(entries[0].id).toBe('urn:tsunami:001')
  })

  it('returns empty for no entries', () => {
    expect(parseAtomEntries('<feed></feed>')).toHaveLength(0)
  })

  it('parses multiple entries', () => {
    const xml = `<feed>
      <entry><id>1</id><title>Alert 1</title><summary>s</summary><link href="u"/><updated>t</updated></entry>
      <entry><id>2</id><title>Alert 2</title><summary>s</summary><link href="u"/><updated>t</updated></entry>
    </feed>`
    expect(parseAtomEntries(xml)).toHaveLength(2)
  })
})

// ─── Interpol Notices Tests ────────────────────────────────────────────────

import {
  noticeSeverity,
  inferNoticeLocation,
} from '../interpol-notices'

describe('noticeSeverity', () => {
  it('returns critical for terrorism charges', () => {
    expect(noticeSeverity('financing of terrorism', 1)).toBe('critical')
  })

  it('returns critical for war crimes', () => {
    expect(noticeSeverity('war crime against civilian population', 1)).toBe('critical')
  })

  it('returns critical for human trafficking', () => {
    expect(noticeSeverity('human trafficking organization', 1)).toBe('critical')
  })

  it('returns high for murder charges', () => {
    expect(noticeSeverity('murder in the first degree', 1)).toBe('high')
  })

  it('returns high for drug trafficking', () => {
    expect(noticeSeverity('drug trafficking conspiracy', 1)).toBe('high')
  })

  it('returns high for multi-national involvement (3+)', () => {
    expect(noticeSeverity('fraud', 3)).toBe('high')
  })

  it('returns medium for dual-nationality', () => {
    expect(noticeSeverity('fraud', 2)).toBe('medium')
  })

  it('returns low for single-nation minor charges', () => {
    expect(noticeSeverity('embezzlement', 1)).toBe('low')
  })
})

describe('inferNoticeLocation', () => {
  it('prefers issuing country over nationality', () => {
    const loc = inferNoticeLocation(['BR'], 'US')
    expect(loc).toEqual({ lat: 38.90, lon: -77.04 })
  })

  it('falls back to first nationality', () => {
    const loc = inferNoticeLocation(['FR'])
    expect(loc).toEqual({ lat: 48.86, lon: 2.35 })
  })

  it('returns null for unknown country', () => {
    expect(inferNoticeLocation(['XX'])).toBeNull()
  })

  it('returns null for empty array', () => {
    expect(inferNoticeLocation([])).toBeNull()
  })

  it('returns correct location for Russia', () => {
    const loc = inferNoticeLocation(['RU'])
    expect(loc).toEqual({ lat: 55.76, lon: 37.62 })
  })
})
