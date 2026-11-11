/**
 * Fact-checks beside verified stories (Nov 11, 2026): fact-checkers' feeds read into checks, in their own
 * shapes (the items here are made up, written the way each feed writes them).
 */

import { describe, it, expect } from 'vitest'
import {
  FACT_CHECKERS, readCheckerFeed, ratingOf, mergeChecks, addFingerprints, encodeVec, itemId, checkText,
  type FactCheckItem,
} from '../fact-checks'
import { FINGERPRINT_MODEL } from '../../lib/fingerprint'

const checker = (id: string) => FACT_CHECKERS.find(c => c.id === id)!

// PolitiFact: the description is the claim; the rating is the alt text of the picture at the top of content:encoded
const POLITIFACT = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>PolitiFact - Social Feed</title>
<item>
  <title>Harbor bridge collapse video isn&#8217;t AI-generated, despite viral claims</title>
  <link>https://politifact.com/factchecks/2026/nov/02/tweets/harbor-bridge-collapse-video-ai/</link>
  <description>Footage of the Nov. 1 harbor bridge collapse &#8220;was 100%&#8221; generated with AI.</description>
  <pubDate>Mon, 02 Nov 2026 21:14:05 +0000</pubDate>
  <content:encoded><![CDATA[<div><img src="https://static.politifact.com/rulings/meter-pants-fire.jpg" alt="Pants on Fire!" /></div><p>Our ruling ...</p><img src="x.jpg" alt="False" />]]></content:encoded>
</item>
<item>
  <title>Mayor says the city cut crime in half. That&#8217;s Half True.</title>
  <link>https://www.politifact.com/factchecks/2026/oct/30/mayor/crime-cut-half/</link>
  <description>&#8220;We cut violent crime in half.&#8221;</description>
  <pubDate>Fri, 30 Oct 2026 20:03:14 +0000</pubDate>
  <content:encoded>&lt;img src="a.jpg" alt="Screenshot of a social media post"&gt;&lt;img src="meter.jpg" alt="Half-True"&gt;</content:encoded>
</item>
<item>
  <title>A link somewhere else</title>
  <link>https://example.com/politifact-copy/</link>
  <description>Not PolitiFact's own page.</description>
  <pubDate>Fri, 30 Oct 2026 20:03:14 +0000</pubDate>
</item>
<item>
  <title>No date</title>
  <link>https://www.politifact.com/factchecks/2026/oct/30/undated/</link>
</item>
</channel></rss>`

// Full Fact: a short feed, the description is its own summary, no ratings
const FULL_FACT = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>Full Fact - All content</title>
<item><title>Harbor bridge collapse was real, not staged to hide a missile strike</title>
<link>https://fullfact.org/online/harbor-bridge-collapse-real/</link>
<description>False claims that the collapse, which killed nine people, was staged have spread online.</description>
<pubDate>Wed, 04 Nov 2026 16:00:49 +0000</pubDate><guid>https://fullfact.org/online/harbor-bridge-collapse-real/</guid></item>
<item><title>Brushes sterilised with gas are safe</title>
<link>https://fullfact.org/health/brushes-safe/</link>
<description></description>
<pubDate>Tue, 03 Nov 2026 16:48:00 +0000</pubDate></item>
</channel></rss>`

const NOW = Date.parse('2026-11-11T15:00:00Z')

describe("reading a fact-checker's feed", () => {
  it("keeps PolitiFact's claim and its own rating, as written", () => {
    const items = readCheckerFeed(POLITIFACT, checker('politifact'), NOW)
    expect(items.map(i => i.title)).toEqual([
      'Harbor bridge collapse video isn’t AI-generated, despite viral claims',
      'Mayor says the city cut crime in half. That’s Half True.',
    ])
    const [first, second] = items
    expect(first).toMatchObject({
      checker: 'politifact', name: 'PolitiFact', rating: 'Pants on Fire!', summary: null,
      claim: 'Footage of the Nov. 1 harbor bridge collapse “was 100%” generated with AI.',
      url: 'https://politifact.com/factchecks/2026/nov/02/tweets/harbor-bridge-collapse-video-ai/',
      published: '2026-11-02T21:14:05.000Z', language: 'en', vec: null, model: null,
    })
    expect(first!.id).toBe(itemId(first!.url))
    // the first picture whose alt text is a rating, after a screenshot's, from escaped HTML
    expect(second!.rating).toBe('Half-True')
  })

  it("leaves out checks without a date and links that aren't on the checker's site", () => {
    const urls = readCheckerFeed(POLITIFACT, checker('politifact'), NOW).map(i => i.url)
    expect(urls.some(u => u.includes('example.com'))).toBe(false)
    expect(urls.some(u => u.includes('undated'))).toBe(false)
  })

  it("keeps Full Fact's own summary, with no claim or rating of ours", () => {
    const items = readCheckerFeed(FULL_FACT, checker('full-fact'), NOW)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      name: 'Full Fact', claim: null, rating: null,
      summary: 'False claims that the collapse, which killed nine people, was staged have spread online.',
    })
    expect(items[1]!.summary).toBeNull()
  })

  it('reads only ratings from alt texts', () => {
    expect(ratingOf('<img alt="Mostly False" src="m.jpg">')).toBe('Mostly False')
    expect(ratingOf('<img alt="A false claim spread on Facebook">')).toBeNull()
    expect(ratingOf('<img src="m.jpg">')).toBeNull()
    expect(ratingOf("<img alt='Full Flop'>")).toBe('Full Flop')
  })

  it('takes a date ahead of now as now', () => {
    const ahead = FULL_FACT.replace('Wed, 04 Nov 2026 16:00:49 +0000', 'Thu, 12 Nov 2026 16:00:49 +0000')
    expect(readCheckerFeed(ahead, checker('full-fact'), NOW)[0]!.published).toBe(new Date(NOW).toISOString())
  })
})

const check = (url: string, published: string, extra: Partial<FactCheckItem> = {}): FactCheckItem => ({
  id: itemId(url), checker: 'full-fact', name: 'Full Fact', title: `Check ${url}`, url, published,
  claim: null, rating: null, summary: 'A summary', language: 'en', model: null, vec: null, ...extra,
})

describe('keeping checks', () => {
  it('keeps one per link, newest first, for 60 days, and a fingerprint while the text is the same', () => {
    const vec = encodeVec(new Float32Array([1, 0, 0]))
    const kept = [
      check('https://fullfact.org/a/', '2026-11-01T00:00:00Z', { vec, model: FINGERPRINT_MODEL }),
      check('https://fullfact.org/b/', '2026-11-02T00:00:00Z', { vec, model: FINGERPRINT_MODEL }),
      check('https://fullfact.org/old/', '2026-09-01T00:00:00Z'),
    ]
    const fresh = [
      check('https://fullfact.org/a/', '2026-11-01T00:00:00Z'),
      check('https://fullfact.org/b/', '2026-11-02T00:00:00Z', { summary: 'Updated after a correction' }),
      check('https://fullfact.org/c/', '2026-11-10T00:00:00Z'),
    ]
    const merged = mergeChecks(kept, fresh, NOW)
    expect(merged.map(i => i.url)).toEqual(['https://fullfact.org/c/', 'https://fullfact.org/b/', 'https://fullfact.org/a/'])
    expect(merged.find(i => i.url.endsWith('/a/'))!.vec).toBe(vec)
    // its text changed: fingerprinted again
    expect(merged.find(i => i.url.endsWith('/b/'))!.vec).toBeNull()
    expect(merged.find(i => i.url.endsWith('/b/'))!.summary).toBe('Updated after a correction')
  })

  it('fingerprints the checks that have none, from the headline and the claim or summary, once the model is ready', () => {
    const items = [check('https://fullfact.org/a/', '2026-11-01T00:00:00Z'), check('https://fullfact.org/b/', '2026-11-02T00:00:00Z', { title: '???' })]
    expect(addFingerprints(items, null)).toBe(false)
    expect(items.every(i => i.vec === null)).toBe(true)
    const texts: string[] = []
    const embed = (text: string) => { texts.push(text); return text.startsWith('???') ? null : new Float32Array([0.6, 0.8]) }
    expect(addFingerprints(items, embed)).toBe(true)
    expect(texts[0]).toBe(checkText(items[0]!))
    expect(texts[0]).toBe('Check https://fullfact.org/a/. A summary')
    expect(items[0]!.model).toBe(FINGERPRINT_MODEL)
    const back = Buffer.from(items[0]!.vec!, 'base64')
    expect(Array.from(new Float32Array(back.buffer, back.byteOffset, back.byteLength / 4))).toEqual([Math.fround(0.6), Math.fround(0.8)])
    // no word of it known: none, and no harm
    expect(items[1]!.vec).toBeNull()
  })
})
