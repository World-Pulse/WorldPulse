/**
 * Tests for STIX 2.1 bundle generator (apps/api/src/lib/stix.ts)
 */
import { describe, it, expect } from 'vitest'
import { SignalToStixConverter, severityConfidenceMap } from '../lib/stix'
import type { Signal } from '@worldpulse/types'

// ─── Fixture ──────────────────────────────────────────────────────────────────

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id:               'test-signal-id-1234',
    title:            'Test Signal Title',
    summary:          'A brief summary of the test signal.',
    body:             'Full body content here.',
    category:         'conflict',
    severity:         'high',
    status:           'verified',
    reliabilityScore: 0.8,
    sourceCount:      3,
    location:         { lat: 48.8566, lng: 2.3522 },
    locationName:     'Paris, France',
    countryCode:      'FR',
    region:           'Western Europe',
    tags:             ['europe', 'france'],
    sources:          [],
    originalUrls:     ['https://example.com/article-1', 'https://example.com/article-2'],
    language:         'en',
    viewCount:        1000,
    shareCount:       50,
    postCount:        10,
    eventTime:        '2024-01-15T10:00:00.000Z',
    firstReported:    '2024-01-15T09:00:00.000Z',
    verifiedAt:       '2024-01-15T11:00:00.000Z',
    lastUpdated:      '2024-01-15T12:00:00.000Z',
    createdAt:        '2024-01-15T09:00:00.000Z',
    ...overrides,
  }
}

const converter = new SignalToStixConverter()

// ─── signalToIndicator ────────────────────────────────────────────────────────

describe('signalToIndicator', () => {
  it('produces a valid STIX 2.1 Indicator', () => {
    const signal = makeSignal()
    const indicator = converter.signalToIndicator(signal)

    expect(indicator.type).toBe('indicator')
    expect(indicator.spec_version).toBe('2.1')
    expect(indicator.id).toMatch(/^indicator--[0-9a-f-]{36}$/)
    expect(indicator.name).toBe(signal.title)
    expect(indicator.description).toBe(signal.summary)
    expect(indicator.pattern_type).toBe('stix')
    expect(indicator.pattern).toContain(signal.id)
    expect(indicator.valid_from).toBe(signal.eventTime)
    expect(indicator.labels).toContain('conflict')
    expect(indicator.labels).toContain('europe')
  })

  it('sets confidence based on severity and reliabilityScore', () => {
    // high severity (base 80) + reliability 0.8 → modifier +6 → 86
    const indicator = converter.signalToIndicator(makeSignal({ severity: 'high', reliabilityScore: 0.8 }))
    expect(indicator.confidence).toBe(86)
  })

  it('includes external_references when originalUrls are present', () => {
    const signal = makeSignal({ originalUrls: ['https://news.example.com/story'] })
    const indicator = converter.signalToIndicator(signal)

    expect(indicator.external_references).toHaveLength(1)
    expect(indicator.external_references![0].url).toBe('https://news.example.com/story')
    expect(indicator.external_references![0].source_name).toBe('WorldPulse Source')
  })

  it('omits external_references when originalUrls is empty', () => {
    const indicator = converter.signalToIndicator(makeSignal({ originalUrls: [] }))
    expect(indicator.external_references).toBeUndefined()
  })
})

// ─── signalToSighting ─────────────────────────────────────────────────────────

describe('signalToSighting', () => {
  it('produces a valid STIX 2.1 Sighting', () => {
    const signal = makeSignal()
    const sighting = converter.signalToSighting(signal)

    expect(sighting.type).toBe('sighting')
    expect(sighting.spec_version).toBe('2.1')
    expect(sighting.id).toMatch(/^sighting--[0-9a-f-]{36}$/)
    expect(sighting.first_seen).toBe(signal.eventTime)
    expect(sighting.last_seen).toBe(signal.lastUpdated)
    expect(sighting.count).toBe(signal.sourceCount)
    expect(sighting.sighting_of_ref).toMatch(/^indicator--[0-9a-f-]{36}$/)
    expect(sighting.description).toBe(signal.summary)
  })
})

// ─── signalToReport ───────────────────────────────────────────────────────────

describe('signalToReport', () => {
  it('produces a valid STIX 2.1 Report wrapping indicator and location', () => {
    const signal = makeSignal()
    const { report, objects } = converter.signalToReport(signal)

    expect(report.type).toBe('report')
    expect(report.spec_version).toBe('2.1')
    expect(report.id).toMatch(/^report--[0-9a-f-]{36}$/)
    expect(report.name).toBe(signal.title)
    expect(report.report_types).toContain('threat-report')
    expect(report.published).toBe(signal.eventTime)
    // Should contain indicator + location
    expect(report.object_refs).toHaveLength(2)
    expect(objects).toHaveLength(2)
    expect(objects.map(o => o.type)).toContain('indicator')
    expect(objects.map(o => o.type)).toContain('location')
  })

  it('omits location from object_refs when signal has no location', () => {
    const signal = makeSignal({ location: null })
    const { report, objects } = converter.signalToReport(signal)

    expect(report.object_refs).toHaveLength(1)
    expect(objects).toHaveLength(1)
    expect(objects[0].type).toBe('indicator')
  })
})

// ─── buildBundle ─────────────────────────────────────────────────────────────

describe('buildBundle', () => {
  it('creates a STIX Bundle wrapping all signal objects', () => {
    const signals = [makeSignal(), makeSignal({ id: 'signal-2', title: 'Second Signal', location: null })]
    const bundle = converter.buildBundle(signals)

    expect(bundle.type).toBe('bundle')
    expect(bundle.spec_version).toBe('2.1')
    expect(bundle.id).toMatch(/^bundle--[0-9a-f-]{36}$/)
    // signal 1: indicator + location + report = 3 objects
    // signal 2: indicator + report = 2 objects
    expect(bundle.objects).toHaveLength(5)
  })

  it('returns an empty objects array for an empty signals input', () => {
    const bundle = converter.buildBundle([])
    expect(bundle.type).toBe('bundle')
    expect(bundle.objects).toHaveLength(0)
  })
})

// ─── Severity confidence mapping ─────────────────────────────────────────────

describe('severityConfidenceMap', () => {
  it('maps critical → 95', () => {
    const ind = converter.signalToIndicator(makeSignal({ severity: 'critical', reliabilityScore: 0.5 }))
    expect(ind.confidence).toBe(95)
  })

  it('maps high → 80 (baseline at 0.5 reliability)', () => {
    const ind = converter.signalToIndicator(makeSignal({ severity: 'high', reliabilityScore: 0.5 }))
    expect(ind.confidence).toBe(80)
  })

  it('maps medium → 60 (baseline at 0.5 reliability)', () => {
    const ind = converter.signalToIndicator(makeSignal({ severity: 'medium', reliabilityScore: 0.5 }))
    expect(ind.confidence).toBe(60)
  })

  it('maps low → 30 (baseline at 0.5 reliability)', () => {
    const ind = converter.signalToIndicator(makeSignal({ severity: 'low', reliabilityScore: 0.5 }))
    expect(ind.confidence).toBe(30)
  })

  it('exposes the raw severity→confidence map', () => {
    expect(severityConfidenceMap.critical).toBe(95)
    expect(severityConfidenceMap.high).toBe(80)
    expect(severityConfidenceMap.medium).toBe(60)
    expect(severityConfidenceMap.low).toBe(30)
  })
})

// ─── Location mapping ─────────────────────────────────────────────────────────

describe('signalToLocation', () => {
  it('maps lat/lng from signal.location', () => {
    const signal = makeSignal({ location: { lat: 51.5074, lng: -0.1278 } })
    const loc = converter.signalToLocation(signal)

    expect(loc.type).toBe('location')
    expect(loc.spec_version).toBe('2.1')
    expect(loc.id).toMatch(/^location--[0-9a-f-]{36}$/)
    expect(loc.latitude).toBe(51.5074)
    expect(loc.longitude).toBe(-0.1278)
    expect(loc.name).toBe(signal.locationName)
    expect(loc.country).toBe(signal.countryCode)
    expect(loc.region).toBe(signal.region)
  })
})

// ─── Null / empty field handling ──────────────────────────────────────────────

describe('null and empty field handling', () => {
  it('handles null summary gracefully — falls back to body', () => {
    const signal = makeSignal({ summary: null, body: 'Body text here' })
    const indicator = converter.signalToIndicator(signal)
    expect(indicator.description).toBe('Body text here')
  })

  it('handles null summary AND null body — description is undefined', () => {
    const signal = makeSignal({ summary: null, body: null })
    const indicator = converter.signalToIndicator(signal)
    expect(indicator.description).toBeUndefined()
  })

  it('handles null location in signalToReport — no location object produced', () => {
    const signal = makeSignal({ location: null, locationName: null })
    const { objects } = converter.signalToReport(signal)
    expect(objects.every(o => o.type !== 'location')).toBe(true)
  })

  it('handles empty tags array', () => {
    const signal = makeSignal({ tags: [] })
    const indicator = converter.signalToIndicator(signal)
    expect(indicator.labels).toEqual([signal.category])
  })
})
