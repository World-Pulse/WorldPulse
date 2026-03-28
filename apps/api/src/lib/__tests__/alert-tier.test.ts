/**
 * Alert Tier Classification Tests
 *
 * Tests for computeAlertTier() covering all classification paths.
 */

import { describe, it, expect } from 'vitest'
import {
  computeAlertTier,
  computeAlertTierFromRow,
  parseAlertTier,
  FLASH_RELIABILITY_THRESHOLD,
} from '../alert-tier'

describe('computeAlertTier', () => {
  // ─── FLASH tier ──────────────────────────────────────────────────────────

  it('classifies critical severity + reliability >= 0.65 as FLASH', () => {
    expect(computeAlertTier('critical', 0.65, 'conflict')).toBe('FLASH')
  })

  it('classifies critical severity + reliability 0.9 as FLASH', () => {
    expect(computeAlertTier('critical', 0.9, 'geopolitics')).toBe('FLASH')
  })

  it('classifies critical severity + reliability exactly at threshold as FLASH', () => {
    expect(computeAlertTier('critical', FLASH_RELIABILITY_THRESHOLD, 'health')).toBe('FLASH')
  })

  it('classifies breaking category + critical severity as FLASH (even below reliability threshold)', () => {
    expect(computeAlertTier('critical', 0.4, 'breaking')).toBe('FLASH')
  })

  it('classifies breaking category + critical severity with low reliability as FLASH', () => {
    expect(computeAlertTier('critical', 0.0, 'breaking')).toBe('FLASH')
  })

  // ─── PRIORITY tier ───────────────────────────────────────────────────────

  it('classifies critical severity below reliability threshold (non-breaking) as PRIORITY', () => {
    expect(computeAlertTier('critical', 0.3, 'economy')).toBe('PRIORITY')
  })

  it('classifies critical severity with reliability 0.64 as PRIORITY', () => {
    expect(computeAlertTier('critical', 0.64, 'technology')).toBe('PRIORITY')
  })

  it('classifies high severity as PRIORITY regardless of reliability', () => {
    expect(computeAlertTier('high', 0.9, 'other')).toBe('PRIORITY')
    expect(computeAlertTier('high', 0.1, 'other')).toBe('PRIORITY')
  })

  it('classifies conflict category + high severity as PRIORITY', () => {
    expect(computeAlertTier('high', 0.5, 'conflict')).toBe('PRIORITY')
  })

  it('classifies disaster category as PRIORITY even at medium severity', () => {
    expect(computeAlertTier('medium', 0.8, 'disaster')).toBe('PRIORITY')
  })

  it('classifies breaking category + high severity as PRIORITY', () => {
    expect(computeAlertTier('high', 0.7, 'breaking')).toBe('PRIORITY')
  })

  it('classifies conflict category + medium severity as PRIORITY', () => {
    expect(computeAlertTier('medium', 0.5, 'conflict')).toBe('PRIORITY')
  })

  // ─── ROUTINE tier ────────────────────────────────────────────────────────

  it('classifies medium severity in normal category as ROUTINE', () => {
    expect(computeAlertTier('medium', 0.8, 'technology')).toBe('ROUTINE')
  })

  it('classifies low severity as ROUTINE', () => {
    expect(computeAlertTier('low', 0.9, 'culture')).toBe('ROUTINE')
  })

  it('classifies info severity as ROUTINE', () => {
    expect(computeAlertTier('info', 1.0, 'sports')).toBe('ROUTINE')
  })

  it('classifies medium severity + high reliability in economy as ROUTINE', () => {
    expect(computeAlertTier('medium', 0.95, 'economy')).toBe('ROUTINE')
  })
})

describe('computeAlertTierFromRow', () => {
  it('works with snake_case DB row fields', () => {
    expect(computeAlertTierFromRow({
      severity:          'critical',
      reliability_score: 0.8,
      category:          'conflict',
    })).toBe('FLASH')
  })

  it('returns ROUTINE for low-severity row', () => {
    expect(computeAlertTierFromRow({
      severity:          'low',
      reliability_score: 0.5,
      category:          'sports',
    })).toBe('ROUTINE')
  })
})

describe('parseAlertTier', () => {
  it('passes through valid tiers', () => {
    expect(parseAlertTier('FLASH')).toBe('FLASH')
    expect(parseAlertTier('PRIORITY')).toBe('PRIORITY')
    expect(parseAlertTier('ROUTINE')).toBe('ROUTINE')
  })

  it('returns ROUTINE for null', () => {
    expect(parseAlertTier(null)).toBe('ROUTINE')
  })

  it('returns ROUTINE for undefined', () => {
    expect(parseAlertTier(undefined)).toBe('ROUTINE')
  })

  it('returns ROUTINE for unknown string', () => {
    expect(parseAlertTier('UNKNOWN')).toBe('ROUTINE')
    expect(parseAlertTier('')).toBe('ROUTINE')
  })
})
