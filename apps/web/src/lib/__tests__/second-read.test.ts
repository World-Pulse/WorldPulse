/**
 * The second read's badge on the story page (plan 11; Devon, Oct 21, 2026).
 */
import { describe, it, expect } from 'vitest'
import { secondReadBadge } from '../second-read'

describe('secondReadBadge', () => {
  it('agrees, or says how the second read rates it', () => {
    expect(secondReadBadge({ verdict: 'agree', note: 'Agrees: HIGH, a new event. A strike.', at: null }))
      .toEqual({ label: 'Second read agrees', tone: 'agree', title: 'Second read by an AI model: Agrees: HIGH, a new event. A strike.' })
    expect(secondReadBadge({ verdict: 'lower', note: 'Rates it MEDIUM, not CRITICAL. Two injured.', at: null })?.label).toBe('Second read: medium')
    expect(secondReadBadge({ verdict: 'higher', note: 'Rates it CRITICAL, not HIGH.', at: null })?.label).toBe('Second read: critical')
    expect(secondReadBadge({ verdict: 'not_event', note: 'Reads as analysis, not a new event.', at: null })).toMatchObject({ label: 'Second read: analysis', tone: 'differ' })
    expect(secondReadBadge({ verdict: 'not_event', note: 'Reads as a roundup, not a new event.', at: null })?.label).toBe('Second read: a roundup')
  })
  it('nothing without a second read', () => {
    expect(secondReadBadge(null)).toBeNull()
    expect(secondReadBadge(undefined)).toBeNull()
  })
})
