/**
 * The reader's two fixes of Oct 31, 2026 (Devon, 9:32 PM: "Implement all of the improvements you've just
 * suggested"): it takes a feed's newest items rather than its first 20 in file order (newestFirst), and it
 * dates an item from the future at the time it reads it (eventTimeOf). Round 8 found both: IranWire lists
 * 463 items oldest first, so the first 20 were a month old; Jordan News dates its items about 3 hours
 * ahead. That evening 43 of the 615 feeds that answered had fresh items below their first 20, newer than
 * some above them, and the Philippine Daily Inquirer's live page for Nov 1 sat at the top of the verified
 * stories dated 7.5 hours ahead of when it was posted.
 */
import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, HOME_PIN_SOURCES, parseFeedItems, newestFirst, eventTimeOf, FUTURE_SLACK_MS, inferGeo } from '../news-rss'

const item = (title: string, pubDate: string) => ({ title, link: `https://example.org/${encodeURIComponent(title)}`, pubDate, description: '' })

/** An RSS feed of n items, one an hour from Oct 1, 2026: listed oldest first like IranWire's, or newest first */
function feed(n: number, order: 'oldest first' | 'newest first'): string {
  const items = Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 1, 0, 0, 0) + i * 3_600_000).toUTCString()
    return `<item><title>Story ${i + 1}</title><link>https://example.org/${i + 1}</link><pubDate>${d}</pubDate></item>`
  })
  if (order === 'newest first') items.reverse()
  return `<rss version="2.0"><channel><title>A feed</title>\n${items.join('\n')}\n</channel></rss>`
}

describe('newestFirst', () => {
  it('puts dated items newest first', () => {
    const r = newestFirst([item('a', 'Thu, 01 Oct 2026 07:22:32 +0000'), item('b', 'Fri, 30 Oct 2026 15:48:00 +0000'), item('c', '2026-10-15T12:00:00Z')])
    expect(r.map(x => x.title)).toEqual(['b', 'c', 'a'])
  })

  it("leaves a feed that's already newest first as it is, and keeps the feed's order for items of the same time", () => {
    const sorted = [item('a', 'Sat, 31 Oct 2026 12:00:00 GMT'), item('b', 'Sat, 31 Oct 2026 11:00:00 GMT'), item('c', 'Sat, 31 Oct 2026 11:00:00 GMT')]
    expect(newestFirst(sorted).map(x => x.title)).toEqual(['a', 'b', 'c'])
  })

  it('counts an item without a readable date as new: those come first, in their own order', () => {
    const r = newestFirst([item('dated', 'Sat, 31 Oct 2026 12:00:00 GMT'), item('none', ''), item('bad', 'sam, 31 Oktober'), item('older', 'Fri, 30 Oct 2026 12:00:00 GMT')])
    expect(r.map(x => x.title)).toEqual(['none', 'bad', 'dated', 'older'])
  })

  it('does not change the list it was given', () => {
    const list = [item('a', 'Thu, 01 Oct 2026 07:00:00 GMT'), item('b', 'Fri, 02 Oct 2026 07:00:00 GMT')]
    newestFirst(list)
    expect(list.map(x => x.title)).toEqual(['a', 'b'])
  })
})

describe('parseFeedItems takes the newest 20', () => {
  it("reads an oldest-first feed's newest items, not its oldest (IranWire)", () => {
    const items = parseFeedItems(feed(463, 'oldest first'))
    expect(items).toHaveLength(20)
    expect(items[0]!.title).toBe('Story 463')
    expect(items[19]!.title).toBe('Story 444')
  })

  it('takes the same 20, in the same order, from a newest-first feed', () => {
    const items = parseFeedItems(feed(30, 'newest first'))
    expect(items.map(x => x.title)).toEqual(Array.from({ length: 20 }, (_, i) => `Story ${30 - i}`))
  })
})

describe('eventTimeOf', () => {
  const now = Date.parse('2026-11-01T02:00:00Z')

  it('dates an item from the future at the time the reader reads it (Jordan News runs about 3 hours ahead)', () => {
    expect(eventTimeOf('Sun, 01 Nov 2026 05:00:00 GMT', now).toISOString()).toBe('2026-11-01T02:00:00.000Z')
    // the Inquirer's live page for Nov 1, dated 7.5 hours after it was posted
    expect(eventTimeOf('2026-11-01T07:24:59Z', now).getTime()).toBe(now)
  })

  it('keeps a date up to 10 minutes ahead (clocks differ a little), and every date in the past', () => {
    expect(FUTURE_SLACK_MS).toBe(10 * 60_000)
    expect(eventTimeOf('2026-11-01T02:09:00Z', now).toISOString()).toBe('2026-11-01T02:09:00.000Z')
    expect(eventTimeOf('2026-11-01T02:11:00Z', now).getTime()).toBe(now)
    expect(eventTimeOf('Sat, 31 Oct 2026 21:47:46 GMT', now).toISOString()).toBe('2026-10-31T21:47:46.000Z')
  })

  it('reads a time zone written with a colon (Korea Herald: "+09:00")', () => {
    expect(eventTimeOf('Sun, 01 Nov 2026 10:55:25 +09:00', now).toISOString()).toBe('2026-11-01T01:55:25.000Z')
  })

  it('uses the time of reading when there is no date or it cannot be read', () => {
    expect(eventTimeOf(undefined, now).getTime()).toBe(now)
    expect(eventTimeOf('', now).getTime()).toBe(now)
    expect(eventTimeOf('not a date', now).getTime()).toBe(now)
  })
})

describe('the feeds the fixes let in', () => {
  const src = (id: string) => NEWS_SOURCE_REGISTRY.find(s => s.id === id)!

  it('reads IranWire, an independent newsroom on Iran run from London, once and at its own address', () => {
    expect(NEWS_SOURCE_REGISTRY.filter(s => s.id === 'iranwire-en')).toHaveLength(1)
    expect(src('iranwire-en')).toMatchObject({ feedUrl: 'https://iranwire.com/en/feed/', countryCode: 'IR', language: 'en', biasLabel: 'center' })
    expect(NEWS_SOURCE_REGISTRY.filter(s => s.feedUrl.includes('iranwire.com'))).toHaveLength(1)
    expect(src('iranwire-en').extraTags).toContain('exile-media')
    // a newsroom in exile isn't pinned at home (as Meydan TV): its stories name their places
    expect(HOME_PIN_SOURCES.has('iranwire-en')).toBe(false)
    expect(inferGeo('January Protester Sentenced to Death for Second Time in Tehran', '', src('iranwire-en')).countryCode).toBe('IR')
  })

  it('leaves Jordan News out: its terms allow "personal, non-commercial use only", and they name RSS feeds', () => {
    expect(NEWS_SOURCE_REGISTRY.some(s => s.feedUrl.includes('jordannews.jo'))).toBe(false)
  })
})
