/**
 * The single-source severity cap lifts once a story's outlets are counted
 * (Oct 11, 2026: the Riyadh airport attack, 25 outlets, was still medium).
 */

import { describe, it, expect } from 'vitest'
import { liftedSeverity, heldBySecondRead, readLoweredSql } from '../severity-lift'

const row = (title: string, severity = 'medium', category = 'conflict', summary: string | null = null) =>
  ({ id: 'x', title, summary, category, severity })

describe('liftedSeverity', () => {
  it('gives a corroborated report the severity its words earn', () => {
    expect(liftedSeverity(row('12 killed, 309 injured in Riyadh Airport attack'), 25)).toBe('high')
  })

  it('stays within what the outlet count allows', () => {
    const massacre = row('Missile attack kills 120 in crowded market')
    expect(liftedSeverity(massacre, 1)).toBeNull()        // one outlet: medium at most for conflict
    expect(liftedSeverity(massacre, 2)).toBe('high')      // two: high at most
    expect(liftedSeverity(massacre, 3)).toBe('critical')  // three or more: the words decide
  })

  it("doesn't raise a story for being reported widely", () => {
    expect(liftedSeverity(row('Trump says Ukraine should get a new president'), 12)).toBeNull()
  })

  it('never lowers', () => {
    expect(liftedSeverity(row('Talks resume in Geneva', 'high', 'geopolitics'), 5)).toBeNull()
  })
})

describe('after the second read lowered a report (plan 11a, Oct 22, 2026)', () => {
  const lowered = { ...row('Missile attack kills 120 in crowded market', 'medium'), read_lowered: true }

  it("its words don't lift it back while fewer than 3 outlets carry it", () => {
    expect(liftedSeverity(lowered, 2)).toBeNull()
    expect(heldBySecondRead(lowered, 2)).toBe(true)
  })

  it('with 3 or more, the rules apply again', () => {
    expect(liftedSeverity(lowered, 3)).toBe('critical')
    expect(heldBySecondRead(lowered, 3)).toBe(false)
    expect(heldBySecondRead({ read_lowered: false }, 1)).toBe(false)
  })

  it('reads the lowering from the verification log, the table named as the query names it', () => {
    expect(readLoweredSql()).toBe("EXISTS (SELECT 1 FROM verification_log rl WHERE rl.signal_id = signals.id AND rl.check_type = 'second_read' AND rl.result = 'lowered')")
    expect(readLoweredSql('s')).toContain('rl.signal_id = s.id')
  })
})
