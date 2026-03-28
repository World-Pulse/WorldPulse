/**
 * USPTO PatentsView Defense Patent Signal Source — Unit Tests
 *
 * Tests for: patentSeverity, defenseCategory, buildPatentTitle,
 * extractPrimaryAssignee, inferPatentLocation, patentDedupKey
 */

import { describe, it, expect } from 'vitest'
import {
  patentSeverity,
  defenseCategory,
  buildPatentTitle,
  extractPrimaryAssignee,
  inferPatentLocation,
  patentDedupKey,
  DEFENSE_CPC_CODES,
} from '../patents'

// ─── patentSeverity ───────────────────────────────────────────────────────────

describe('patentSeverity', () => {
  it('returns critical for nuclear weapon keywords', () => {
    expect(patentSeverity('G21J', 'Nuclear Weapon Detonation System', '')).toBe('critical')
  })

  it('returns critical for hypersonic keyword in title', () => {
    expect(patentSeverity('F41A', 'Hypersonic Glide Vehicle Thermal Protection System', '')).toBe('critical')
  })

  it('returns critical for directed-energy weapon in abstract', () => {
    expect(patentSeverity('H01S', 'High Power Laser System', 'Directed-energy weapon for aerial target engagement')).toBe('critical')
  })

  it('returns critical for CPC code G21J (nuclear explosives)', () => {
    expect(patentSeverity('G21J3', 'Fission Device', 'Compact nuclear device')).toBe('critical')
  })

  it('returns critical for offensive cyber keyword', () => {
    expect(patentSeverity('H04L', 'Network Intrusion', 'Offensive cyber exploit delivery mechanism')).toBe('critical')
  })

  it('returns high for missile guidance keyword', () => {
    expect(patentSeverity('F42B15', 'Missile Guidance System', 'Inertial navigation for ballistic trajectory')).toBe('high')
  })

  it('returns high for anti-satellite keyword', () => {
    expect(patentSeverity('G01S', 'ASAT Interception System', 'Anti-satellite kinetic kill vehicle')).toBe('high')
  })

  it('returns high for electronic warfare keyword', () => {
    expect(patentSeverity('H04K', 'Signal Jammer', 'Electronic warfare platform for electronic jamming')).toBe('high')
  })

  it('returns high for CPC code F41 (weapons)', () => {
    expect(patentSeverity('F41A9', 'Weapon Mechanism', 'Loading mechanism for automatic weapons')).toBe('high')
  })

  it('returns high for stealth technology keyword in abstract', () => {
    expect(patentSeverity('B64C', 'Composite Airframe', 'Stealth technology composite material for low-observable aircraft')).toBe('high')
  })

  it('returns medium for dual-use keyword', () => {
    expect(patentSeverity('H04N7', 'Imaging System', 'Dual-use imaging sensor for civil and military applications')).toBe('medium')
  })

  it('returns medium for autonomous weapon keyword', () => {
    expect(patentSeverity('B64U', 'UAV Control', 'Lethal autonomous decision system for unmanned vehicles')).toBe('medium')
  })

  it('returns medium for CPC G01S (radar/sonar)', () => {
    expect(patentSeverity('G01S7', 'Radar Signal Processing', 'Maritime search radar')).toBe('medium')
  })

  it('returns medium for CPC H04L9 (cryptography)', () => {
    expect(patentSeverity('H04L9/28', 'Encryption Algorithm', 'Post-quantum lattice-based cryptographic scheme')).toBe('medium')
  })

  it('returns low for general aerospace CPC', () => {
    expect(patentSeverity('B64G1', 'Spacecraft Structure', 'Lightweight structural panel for satellite buses')).toBe('low')
  })

  it('returns low for generic defense base with no keywords', () => {
    expect(patentSeverity('G21C', 'Reactor Fuel Rod', 'Ceramic fuel rod assembly for civilian nuclear reactor')).toBe('low')
  })
})

// ─── defenseCategory ─────────────────────────────────────────────────────────

describe('defenseCategory', () => {
  it('maps F41 to Weapons', () => {
    expect(defenseCategory('F41A3')).toBe('Weapons')
  })

  it('maps F42 to Ammunition and Explosives', () => {
    expect(defenseCategory('F42B')).toBe('Ammunition and Explosives')
  })

  it('maps G21 to Nuclear Physics; Nuclear Engineering', () => {
    expect(defenseCategory('G21C')).toBe('Nuclear Physics; Nuclear Engineering')
  })

  it('maps H04K to Secret Communication; Jamming of Communication', () => {
    expect(defenseCategory('H04K1')).toBe('Secret Communication; Jamming of Communication')
  })

  it('maps B64U to Unmanned Aerial Vehicles', () => {
    expect(defenseCategory('B64U10')).toBe('Unmanned Aerial Vehicles')
  })

  it('falls back to Defense Technology for unknown CPC', () => {
    expect(defenseCategory('A01B')).toBe('Defense Technology')
  })
})

// ─── buildPatentTitle ─────────────────────────────────────────────────────────

describe('buildPatentTitle', () => {
  it('includes patent ID in parentheses', () => {
    const result = buildPatentTitle('US12345678', 'Laser Targeting System', null)
    expect(result).toContain('(US12345678)')
  })

  it('includes assignee when provided', () => {
    const result = buildPatentTitle('US12345678', 'Radar System', 'Raytheon Technologies')
    expect(result).toContain('— Raytheon Technologies')
  })

  it('omits assignee suffix when null', () => {
    const result = buildPatentTitle('US12345678', 'Stealth Material', null)
    expect(result).not.toContain('—')
    expect(result).toContain('US12345678')
  })

  it('truncates titles longer than 120 characters', () => {
    const longTitle = 'A'.repeat(130)
    const result = buildPatentTitle('US99', longTitle, null)
    expect(result.length).toBeLessThan(200)
    expect(result).toContain('…')
  })

  it('preserves titles of exactly 120 characters without truncation', () => {
    const title120 = 'B'.repeat(120)
    const result = buildPatentTitle('US100', title120, null)
    expect(result).not.toContain('…')
  })

  it('starts with "Patent:" prefix', () => {
    const result = buildPatentTitle('US1', 'Test', null)
    expect(result.startsWith('Patent:')).toBe(true)
  })
})

// ─── extractPrimaryAssignee ───────────────────────────────────────────────────

describe('extractPrimaryAssignee', () => {
  it('returns the first assignee organization', () => {
    expect(extractPrimaryAssignee([
      { assignee_organization: 'Lockheed Martin', assignee_country: 'US' },
      { assignee_organization: 'DARPA', assignee_country: 'US' },
    ])).toBe('Lockheed Martin')
  })

  it('returns null for empty array', () => {
    expect(extractPrimaryAssignee([])).toBeNull()
  })

  it('returns null for null input', () => {
    expect(extractPrimaryAssignee(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(extractPrimaryAssignee(undefined)).toBeNull()
  })

  it('returns null when first assignee has null organization', () => {
    expect(extractPrimaryAssignee([{ assignee_organization: null }])).toBeNull()
  })
})

// ─── inferPatentLocation ──────────────────────────────────────────────────────

describe('inferPatentLocation', () => {
  it('resolves Lockheed Martin to US', () => {
    const loc = inferPatentLocation('Lockheed Martin Corporation')
    expect(loc.countryCode).toBe('US')
    expect(loc.lat).toBeCloseTo(38.90, 1)
  })

  it('resolves BAE Systems to GB', () => {
    const loc = inferPatentLocation('BAE Systems PLC')
    expect(loc.countryCode).toBe('GB')
  })

  it('resolves Airbus to FR', () => {
    const loc = inferPatentLocation('Airbus Defence and Space SAS')
    expect(loc.countryCode).toBe('FR')
  })

  it('resolves Rheinmetall to DE', () => {
    const loc = inferPatentLocation('Rheinmetall AG')
    expect(loc.countryCode).toBe('DE')
  })

  it('resolves U.S. Navy to US', () => {
    const loc = inferPatentLocation('The United States of America as represented by the U.S. Navy')
    expect(loc.countryCode).toBe('US')
  })

  it('resolves DARPA to US', () => {
    const loc = inferPatentLocation('DARPA')
    expect(loc.countryCode).toBe('US')
  })

  it('defaults to US for unknown assignee', () => {
    const loc = inferPatentLocation('Unknown Corp XYZ')
    expect(loc.countryCode).toBe('US')
  })

  it('defaults to US for null assignee', () => {
    const loc = inferPatentLocation(null)
    expect(loc.countryCode).toBe('US')
  })

  it('resolves Israel Aerospace to IL', () => {
    const loc = inferPatentLocation('Israel Aerospace Industries Ltd')
    expect(loc.countryCode).toBe('IL')
  })

  it('resolves NORINCO to CN', () => {
    const loc = inferPatentLocation('NORINCO Group Technology Inc')
    expect(loc.countryCode).toBe('CN')
  })
})

// ─── patentDedupKey ───────────────────────────────────────────────────────────

describe('patentDedupKey', () => {
  it('generates key with osint:patents: prefix', () => {
    expect(patentDedupKey('US12345678')).toBe('osint:patents:US12345678')
  })

  it('generates unique keys for different patent IDs', () => {
    expect(patentDedupKey('US111')).not.toBe(patentDedupKey('US222'))
  })

  it('preserves patent ID exactly', () => {
    const id = 'US-2026-0123456-A1'
    expect(patentDedupKey(id)).toBe(`osint:patents:${id}`)
  })
})

// ─── DEFENSE_CPC_CODES completeness check ────────────────────────────────────

describe('DEFENSE_CPC_CODES', () => {
  it('contains at least 12 defense/dual-use categories', () => {
    expect(Object.keys(DEFENSE_CPC_CODES).length).toBeGreaterThanOrEqual(12)
  })

  it('includes F41 (Weapons)', () => {
    expect(DEFENSE_CPC_CODES['F41']).toBeDefined()
  })

  it('includes G21 (Nuclear)', () => {
    expect(DEFENSE_CPC_CODES['G21']).toBeDefined()
  })

  it('includes H04K (Secret Communication / EW)', () => {
    expect(DEFENSE_CPC_CODES['H04K']).toBeDefined()
  })
})
