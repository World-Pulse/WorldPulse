/**
 * STIX 2.1 bundle generator for WorldPulse signals.
 * Spec: https://docs.oasis-open.org/cti/stix/v2.1/stix-v2.1.html
 */
import { randomUUID } from 'crypto'
import type { Signal, SignalSeverity } from '@worldpulse/types'

// ─── STIX Type Definitions ────────────────────────────────────────────────────

export interface StixBase {
  type: string
  spec_version: '2.1'
  id: string           // format: type--uuid
  created: string      // ISO 8601
  modified: string     // ISO 8601
}

export interface StixExternalReference {
  source_name: string
  url?: string
  description?: string
}

export interface StixLocation extends StixBase {
  type: 'location'
  name?: string
  latitude?: number
  longitude?: number
  country?: string
  region?: string
}

export interface StixIndicator extends StixBase {
  type: 'indicator'
  name: string
  description?: string
  indicator_types: string[]
  pattern: string
  pattern_type: 'stix'
  valid_from: string
  labels?: string[]
  confidence?: number
  lang?: string
  external_references?: StixExternalReference[]
  object_marking_refs?: string[]
}

export interface StixSighting extends StixBase {
  type: 'sighting'
  description?: string
  first_seen: string
  last_seen: string
  count: number
  sighting_of_ref: string
  summary?: boolean
  confidence?: number
  external_references?: StixExternalReference[]
}

export interface StixObservedData extends StixBase {
  type: 'observed-data'
  first_observed: string
  last_observed: string
  number_observed: number
  object_refs: string[]
  confidence?: number
  labels?: string[]
  external_references?: StixExternalReference[]
}

export interface StixReport extends StixBase {
  type: 'report'
  name: string
  description?: string
  report_types: string[]
  published: string
  object_refs: string[]
  labels?: string[]
  confidence?: number
  lang?: string
  external_references?: StixExternalReference[]
}

export type StixObject =
  | StixIndicator
  | StixSighting
  | StixObservedData
  | StixReport
  | StixLocation

export interface StixBundle {
  type: 'bundle'
  id: string
  spec_version: '2.1'
  objects: StixObject[]
}

// ─── Severity → Confidence Mapping ───────────────────────────────────────────

const SEVERITY_CONFIDENCE: Record<SignalSeverity, number> = {
  critical: 95,
  high:     80,
  medium:   60,
  low:      30,
  info:     15,
}

function stixId(type: string): string {
  return `${type}--${randomUUID()}`
}

function isoNow(): string {
  return new Date().toISOString()
}

/**
 * Compute confidence: base from severity, modulated ±10 by reliability_score
 * (reliability 0.0 → −10, 0.5 → 0, 1.0 → +10), clamped to [0, 100].
 */
function computeConfidence(severity: SignalSeverity, reliabilityScore: number): number {
  const base = SEVERITY_CONFIDENCE[severity] ?? 50
  const modifier = Math.round((reliabilityScore - 0.5) * 20) // −10 to +10
  return Math.max(0, Math.min(100, base + modifier))
}

function buildExternalRefs(signal: Signal): StixExternalReference[] {
  const refs: StixExternalReference[] = []
  for (const url of signal.originalUrls ?? []) {
    if (url) refs.push({ source_name: 'WorldPulse Source', url })
  }
  return refs
}

// ─── Converter Class ─────────────────────────────────────────────────────────

export class SignalToStixConverter {
  /**
   * Convert a WorldPulse signal to a STIX Indicator object.
   * Uses a pattern reflecting the signal's category and title.
   */
  signalToIndicator(signal: Signal): StixIndicator {
    const now = isoNow()
    const validFrom = signal.eventTime ?? signal.firstReported ?? now
    const confidence = computeConfidence(signal.severity, signal.reliabilityScore ?? 0.5)
    const externalRefs = buildExternalRefs(signal)

    return {
      type: 'indicator',
      spec_version: '2.1',
      id: stixId('indicator'),
      created: signal.createdAt ?? now,
      modified: signal.lastUpdated ?? now,
      name: signal.title,
      description: signal.summary ?? signal.body ?? undefined,
      indicator_types: [mapCategoryToIndicatorType(signal.category)],
      pattern: `[worldpulse:signal-id = '${signal.id}']`,
      pattern_type: 'stix',
      valid_from: validFrom,
      labels: [signal.category, ...(signal.tags ?? [])],
      confidence,
      lang: signal.language ?? 'en',
      ...(externalRefs.length > 0 && { external_references: externalRefs }),
    }
  }

  /**
   * Convert a signal to a STIX Sighting object.
   * References a placeholder indicator ID; in real usage pair with signalToIndicator.
   */
  signalToSighting(signal: Signal): StixSighting {
    const now = isoNow()
    const firstSeen = signal.eventTime ?? signal.firstReported ?? now
    const lastSeen  = signal.lastUpdated ?? now
    const confidence = computeConfidence(signal.severity, signal.reliabilityScore ?? 0.5)
    const indicatorRef = stixId('indicator')
    const externalRefs = buildExternalRefs(signal)

    return {
      type: 'sighting',
      spec_version: '2.1',
      id: stixId('sighting'),
      created: signal.createdAt ?? now,
      modified: signal.lastUpdated ?? now,
      description: signal.summary ?? signal.body ?? undefined,
      first_seen: firstSeen,
      last_seen: lastSeen,
      count: signal.sourceCount ?? 1,
      sighting_of_ref: indicatorRef,
      confidence,
      ...(externalRefs.length > 0 && { external_references: externalRefs }),
    }
  }

  /**
   * Convert a signal to a STIX Observed Data object.
   */
  signalToObservedData(signal: Signal): StixObservedData {
    const now = isoNow()
    const firstObserved = signal.eventTime ?? signal.firstReported ?? now
    const lastObserved  = signal.lastUpdated ?? now
    const confidence = computeConfidence(signal.severity, signal.reliabilityScore ?? 0.5)
    const externalRefs = buildExternalRefs(signal)

    // We reference a placeholder indicator in object_refs
    const indicatorRef = stixId('indicator')

    return {
      type: 'observed-data',
      spec_version: '2.1',
      id: stixId('observed-data'),
      created: signal.createdAt ?? now,
      modified: signal.lastUpdated ?? now,
      first_observed: firstObserved,
      last_observed: lastObserved,
      number_observed: signal.sourceCount ?? 1,
      object_refs: [indicatorRef],
      confidence,
      labels: [signal.category, ...(signal.tags ?? [])],
      ...(externalRefs.length > 0 && { external_references: externalRefs }),
    }
  }

  /**
   * Wrap a signal as a STIX Report, containing Indicator, Sighting, and
   * (optionally) Location objects.
   */
  signalToReport(signal: Signal): { report: StixReport; objects: StixObject[] } {
    const now = isoNow()
    const confidence = computeConfidence(signal.severity, signal.reliabilityScore ?? 0.5)
    const externalRefs = buildExternalRefs(signal)
    const published = signal.eventTime ?? signal.firstReported ?? now

    const indicator = this.signalToIndicator(signal)
    const objects: StixObject[] = [indicator]

    if (signal.location) {
      const location = this.signalToLocation(signal)
      objects.push(location)
    }

    const report: StixReport = {
      type: 'report',
      spec_version: '2.1',
      id: stixId('report'),
      created: signal.createdAt ?? now,
      modified: signal.lastUpdated ?? now,
      name: signal.title,
      description: signal.summary ?? signal.body ?? undefined,
      report_types: ['threat-report'],
      published,
      object_refs: objects.map(o => o.id),
      labels: [signal.category, ...(signal.tags ?? [])],
      confidence,
      lang: signal.language ?? 'en',
      ...(externalRefs.length > 0 && { external_references: externalRefs }),
    }

    return { report, objects }
  }

  /**
   * Convert signal location to a STIX Location object.
   */
  signalToLocation(signal: Signal): StixLocation {
    const now = isoNow()
    const loc: StixLocation = {
      type: 'location',
      spec_version: '2.1',
      id: stixId('location'),
      created: signal.createdAt ?? now,
      modified: signal.lastUpdated ?? now,
    }

    if (signal.locationName) loc.name = signal.locationName
    if (signal.location?.lat != null) loc.latitude = signal.location.lat
    if (signal.location?.lng != null) loc.longitude = signal.location.lng
    if (signal.countryCode) loc.country = signal.countryCode
    if (signal.region) loc.region = signal.region

    return loc
  }

  /**
   * Build a STIX Bundle from one or more signals.
   * Each signal produces: Indicator + Report + optional Location.
   */
  buildBundle(signals: Signal[]): StixBundle {
    const allObjects: StixObject[] = []

    for (const signal of signals) {
      const indicator = this.signalToIndicator(signal)
      allObjects.push(indicator)

      if (signal.location) {
        allObjects.push(this.signalToLocation(signal))
      }

      const now = isoNow()
      const confidence = computeConfidence(signal.severity, signal.reliabilityScore ?? 0.5)
      const externalRefs = buildExternalRefs(signal)
      const published = signal.eventTime ?? signal.firstReported ?? now

      const report: StixReport = {
        type: 'report',
        spec_version: '2.1',
        id: stixId('report'),
        created: signal.createdAt ?? now,
        modified: signal.lastUpdated ?? now,
        name: signal.title,
        description: signal.summary ?? signal.body ?? undefined,
        report_types: ['threat-report'],
        published,
        object_refs: [indicator.id, ...(signal.location ? [allObjects[allObjects.length - 1].id] : [])],
        labels: [signal.category, ...(signal.tags ?? [])],
        confidence,
        lang: signal.language ?? 'en',
        ...(externalRefs.length > 0 && { external_references: externalRefs }),
      }
      allObjects.push(report)
    }

    return {
      type: 'bundle',
      id: stixId('bundle'),
      spec_version: '2.1',
      objects: allObjects,
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapCategoryToIndicatorType(category: string): string {
  const map: Record<string, string> = {
    conflict:    'malicious-activity',
    security:    'malicious-activity',
    breaking:    'anomalous-activity',
    geopolitics: 'attribution',
    health:      'anomalous-activity',
    climate:     'anomalous-activity',
    disaster:    'anomalous-activity',
    elections:   'attribution',
    economy:     'anomalous-activity',
    technology:  'anomalous-activity',
    science:     'benign',
    culture:     'benign',
    sports:      'benign',
    space:       'anomalous-activity',
    other:       'unknown',
  }
  return map[category] ?? 'unknown'
}

export const severityConfidenceMap = SEVERITY_CONFIDENCE
