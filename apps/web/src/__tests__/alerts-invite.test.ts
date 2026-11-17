import { describe, it, expect } from 'vitest'
import { inviteHidden, INVITE_QUIET_DAYS } from '@/lib/alerts-invite'

describe('the alerts invitation (Nov 16, 2026)', () => {
  const now = Date.parse('2026-11-16T12:00:00Z')
  it('shows when "Not now" was never pressed', () => {
    expect(inviteHidden(null, now)).toBe(false)
    expect(inviteHidden('not a date', now)).toBe(false)
  })
  it('stays hidden for 30 days after "Not now", then shows again', () => {
    expect(inviteHidden('2026-11-10T12:00:00Z', now)).toBe(true)
    const past = new Date(now - (INVITE_QUIET_DAYS + 1) * 86_400_000).toISOString()
    expect(inviteHidden(past, now)).toBe(false)
  })
})
