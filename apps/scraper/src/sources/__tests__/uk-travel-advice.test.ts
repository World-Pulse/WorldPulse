/**
 * UK travel advice (Nov 5, 2026). The entries are shaped as the Foreign Office's feed
 * (gov.uk/foreign-travel-advice.atom) gave them that day, with its summaries.
 */
import { describe, it, expect } from 'vitest'
import {
  adviceText, parseAdvice, adviceCategory, adviceSeverity, adviceIsNew, adviceSignalText, advicePlace,
} from '../uk-travel-advice'

const entry = (country: string, slug: string, updated: string, summary: string) =>
  `<entry>\n<id>https://www.gov.uk/foreign-travel-advice/${slug}#${updated}</id>\n<updated>${updated}</updated>\n` +
  `<link rel="alternate" type="text/html" href="https://www.gov.uk/foreign-travel-advice/${slug}"/>\n` +
  `<link rel="self" type="application/atom+xml" href="https://www.gov.uk/foreign-travel-advice/${slug}.atom"/>\n` +
  `<title>${country}</title>\n<summary type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>${summary}</p></div></summary>\n</entry>`

const FEED = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Travel Advice Summary</title>
${entry('Nicaragua', 'nicaragua', '2026-11-05T14:10:53+00:00', 'Updated information on visa requirements when travelling between Nicaragua, El Salvador, Guatemala and Honduras')}
${entry('Ghana', 'ghana', '2026-11-04T10:00:00+00:00', 'Ebola screening requirements')}
${entry('Chad', 'chad', '2026-11-04T09:00:00+00:00', 'Accuracy review covering visas, terrorism, kidnapping, politics, robbery and health')}
${entry('Paraguay', 'paraguay', '2026-11-03T12:00:00+00:00', 'Possible demonstrations and protests')}
${entry('Italy', 'italy', '2026-11-03T11:00:00+00:00', 'Removal of information about a national strike')}
${entry('Greece', 'greece', '2026-11-03T10:00:00+00:00', 'Winter weather and flash flooding')}
${entry('Ethiopia', 'ethiopia', '2026-10-30T10:00:00+00:00', 'FCDO advice against all travel within 10km of the Kenya border')}
${entry('Tanzania', 'tanzania', '2026-10-30T08:00:00+00:00', 'Security measures to reduce burglary risk in hotels and accommodation')}
${entry('Jordan', 'jordan', '2026-10-29T08:00:00+00:00', 'Updated information about the security situation')}
</feed>`
const byCountry = (c: string) => parseAdvice(FEED).find(u => u.country === c)!

describe('reading the feed', () => {
  it('reads each update with its country, page, time and summary', () => {
    const list = parseAdvice(FEED)
    expect(list).toHaveLength(9)
    expect(byCountry('Ghana')).toMatchObject({ slug: 'ghana', link: 'https://www.gov.uk/foreign-travel-advice/ghana', updated: '2026-11-04T10:00:00.000Z', text: 'Ebola screening requirements' })
  })

  it('reads the summary as plain text, escaped or not', () => {
    expect(adviceText('<div xmlns="x"><p>Possible &amp; actual <b>protests</b></p></div>')).toBe('Possible & actual protests')
    expect(adviceText('&lt;p&gt;Flooding&lt;/p&gt;')).toBe('Flooding')
  })

  it('skips entries without a gov.uk travel page or a date', () => {
    expect(parseAdvice(entry('X', 'x', 'soon', 'a'))).toEqual([])
    expect(parseAdvice('<entry><title>Y</title><link rel="alternate" href="https://example.com/y"/><updated>2026-11-05T00:00:00Z</updated></entry>')).toEqual([])
    expect(parseAdvice('')).toEqual([])
  })
})

describe('which updates are news', () => {
  const cat = (c: string) => adviceCategory(byCountry(c))
  it('takes safety, health and weather updates', () => {
    expect(cat('Paraguay')).toBe('security')
    expect(cat('Ethiopia')).toBe('security')
    expect(cat('Ghana')).toBe('health')
    expect(cat('Greece')).toBe('weather')
    expect(cat('Jordan')).toBe('security')
  })
  it('leaves out visa news, accuracy reviews, removals and burglary tips', () => {
    expect(cat('Nicaragua')).toBeNull()
    expect(cat('Chad')).toBeNull()
    expect(cat('Italy')).toBeNull()
    expect(cat('Tanzania')).toBeNull()
  })
  it('rates advice against travel medium and the rest low', () => {
    expect(adviceSeverity(byCountry('Ethiopia'))).toBe('medium')
    expect(adviceSeverity(byCountry('Paraguay'))).toBe('low')
  })
})

describe('newness', () => {
  const NOW = Date.parse('2026-11-05T12:00:00Z')
  it('signals an update later than the one kept, once', () => {
    const u = byCountry('Ghana')
    expect(adviceIsNew(u, '2026-11-01T00:00:00.000Z', NOW)).toBe(true)
    expect(adviceIsNew(u, u.updated, NOW)).toBe(false)
  })
  it('on a first read signals only the last 3 days', () => {
    expect(adviceIsNew(byCountry('Ghana'), null, NOW)).toBe(true)
    expect(adviceIsNew(byCountry('Ethiopia'), null, NOW)).toBe(false)
  })
})

describe('the signal', () => {
  it('says what changed and names the Foreign Office', () => {
    const { title, summary } = adviceSignalText(byCountry('Ethiopia'))
    expect(title).toBe('UK travel advice for Ethiopia updated: FCDO advice against all travel within 10km of the Kenya border')
    expect(summary).toContain('Foreign, Commonwealth & Development Office')
    expect(summary).toContain('2026-10-30')
  })
  it('places Jordan in Jordan, not in the US', () => {
    expect(advicePlace({ country: 'Jordan' })).toMatchObject({ countryCode: 'JO' })
    expect(advicePlace({ country: 'Paraguay' })).toMatchObject({ countryCode: 'PY' })
  })
})
