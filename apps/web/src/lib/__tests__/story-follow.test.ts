/**
 * Follow a story (plan 8) and readers' flags (plan C5; Devon, Oct 21, 2026):
 * what the story page says.
 */
import { describe, it, expect } from 'vitest'
import { sinceLine, flagLine, authHeaders } from '../story-follow'

const NOW = Date.parse('2026-10-21T15:00:00Z')

describe('sinceLine', () => {
  it('says what changed since the last visit', () => {
    expect(sinceLine({ reports: 4, outlets: 2 }, '2026-10-21T12:00:00Z', NOW)).toBe('Since your last visit (3h ago): 4 new reports, 2 new outlets')
    expect(sinceLine({ reports: 1, outlets: 0 }, '2026-10-21T14:15:00Z', NOW)).toBe('Since your last visit (45 min ago): 1 new report')
    expect(sinceLine({ reports: 2, outlets: 1 }, '2026-10-18T15:00:00Z', NOW)).toBe('Since your last visit (3 days ago): 2 new reports, 1 new outlet')
  })
  it('nothing when nothing is new, or nothing is known', () => {
    expect(sinceLine({ reports: 0, outlets: 0 }, '2026-10-21T12:00:00Z', NOW)).toBeNull()
    expect(sinceLine(null, '2026-10-21T12:00:00Z', NOW)).toBeNull()
    expect(sinceLine({ reports: 3, outlets: 1 }, null, NOW)).toBeNull()
    expect(sinceLine({ reports: 3, outlets: 1 }, 'not a date', NOW)).toBeNull()
  })
})

describe('flagLine', () => {
  it('how many readers and why, the most given reason first', () => {
    expect(flagLine(3, { misinformation: 1, inaccurate: 2 })).toBe('Flagged by 3 readers as inaccurate (2), misinformation (1)')
    expect(flagLine(1, { duplicate: 1 })).toBe('Flagged by 1 reader as a duplicate (1)')
  })
  it('the count alone until the reasons arrive; nothing without flags', () => {
    expect(flagLine(2, null)).toBe('Flagged by 2 readers')
    expect(flagLine(2, { junk: 2 })).toBe('Flagged by 2 readers')
    expect(flagLine(0, { inaccurate: 1 })).toBeNull()
  })
})

describe('authHeaders', () => {
  it('the sign-in token when there is one', () => {
    expect(authHeaders({ getItem: () => 'tok' })).toEqual({ Authorization: 'Bearer tok' })
    expect(authHeaders({ getItem: () => null })).toBeNull()
    expect(authHeaders({ getItem: () => { throw new Error('blocked') } })).toBeNull()
    expect(authHeaders(null)).toBeNull()
  })
})
