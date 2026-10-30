/**
 * The email briefing's pure parts (plan G4): New York time, the email itself
 * and "New on WorldPulse". The database and Resend aren't touched here.
 */
import { describe, it, expect, vi } from 'vitest'

process.env.JWT_SECRET = 'test-secret-for-email-links'
vi.mock('../db/postgres', () => ({ db: Object.assign(() => ({}), { raw: async () => ({ rows: [] }), fn: { now: () => new Date() } }) }))
vi.mock('../db/redis', () => ({ redis: {} }))
const kept = { value: null as unknown }
vi.mock('../routes/stories', () => ({ topStories: async () => [], keptWeek: async () => kept.value }))

const { newYorkTime, newYorkMidnight, buildBriefingEmail, buildConfirmEmail, weekLabel, lastWeek, forSubscriber, yourCountryStories } = await import('../lib/briefing-email')
const { whatsNewSince } = await import('../lib/whats-new')
const { emailToken, verifyEmailToken, emailLink, normalizeEmail, splitFollows, joinFollows, countryName } = await import('../lib/subscribers')
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

describe('the weekly email (plan G11 slice 2, Oct 30, 2026)', () => {
  const unsubscribeUrl = 'https://api.world-pulse.io/api/v1/digest/unsubscribe?e=a%40b.c&t=x'
  const week = { name: '2026-W43', label: 'Oct 19 – 25', countries: [{ name: 'Israel', stories: 31 }, { name: 'Ukraine', stories: 24 }, { name: 'Sudan', stories: 0 }] }
  const email = buildBriefingEmail({
    stories: [story('Ceasefire talks resume in Cairo'), story('Floods in Nepal', { leadId: 'abcdef12-0000-0000-0000-000000000000', outletCount: 12 })] as never,
    whatsNew: [], dateLabel: 'Monday, October 26', weekly: true, unsubscribeUrl, week,
  })

  it('names the finished week: Monday to Sunday, across a month too', () => {
    expect(weekLabel({ year: 2026, week: 43 })).toBe('Oct 19 – 25')
    expect(weekLabel({ year: 2026, week: 44 })).toBe('Oct 26 – Nov 1')
  })
  it('says it is last week in the subject and the intro', () => {
    expect(email.subject).toBe('Last week: Ceasefire talks resume in Cairo + 1 more verified story')
    expect(email.text).toContain('Last week’s stories (Oct 19 – 25) that the most outlets confirmed')
  })
  it('links the week\'s page and lists the busiest countries', () => {
    expect(email.html).toContain('Read the whole week')
    expect(email.html).toContain('https://world-pulse.io/week/2026-W43?utm_source=email&amp;utm_medium=email&amp;utm_campaign=weekly')
    expect(email.text).toContain('The whole week: https://world-pulse.io/week/2026-W43?utm_source=email&utm_medium=email&utm_campaign=weekly')
    expect(email.text).toContain('BUSIEST COUNTRIES (verified stories)\nIsrael 31 · Ukraine 24')
    expect(email.text).not.toContain('Sudan')
  })
  it('the morning briefing has neither', () => {
    const daily = buildBriefingEmail({ stories: [story('Floods in Nepal')] as never, whatsNew: [], dateLabel: 'Friday, October 30', weekly: false, unsubscribeUrl, week })
    expect(daily.html).not.toContain('Read the whole week')
    expect(daily.text).not.toContain('BUSIEST COUNTRIES')
    expect(daily.subject).toBe('Floods in Nepal')
  })
  it('takes the stories from the finished week\'s page, or the last 7 days while it isn\'t made', async () => {
    kept.value = { success: true, data: { week: '2026-W43', stories: [story('Ceasefire talks resume in Cairo')], countries: week.countries } }
    const made = await lastWeek(new Date('2026-10-26T11:05:00Z'))
    expect(made.week).toMatchObject({ name: '2026-W43', label: 'Oct 19 – 25' })
    expect(made.stories).toHaveLength(1)
    kept.value = null
    expect((await lastWeek(new Date('2026-10-26T11:05:00Z'))).week).toBeNull()
  })
})

describe('follow your countries (plan G13, Oct 30, 2026)', () => {
  const unsubscribeUrl = 'https://api.world-pulse.io/api/v1/digest/unsubscribe?e=a%40b.c&t=x'
  const paris = story('Paris metro strike enters third day', { leadId: 'fr000000-0000-0000-0000-000000000000', place: 'Paris', outletCount: 9 })
  const tokyo = story('Tokyo raises its quake warning', { leadId: 'jp000000-0000-0000-0000-000000000000', place: 'Tokyo', outletCount: 14 })
  const world = story('Ceasefire talks resume in Cairo', { leadId: 'eg000000-0000-0000-0000-000000000000', outletCount: 120 })

  it('keeps followed countries beside the topics, without a new column', () => {
    expect(splitFollows(['conflict', 'country:fr', 'country:FR', 'country:XYZ', 7])).toEqual({ topics: ['conflict'], countries: ['FR'] })
    expect(joinFollows(['conflict'], ['jp', 'FR', 'JP'])).toEqual(['conflict', 'country:JP', 'country:FR'])
    expect(splitFollows(['country:A1', 'country:B2', 'country:C3', 'country:D4', 'country:E5', 'country:F6'].map(c => c.replace(/\d/, 'X'))).countries).toHaveLength(5)
    expect(countryName('FR')).toBe('France')
  })
  it('a followed country is not a topic filter', () => {
    expect(forSubscriber([world] as never, { categories: ['country:FR'], min_severity: 'info' }, 7)).toHaveLength(1)
    expect(forSubscriber([world] as never, { categories: ['economy'], min_severity: 'info' }, 7)).toHaveLength(0)
  })
  it('takes each country story once, the most outlets first, verified only, at most 3', () => {
    const unverified = story('Rumour in Lyon', { leadId: 'fr111111-0000-0000-0000-000000000000', verifiedAt: null, outletCount: 50 })
    const picked = yourCountryStories([[paris, unverified, tokyo], [tokyo]] as never, { categories: ['country:FR', 'country:JP'], min_severity: 'info' })
    expect(picked.map(s => s.leadId.slice(0, 2))).toEqual(['jp', 'fr'])
  })
  it('leads the email with the reader\'s countries, then the world without repeats', () => {
    const email = buildBriefingEmail({
      stories: [world, tokyo] as never, whatsNew: [], dateLabel: 'Friday, October 30', weekly: false, unsubscribeUrl,
      yourCountries: { names: ['France', 'Japan'], stories: [tokyo, paris] as never },
    })
    expect(email.html).toContain('Your countries')
    expect(email.html).toContain('· France, Japan')
    expect(email.html).toContain('The world')
    expect(email.text).toContain('YOUR COUNTRIES · France, Japan\n\n1. Tokyo raises its quake warning')
    expect(email.text.split('Tokyo raises its quake warning')).toHaveLength(2)   // not again in the world list
    expect(email.text).toContain('THE WORLD\n\n1. Ceasefire talks resume in Cairo')
    expect(email.subject).toBe('Ceasefire talks resume in Cairo + 1 more verified story')
  })
  it('says so when nothing was confirmed in them', () => {
    const email = buildBriefingEmail({
      stories: [world] as never, whatsNew: [], dateLabel: 'Friday, October 30', weekly: false, unsubscribeUrl,
      yourCountries: { names: ['France', 'Japan'], stories: [] },
    })
    expect(email.text).toContain('Nothing several outlets confirmed in France and Japan in the last 24 hours.')
  })
})
