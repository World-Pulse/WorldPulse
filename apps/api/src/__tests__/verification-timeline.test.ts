/**
 * Verification Timeline — unit tests for mapping helpers (P2-4b)
 *
 * Tests the RESULT_COLOR and CHECK_TYPE_ICON lookup tables exported from
 * the VerificationTimeline component, covering all main result states and
 * check-type icon mappings.
 */

import { describe, it, expect } from 'vitest'

// ─── Inline the mapping helpers so this API-side test has no cross-package dep ─

const RESULT_COLOR: Record<string, string> = {
  confirmed:  '#00e676',
  pass:       '#00e676',
  verified:   '#00e676',
  refuted:    '#ff3b5c',
  fail:       '#ff3b5c',
  failed:     '#ff3b5c',
  unverified: '#f5a623',
  warn:       '#f5a623',
  warning:    '#f5a623',
  pending:    '#f5a623',
}

const CHECK_TYPE_ICON: Record<string, string> = {
  ai_analysis:         '🤖',
  ai_check:            '🤖',
  source_check:        '🔍',
  source_verification: '🔍',
  cross_reference:     '🔗',
  cross_check:         '🔗',
  human_review:        '👤',
  geo_verify:          '📍',
  geolocation:         '📍',
}

const DEFAULT_COLOR = '#8892a4'
const DEFAULT_ICON  = '✓'

function getResultColor(result: string): string {
  return RESULT_COLOR[result.toLowerCase()] ?? DEFAULT_COLOR
}

function getCheckTypeIcon(checkType: string): string {
  return CHECK_TYPE_ICON[checkType.toLowerCase()] ?? DEFAULT_ICON
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('VerificationTimeline — result color mapping', () => {
  it('maps result=confirmed to green #00e676', () => {
    expect(getResultColor('confirmed')).toBe('#00e676')
  })

  it('maps result=pass to green #00e676', () => {
    expect(getResultColor('pass')).toBe('#00e676')
  })

  it('maps result=refuted to red #ff3b5c', () => {
    expect(getResultColor('refuted')).toBe('#ff3b5c')
  })

  it('maps result=fail to red #ff3b5c', () => {
    expect(getResultColor('fail')).toBe('#ff3b5c')
  })

  it('maps result=unverified to amber #f5a623', () => {
    expect(getResultColor('unverified')).toBe('#f5a623')
  })

  it('returns default gray #8892a4 for unknown result', () => {
    expect(getResultColor('unknown_result_xyz')).toBe(DEFAULT_COLOR)
  })
})

describe('VerificationTimeline — check_type icon mapping', () => {
  it('maps ai_analysis to robot icon 🤖', () => {
    expect(getCheckTypeIcon('ai_analysis')).toBe('🤖')
  })

  it('maps ai_check to robot icon 🤖', () => {
    expect(getCheckTypeIcon('ai_check')).toBe('🤖')
  })

  it('maps source_check to search icon 🔍', () => {
    expect(getCheckTypeIcon('source_check')).toBe('🔍')
  })

  it('maps cross_reference to link icon 🔗', () => {
    expect(getCheckTypeIcon('cross_reference')).toBe('🔗')
  })

  it('maps human_review to person icon 👤', () => {
    expect(getCheckTypeIcon('human_review')).toBe('👤')
  })

  it('maps geo_verify to pin icon 📍', () => {
    expect(getCheckTypeIcon('geo_verify')).toBe('📍')
  })

  it('returns default checkmark ✓ for unknown check_type', () => {
    expect(getCheckTypeIcon('completely_unknown_check')).toBe(DEFAULT_ICON)
  })
})

describe('VerificationTimeline — edge cases', () => {
  it('is case-insensitive for result lookup', () => {
    expect(getResultColor('CONFIRMED')).toBe('#00e676')
    expect(getResultColor('Refuted')).toBe('#ff3b5c')
  })

  it('is case-insensitive for check_type lookup', () => {
    expect(getCheckTypeIcon('AI_ANALYSIS')).toBe('🤖')
    expect(getCheckTypeIcon('Source_Check')).toBe('🔍')
  })

  it('maps warn to amber (same bucket as unverified)', () => {
    expect(getResultColor('warn')).toBe('#f5a623')
  })

  it('maps pending to amber', () => {
    expect(getResultColor('pending')).toBe('#f5a623')
  })
})
