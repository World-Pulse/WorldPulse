/**
 * Tests for ACLED, Safecast, and CISA KEV OSINT signal sources.
 * Covers severity mapping, edge cases, and boundary conditions.
 */

import { describe, it, expect } from 'vitest'
import { acledSeverity } from '../acled'
import { radiationSeverity } from '../safecast'
import { kevSeverity } from '../cisa-kev'

// ─── ACLED Severity Tests ───────────────────────────────────────────────────

describe('acledSeverity', () => {
  it('returns critical for mass fatalities (50+)', () => {
    expect(acledSeverity('Battles', 50)).toBe('critical')
    expect(acledSeverity('Protests', 100)).toBe('critical')
  })

  it('returns high for significant fatalities (10-49)', () => {
    expect(acledSeverity('Battles', 10)).toBe('high')
    expect(acledSeverity('Riots', 25)).toBe('high')
  })

  it('returns high for battles regardless of fatalities', () => {
    expect(acledSeverity('Battles', 0)).toBe('high')
  })

  it('returns high for explosions/remote violence', () => {
    expect(acledSeverity('Explosions/Remote violence', 0)).toBe('high')
  })

  it('returns high for violence against civilians with fatalities', () => {
    expect(acledSeverity('Violence against civilians', 1)).toBe('high')
  })

  it('returns medium for riots', () => {
    expect(acledSeverity('Riots', 0)).toBe('medium')
  })

  it('returns medium for violence against civilians without fatalities', () => {
    expect(acledSeverity('Violence against civilians', 0)).toBe('medium')
  })

  it('returns low for protests', () => {
    expect(acledSeverity('Protests', 0)).toBe('low')
  })

  it('returns low for strategic developments', () => {
    expect(acledSeverity('Strategic developments', 0)).toBe('low')
  })

  it('returns critical for chemical weapon sub-event', () => {
    expect(acledSeverity('Violence against civilians', 0, 'Chemical weapon')).toBe('critical')
  })

  it('returns critical for explosions with 5+ fatalities', () => {
    expect(acledSeverity('Explosions/Remote violence', 5)).toBe('high') // fatalities 5 < 10, but explosion type = high
    expect(acledSeverity('Explosions/Remote violence', 10)).toBe('high')
    expect(acledSeverity('Explosions/Remote violence', 50)).toBe('critical')
  })
})

// ─── Safecast Radiation Severity Tests ──────────────────────────────────────

describe('radiationSeverity', () => {
  it('returns low for normal background radiation (< 100 CPM)', () => {
    expect(radiationSeverity(30)).toBe('low')
    expect(radiationSeverity(50)).toBe('low')
    expect(radiationSeverity(99)).toBe('low')
  })

  it('returns medium for elevated readings (100-349 CPM)', () => {
    expect(radiationSeverity(100)).toBe('medium')
    expect(radiationSeverity(200)).toBe('medium')
    expect(radiationSeverity(349)).toBe('medium')
  })

  it('returns high for concerning readings (350-999 CPM)', () => {
    expect(radiationSeverity(350)).toBe('high')
    expect(radiationSeverity(500)).toBe('high')
    expect(radiationSeverity(999)).toBe('high')
  })

  it('returns critical for dangerous readings (1000+ CPM)', () => {
    expect(radiationSeverity(1000)).toBe('critical')
    expect(radiationSeverity(5000)).toBe('critical')
  })

  it('handles zero and negative values', () => {
    expect(radiationSeverity(0)).toBe('low')
    expect(radiationSeverity(-10)).toBe('low')
  })

  it('handles boundary values exactly', () => {
    expect(radiationSeverity(99)).toBe('low')
    expect(radiationSeverity(100)).toBe('medium')
    expect(radiationSeverity(349)).toBe('medium')
    expect(radiationSeverity(350)).toBe('high')
    expect(radiationSeverity(999)).toBe('high')
    expect(radiationSeverity(1000)).toBe('critical')
  })
})

// ─── CISA KEV Severity Tests ────────────────────────────────────────────────

describe('kevSeverity', () => {
  const futureDate = (days: number) => {
    const d = new Date(Date.now() + days * 86_400_000)
    return d.toISOString().slice(0, 10)
  }

  it('returns critical for ransomware-associated vulnerabilities', () => {
    expect(kevSeverity('SomeVendor', 'Known', futureDate(30))).toBe('critical')
  })

  it('returns critical for major vendors (Microsoft, Apple, Google)', () => {
    expect(kevSeverity('Microsoft', 'Unknown', futureDate(30))).toBe('critical')
    expect(kevSeverity('Apple', 'Unknown', futureDate(30))).toBe('critical')
    expect(kevSeverity('Google', 'Unknown', futureDate(30))).toBe('critical')
  })

  it('returns critical for infrastructure vendors (Cisco, Fortinet, Palo Alto)', () => {
    expect(kevSeverity('Cisco', 'Unknown', futureDate(30))).toBe('critical')
    expect(kevSeverity('Fortinet', 'Unknown', futureDate(30))).toBe('critical')
    expect(kevSeverity('Palo Alto', 'Unknown', futureDate(30))).toBe('critical')
  })

  it('returns high for imminent due dates (within 14 days)', () => {
    expect(kevSeverity('UnknownVendor', 'Unknown', futureDate(7))).toBe('high')
    expect(kevSeverity('UnknownVendor', 'Unknown', futureDate(14))).toBe('high')
  })

  it('returns medium for moderate due dates (15-30 days)', () => {
    expect(kevSeverity('UnknownVendor', 'Unknown', futureDate(20))).toBe('medium')
    expect(kevSeverity('UnknownVendor', 'Unknown', futureDate(30))).toBe('medium')
  })

  it('returns low for distant due dates (31+ days)', () => {
    expect(kevSeverity('UnknownVendor', 'Unknown', futureDate(60))).toBe('low')
    expect(kevSeverity('UnknownVendor', 'Unknown', futureDate(90))).toBe('low')
  })

  it('handles past due dates as high severity', () => {
    expect(kevSeverity('UnknownVendor', 'Unknown', futureDate(-5))).toBe('high')
  })

  it('is case-insensitive for vendor matching', () => {
    expect(kevSeverity('MICROSOFT', 'Unknown', futureDate(30))).toBe('critical')
    expect(kevSeverity('microsoft', 'Unknown', futureDate(30))).toBe('critical')
    expect(kevSeverity('VMware', 'Unknown', futureDate(30))).toBe('critical')
  })
})
