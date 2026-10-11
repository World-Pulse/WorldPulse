/**
 * The email briefing's pure parts (plan G4): New York time, the email itself
 * and "New on WorldPulse". The database and Resend aren't touched here.
 */
import { describe, it, expect, vi } from 'vitest'

process.env.JWT_SECRET = 'test-secret-for-email-links'
vi.mock('../db/postgres', () => ({ db: Object.assign(() => ({}), { raw: async () => ({ rows: [] }), fn: { now: () => new Date() } }) }))
vi.mock('../db/redis', () => ({ redis: {} }))
vi.mock('../routes/stories', () => ({ topStories: async () => [] }))

const { newYorkTime, newYorkMidnight, buildBriefingEmail, buildConfirmEmail } = await import('../lib/briefing-email')
const { whatsNewSince } = await import('../lib/whats-new')
const { emailToken, verifyEmailToken, emailLink, normalizeEmail } = await import('../lib/subscribers')
const { outletNames, joinNames } = await import('../lib/outlet-names')

const story = (title: string, extra: Record<string, unknown> = {}) => ({
  id: 'k1', leadId: '11111111-2222-3333-4444-555555555555', title, category: 'conflict', place: 'Riyadh',
  severity: 'high', size: 3, outlets: ['wapt.com', 'aljazeera.com', 'bbc.co.uk'], outletCount: 82,
  firstSeenAt: '2026-10-12T01:00:00Z', updatedAt: '2026-10-12T05:00:00Z', verifiedAt: '2026-10-12T02:00:00Z', ...extra,
})

describe('New York time', () => {
  it('follows daylight saving', () => {
    expect(newYorkTime(new Date('2026-10-12T11:05:00Z'))).toMatchObject({ date: '2026-10-12', hour: 7, weekday: 'Mon' })
    expect(newYorkTime(new Date('2026-12-14T12:05:00Z'))).toMatchObject({ date: '2026-12-14', hour: 7 })
  })
  it('finds midnight in summer and winter', () => {
    expect(newYorkMidnight('2026-10-12').toISOString()).toBe('2026-10-12T04:00:00.000Z')
    expect(newYorkMidnight('2026-12-14').toISOString()).toBe('2026-12-14T05:00:00.000Z')
  })
})

describe('the briefing email', () => {
  const unsubscribeUrl = 'https://api.world-pulse.io/api/v1/digest/unsubscribe?e=a%40b.c&t=x'
  const email = buildBriefingEmail({
    stories: [story('Riyadh airport <b>hit</b> again & "again"'), story('Floods in Nepal', { leadId: 'abcdef12-0000-0000-0000-000000000000', outlets: ['france24.com', 'thehindu.com'], outletCount: 2 })] as never,
    whatsNew: [{ date: '2026-10-11', text: 'Share pictures for every story.', path: '/' }],
    dateLabel: 'Monday, October 12', weekly: false, unsubscribeUrl,
  })

  it('names the top story in the subject', () => {
    expect(email.subject).toBe('Riyadh airport <b>hit</b> again & "again" + 1 more verified story')
  })
  it('escapes headlines from the news in the HTML', () => {
    expect(email.html).toContain('Riyadh airport &lt;b&gt;hit&lt;/b&gt; again &amp; &quot;again&quot;')
    expect(email.html).not.toContain('<b>hit</b>')
  })
  it('says how many outlets back each story, best-known first', () => {
    expect(email.text).toContain('Verified · 82 outlets, including BBC, Al Jazeera and wapt.com')
    expect(email.text).toContain('Verified · 2 outlets, including France 24 and The Hindu')
  })
  it('links each story with tags and carries the unsubscribe link', () => {
    expect(email.text).toContain('https://world-pulse.io/signals/11111111-2222-3333-4444-555555555555?utm_source=email&utm_medium=email&utm_campaign=briefing&utm_content=11111111')
    expect(email.html).toContain(unsubscribeUrl.replace(/&/g, '&amp;'))
    expect(email.text).toContain(`Unsubscribe: ${unsubscribeUrl}`)
    expect(email.text).toContain('NEW ON WORLDPULSE')
  })
  it('the confirmation email links to the confirm address', () => {
    const c = buildConfirmEmail('https://api.world-pulse.io/api/v1/digest/confirm?e=a%40b.c&t=y')
    expect(c.subject).toBe('Confirm your WorldPulse briefing')
    expect(c.text).toContain('https://api.world-pulse.io/api/v1/digest/confirm?e=a%40b.c&t=y')
  })
})

describe('signed links', () => {
  it('sign one address for one purpose', () => {
    const t = emailToken('Reader@Example.com', 'unsubscribe')
    expect(t).toHaveLength(32)
    expect(verifyEmailToken('reader@example.com', 'unsubscribe', t)).toBe(true)
    expect(verifyEmailToken('reader@example.com', 'confirm', t)).toBe(false)
    expect(verifyEmailToken('other@example.com', 'unsubscribe', t)).toBe(false)
    expect(verifyEmailToken('reader@example.com', 'unsubscribe', 'z'.repeat(32))).toBe(false)
    expect(verifyEmailToken('reader@example.com', 'unsubscribe', undefined)).toBe(false)
  })
  it('build the API link', () => {
    expect(emailLink(' Reader@Example.com', 'confirm')).toMatch(/^https:\/\/api\.world-pulse\.io\/api\/v1\/digest\/confirm\?e=reader%40example\.com&t=[A-Za-z0-9_-]{32}$/)
    expect(normalizeEmail('  A@B.C ')).toBe('a@b.c')
  })
})

describe('New on WorldPulse', () => {
  it('shows each item once: what came out since the last briefing', () => {
    const now = new Date('2026-10-13T11:00:00Z')
    expect(whatsNewSince(new Date('2026-10-12T11:00:00Z'), now)).toHaveLength(0)
    expect(whatsNewSince(new Date('2026-10-11T11:00:00Z'), new Date('2026-10-12T11:00:00Z')).length).toBeGreaterThan(0)
    expect(whatsNewSince(null, new Date('2026-10-12T11:00:00Z')).length).toBeGreaterThan(0)
  })
})

describe('outlet names', () => {
  it('names well-known outlets first and joins them', () => {
    expect(outletNames(['wapt.com', 'yahoo.com', 'dw.com', 'reuters.com'])).toEqual(['Reuters', 'DW', 'wapt.com'])
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C')
  })
})
