/**
 * Tests for OFAC Sanctions + UN ReliefWeb humanitarian feeds
 * Covers severity mapping, location inference, and edge cases.
 */
import { describe, it, expect } from 'vitest'
import { sanctionsSeverity, inferSanctionsRegion } from '../ofac-sanctions'
import { disasterSeverity, extractDisasterLocation } from '../reliefweb'

// ─── OFAC SANCTIONS SEVERITY ────────────────────────────────────────────────

describe('sanctionsSeverity', () => {
  it('returns critical for Russia-related sanctions', () => {
    expect(sanctionsSeverity('Russia-related Designations', 'New designations', 'RUSSIA-EO14024')).toBe('critical')
  })

  it('returns critical for Iran sanctions', () => {
    expect(sanctionsSeverity('Iran-related Designations', 'IRGC entities', 'IRAN')).toBe('critical')
  })

  it('returns critical for North Korea/DPRK sanctions', () => {
    expect(sanctionsSeverity('DPRK Designations', 'WMD-related entities', 'NORTH KOREA')).toBe('critical')
  })

  it('returns critical for terrorism-related sanctions', () => {
    expect(sanctionsSeverity('Global Terrorism Designations', 'Terror finance', 'SDGT')).toBe('critical')
  })

  it('returns critical for cyber sanctions', () => {
    expect(sanctionsSeverity('Cyber-Related Designations', 'Ransomware actors', 'CYBER2')).toBe('critical')
  })

  it('returns critical for WMD/proliferation sanctions', () => {
    expect(sanctionsSeverity('Nonproliferation Designations', 'Weapons of mass destruction', 'WMD')).toBe('critical')
  })

  it('returns high for narcotics sanctions', () => {
    expect(sanctionsSeverity('Narcotics Designations', 'Drug trafficking', 'NARCOTICS')).toBe('high')
  })

  it('returns high for Magnitsky Act sanctions', () => {
    expect(sanctionsSeverity('Global Magnitsky Designations', 'Human rights abusers', 'GLOMAG')).toBe('high')
  })

  it('returns high for CAATSA sanctions', () => {
    expect(sanctionsSeverity('CAATSA-Related Designations', 'Section 231', 'CAATSA')).toBe('high')
  })

  it('returns medium for generic designation', () => {
    expect(sanctionsSeverity('New Designation', 'Entity added', 'OTHER')).toBe('medium')
  })

  it('returns low for removals', () => {
    expect(sanctionsSeverity('General License Issued', 'Removal from list', 'GENERAL')).toBe('low')
  })
})

// ─── OFAC LOCATION INFERENCE ────────────────────────────────────────────────

describe('inferSanctionsRegion', () => {
  it('returns Moscow coords for Russia-related text', () => {
    const loc = inferSanctionsRegion('Russia-related Designations')
    expect(loc).toEqual({ lat: 55.75, lon: 37.62 })
  })

  it('returns Tehran coords for Iran-related text', () => {
    const loc = inferSanctionsRegion('Iran sanctions update')
    expect(loc).toEqual({ lat: 35.69, lon: 51.39 })
  })

  it('returns Pyongyang coords for DPRK text', () => {
    const loc = inferSanctionsRegion('DPRK WMD proliferation')
    expect(loc).toEqual({ lat: 39.02, lon: 125.75 })
  })

  it('returns Pyongyang coords for North Korea text', () => {
    const loc = inferSanctionsRegion('North Korea missile program')
    expect(loc).toEqual({ lat: 39.02, lon: 125.75 })
  })

  it('returns DC coords for unlocated sanctions', () => {
    const loc = inferSanctionsRegion('General administrative update')
    expect(loc).toEqual({ lat: 38.89, lon: -77.04 })
  })

  it('returns Havana coords for Cuba text', () => {
    const loc = inferSanctionsRegion('Cuba sanctions program')
    expect(loc).toEqual({ lat: 23.11, lon: -82.37 })
  })
})

// ─── RELIEFWEB DISASTER SEVERITY ────────────────────────────────────────────

describe('disasterSeverity', () => {
  it('returns critical for earthquake', () => {
    expect(disasterSeverity('Turkey-Syria Earthquake', 'Earthquake', 'ongoing', 2)).toBe('critical')
  })

  it('returns critical for tsunami', () => {
    expect(disasterSeverity('Pacific Tsunami Warning', 'Tsunami', 'alert', 1)).toBe('critical')
  })

  it('returns critical for multi-country crisis (5+ countries)', () => {
    expect(disasterSeverity('Sahel Food Crisis', 'Food Insecurity', 'ongoing', 6)).toBe('critical')
  })

  it('returns critical for armed conflict', () => {
    expect(disasterSeverity('Armed Conflict in Sudan', 'Armed Conflict', 'ongoing', 1)).toBe('critical')
  })

  it('returns critical for famine', () => {
    expect(disasterSeverity('Famine in East Africa', 'Famine', 'ongoing', 3)).toBe('critical')
  })

  it('returns high for flood', () => {
    expect(disasterSeverity('Pakistan Floods 2026', 'Flood', 'ongoing', 1)).toBe('high')
  })

  it('returns high for epidemic', () => {
    expect(disasterSeverity('Cholera Epidemic', 'Epidemic', 'ongoing', 1)).toBe('high')
  })

  it('returns high for alert status', () => {
    expect(disasterSeverity('Tropical Storm Warning', 'Storm', 'alert', 1)).toBe('high')
  })

  it('returns high for refugee displacement', () => {
    expect(disasterSeverity('Refugee Crisis', 'Displacement', 'ongoing', 2)).toBe('high')
  })

  it('returns medium for generic ongoing disaster', () => {
    expect(disasterSeverity('Local Incident', 'Other', 'ongoing', 1)).toBe('medium')
  })

  it('returns low for past disaster', () => {
    expect(disasterSeverity('Past Event', 'Other', 'past', 1)).toBe('low')
  })
})

// ─── RELIEFWEB LOCATION EXTRACTION ─────────────────────────────────────────

describe('extractDisasterLocation', () => {
  it('returns null for empty countries array', () => {
    expect(extractDisasterLocation([])).toBeNull()
  })

  it('returns null for undefined countries', () => {
    // @ts-expect-error testing undefined input
    expect(extractDisasterLocation(undefined)).toBeNull()
  })

  it('uses location from country field when available', () => {
    const countries = [{ iso3: 'SYR', name: 'Syria', location: { lat: 34.80, lon: 38.99 } }]
    expect(extractDisasterLocation(countries)).toEqual({ lat: 34.80, lon: 38.99 })
  })

  it('falls back to ISO3 centroid lookup', () => {
    const countries = [{ iso3: 'AFG', name: 'Afghanistan' }]
    const loc = extractDisasterLocation(countries)
    expect(loc).toEqual({ lat: 33.94, lon: 67.71 })
  })

  it('returns null for unknown ISO3', () => {
    const countries = [{ iso3: 'ZZZ', name: 'Unknown' }]
    expect(extractDisasterLocation(countries)).toBeNull()
  })

  it('uses first country with location in multi-country array', () => {
    const countries = [
      { iso3: 'SDN', name: 'Sudan', location: { lat: 12.86, lon: 30.22 } },
      { iso3: 'SSD', name: 'South Sudan' },
    ]
    expect(extractDisasterLocation(countries)).toEqual({ lat: 12.86, lon: 30.22 })
  })
})
