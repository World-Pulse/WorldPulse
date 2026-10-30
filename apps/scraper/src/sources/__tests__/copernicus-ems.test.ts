/**
 * Copernicus EMS rapid mapping activations (plan N11, Oct 30, 2026), and the
 * two sources it stands in for while they have no account: ACLED and ReliefWeb.
 * The activations below are the API's own (Oct 30, 2026), with their times moved
 * where a test needs a fresh one.
 */
import { describe, it, expect } from 'vitest'
import {
  parseCentroid, activationTime, newActivations, cemsCategory, cemsSeverity, cemsPlaceName, cemsText,
  type CemsActivation,
} from '../copernicus-ems'
import { acledConfigured } from '../acled'
import { reliefWebConfigured } from '../reliefweb'
import { bucketUrl } from '../gdelt'

const VALENCIA: CemsActivation = {
  code: 'EMSR935',
  countries: [{ short_name: 'Spain' }],
  category: { slug: 'flood', name: 'Flood' },
  name: 'Flood in Alicante-Valencia Regions, Spain',
  centroid: 'POINT (0.022993090259437 38.81628901353977)',
  activationTime: '2026-10-19T16:03:00',
  lastUpdate: '2026-10-21T03:55:11.352969',
  drmPhase: 'response',
  closed: true,
  search_snippet: 'On 19 October 2026, an episode of adverse weather affecting the south of Valencia province and the north of Alicante is impacting a large number of people.\r\nUp to 500 rescues were carried out within 12 hours.',
}
const PANAMA: CemsActivation = {
  code: 'EMSR934',
  countries: [{ short_name: 'Panama' }],
  category: { slug: 'earthquake', name: 'Earthquake' },
  name: 'Earthquake in Los Santos, Panama',
  centroid: 'POINT (-80.67084785156305 8.006692455305458)',
  activationTime: '2026-10-09T23:19:00',
  drmPhase: 'response',
  closed: true,
}
const NOW = Date.parse('2026-10-20T12:00:00Z')

describe('parseCentroid', () => {
  it('reads longitude first, as WKT writes it', () => {
    expect(parseCentroid(VALENCIA.centroid)).toEqual({ lat: 38.81628901353977, lon: 0.022993090259437 })
    expect(parseCentroid('POINT (-80.67 8.0067)')).toEqual({ lat: 8.0067, lon: -80.67 })
  })
  it('gives null for anything else', () => {
    for (const bad of [null, undefined, '', 'POLYGON ((0 0, 1 1, 1 0, 0 0))', 'POINT (0 0)', 'POINT (200 10)', 'POINT (10 95)']) {
      expect(parseCentroid(bad)).toBeNull()
    }
  })
})

describe('activationTime', () => {
  it('reads CEMS times as UTC', () => {
    expect(activationTime(VALENCIA)!.toISOString()).toBe('2026-10-19T16:03:00.000Z')
    expect(activationTime({ activationTime: '2026-10-19T16:03:00Z' })!.toISOString()).toBe('2026-10-19T16:03:00.000Z')
    expect(activationTime({ activationTime: '' })).toBeNull()
    expect(activationTime({ activationTime: 'soon' })).toBeNull()
  })
})

describe('newActivations', () => {
  it('keeps response-phase activations of the last 3 days that were not seen before', () => {
    expect(newActivations([VALENCIA, PANAMA], new Set(), NOW).map(a => a.code)).toEqual(['EMSR935'])
  })
  it('leaves out seen, old, recovery-phase and malformed ones', () => {
    const recovery = { ...VALENCIA, code: 'EMSR936', drmPhase: 'recovery' }
    const noName = { ...VALENCIA, code: 'EMSR937', name: ' ' }
    const notEmsr = { ...VALENCIA, code: 'EMSN200' }
    expect(newActivations([VALENCIA], new Set(['EMSR935']), NOW)).toEqual([])
    expect(newActivations([recovery, noName, notEmsr, PANAMA], new Set(), NOW)).toEqual([])
  })
  it('takes an activation with no phase as a response', () => {
    expect(newActivations([{ ...VALENCIA, drmPhase: null }], new Set(), NOW)).toHaveLength(1)
  })
})

describe('the signal', () => {
  it('names the disaster, the activation and the source in plain words', () => {
    const { title, summary } = cemsText(VALENCIA)
    expect(title).toBe('Flood in Alicante-Valencia Regions, Spain: EU emergency satellite mapping activated (EMSR935)')
    expect(summary).toContain('Up to 500 rescues were carried out within 12 hours.')
    expect(summary).not.toContain('\r')
    expect(summary).toContain('activation EMSR935 on 2026-10-19 16:03 UTC')
    expect(summary).toContain('Source: Copernicus Emergency Management Service')
  })
  it('pins the place the activation names', () => {
    expect(cemsPlaceName(VALENCIA)).toBe('Alicante-Valencia Regions, Spain')
    expect(cemsPlaceName({ name: 'Wildfires', countries: [{ short_name: 'Greece' }, { short_name: 'Albania' }] })).toBe('Greece, Albania')
    expect(cemsPlaceName({ name: 'Wildfires', countries: [] })).toBeNull()
  })
  it('is a high-severity disaster, a humanitarian activation humanitarian', () => {
    expect(cemsCategory('flood')).toBe('disaster')
    expect(cemsCategory('humanitarian')).toBe('humanitarian')
    expect(cemsCategory(null)).toBe('disaster')
    expect(cemsSeverity(VALENCIA)).toBe('high')
    expect(cemsSeverity({ countries: [] })).toBe('medium')
  })
})

describe('sources off without an account (plan N11)', () => {
  it('ACLED needs its key and email', () => {
    expect(acledConfigured({})).toBe(false)
    expect(acledConfigured({ ACLED_API_KEY: 'k' })).toBe(false)
    expect(acledConfigured({ ACLED_API_KEY: ' ', ACLED_API_EMAIL: 'a@b.c' })).toBe(false)
    expect(acledConfigured({ ACLED_API_KEY: 'k', ACLED_API_EMAIL: 'a@b.c' })).toBe(true)
  })
  it('ReliefWeb needs an approved app name', () => {
    expect(reliefWebConfigured({})).toBe(false)
    expect(reliefWebConfigured({ RELIEFWEB_APPNAME: '  ' })).toBe(false)
    expect(reliefWebConfigured({ RELIEFWEB_APPNAME: 'worldpulse' })).toBe(true)
  })
})

describe('GDELT events from its storage bucket (plan N11)', () => {
  it('moves data.gdeltproject.org addresses to the bucket and leaves others alone', () => {
    expect(bucketUrl('http://data.gdeltproject.org/gdeltv2/20261030051500.export.CSV.zip'))
      .toBe('https://storage.googleapis.com/data.gdeltproject.org/gdeltv2/20261030051500.export.CSV.zip')
    expect(bucketUrl('https://data.gdeltproject.org/gdeltv2/X.export.CSV.zip'))
      .toBe('https://storage.googleapis.com/data.gdeltproject.org/gdeltv2/X.export.CSV.zip')
    expect(bucketUrl('https://example.org/gdeltv2/X.export.CSV.zip')).toBe('https://example.org/gdeltv2/X.export.CSV.zip')
  })
})
