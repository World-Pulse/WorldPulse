/**
 * Lloyd's List's headlines (Oct 23, 2026): the feed's items in its own shape (three of the Oct 23
 * items, trimmed), read into titles, clean links, sectors, topics and places.
 */

import { describe, it, expect } from 'vitest'
import { readFeed, mergeItems, placeOfTag, type ShippingHeadline } from '../lloyds-list'

const item = (id: string, title: string, slug: string, date: string, kind: string, tags: string[]): string => `
    <item>
      <guid isPermaLink="false">https://www.lloydslist.com/${id}/${slug}</guid>
      <link>https://www.lloydslist.com/${id}/${encodeURIComponent(slug)}?utm_source=search&amp;amp;utm_medium=RSS&amp;amp;utm_term=&amp;amp;utm_campaign=search_rss</link>
      <category>${kind}</category>
      <title>${title}</title>
      <description>An abstract we don't keep... </description>
      <media:content medium="image" url="https://www.lloydslist.com/-/media/x.png" width="200"><media:description type="plain">A caption</media:description></media:content>
      <id xmlns="maritime">${id}</id>
      <pubDate>${date}</pubDate>
      <author xmlns="http://www.w3.org/2005/Atom"><name>A Writer</name><email>writer@example.com</email></author>
      <taxonomy_items xmlns="maritime">
        ${tags.map(t => `<taxonomy_item>${t}</taxonomy_item>`).join('\n        ')}
      </taxonomy_items>
      <contenttype xmlns="maritime">${kind}</contenttype>
    </item>`

const FEED = `<?xml version="1.0" encoding="utf-8"?>
<rss xmlns:a10="http://www.w3.org/2005/Atom" version="2.0">
  <channel xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xmlns:maritime="https://www.lloydslist.com/Rss">
    <title>Lloyd's List</title>
    ${item('LL1158806', 'Crude tankers in correction mode after Hormuz-driven ‘super spike’', 'Crude tankers in correction mode after Hormuz-driven super spike', 'Fri, 23 Oct 2026 23:20:09 GMT', 'Analysis',
      ['Tankers and Gas', 'Strait of Hormuz crisis', 'VLCC', 'Freight rates'])}
    ${item('LL1158802', 'Seafarer killed, three missing after drone strike on vessel off Romania', 'Seafarer killed three missing after drone strike on vessel off Romania', 'Fri, 23 Oct 2026 17:10:13 GMT', 'News',
      ['Ukraine crisis', 'Casualty', 'Risk and Compliance', 'Dry Bulk', 'Crewing', 'Piracy and Security', 'Romania\n'])}
    ${item('LL1158790', 'P&amp;I rate hikes likely less steep than previously expected, says Field', 'PI rate hikes likely less steep', 'Fri, 23 Oct 2026 15:45:54 GMT', 'Interviews',
      ['Insurance', 'People', 'Finance', 'Lockton', 'International', 'Russian Federation\n', 'Middle East and Africa'])}
  </channel>
</rss>`

describe("reading Lloyd's List's feed", () => {
  const items = readFeed(FEED)

  it('reads each headline with a clean link and its date', () => {
    expect(items.map(i => i.id)).toEqual(['LL1158806', 'LL1158802', 'LL1158790'])
    expect(items[0]).toMatchObject({
      title: 'Crude tankers in correction mode after Hormuz-driven ‘super spike’',
      url: 'https://www.lloydslist.com/LL1158806/Crude%20tankers%20in%20correction%20mode%20after%20Hormuz-driven%20super%20spike',
      published: '2026-10-23T23:20:09.000Z', kind: 'Analysis',
    })
    expect(items[2]!.title).toBe('P&I rate hikes likely less steep than previously expected, says Field')
  })

  it('sorts the tags into sectors, topics and places', () => {
    expect(items[0]).toMatchObject({ sectors: ['Tankers and Gas', 'Freight rates'], topics: ['VLCC'] })
    expect(items[0]!.places).toEqual([{ key: 'sea:strait-of-hormuz', name: 'Strait of Hormuz', iso: null, lat: 26.57, lon: 56.25 }])
    expect(items[1]!.places).toEqual([{ key: 'RO', name: 'Romania', iso: 'RO', lat: 44.43, lon: 26.10 }])
    expect(items[1]!.topics).toContain('Ukraine crisis')
    // "International", "People" and wide regions are neither places nor topics
    expect(items[2]).toMatchObject({ sectors: ['Insurance', 'Finance'], topics: ['Lockton'] })
    expect(items[2]!.places.map(p => p.iso)).toEqual(['RU'])
  })

  it("keeps nothing it shouldn't: no abstracts, images or authors", () => {
    const text = JSON.stringify(items)
    for (const word of ['abstract', 'caption', 'writer@example.com', 'A Writer', 'media']) expect(text).not.toContain(word)
  })

  it("leaves out an item that mixes two articles, and the daily digest", () => {
    // Oct 23: "The Daily View" came with another article's id, date and tags (the link says LL1158800)
    const mixed = item('LL1158805', 'The Daily View: The Arctic is becoming part of shipping’s parallel order', 'x', 'Fri, 23 Oct 2026 16:40:28 GMT', 'Opinion', ['Mozambique', 'Nigeria'])
      .replace('https://www.lloydslist.com/LL1158805/x?', 'https://www.lloydslist.com/LL1158800/The%20Daily%20View?')
    const digest = item('LL1157562', 'Daily Briefing 23 October 2026', 'Daily Briefing 23 October 2026', 'Thu, 22 Oct 2026 16:34:00 GMT', 'News', ['Panama'])
    expect(readFeed(`<rss><channel>${mixed}${digest}</channel></rss>`)).toEqual([])
  })

  it('names places by their whole name only', () => {
    expect(placeOfTag('United Arab Emirates')?.iso).toBe('AE')
    expect(placeOfTag('South Korea')?.iso).toBe('KR')
    expect(placeOfTag('Red Sea Risk')?.name).toBe('Red Sea')
    expect(placeOfTag('Mediterranean Shipping Co')).toBeNull()
    expect(placeOfTag('China COSCO Shipping')).toBeNull()
    expect(placeOfTag('Asia Pacific')).toBeNull()
  })

  it('merges new headlines in, newest first, for 14 days', () => {
    const old: ShippingHeadline = { ...items[2]!, id: 'LL1', published: '2026-10-01T00:00:00.000Z' }
    const merged = mergeItems([old, items[1]!], items, Date.parse('2026-10-24T03:00:00Z'))
    expect(merged.map(i => i.id)).toEqual(['LL1158806', 'LL1158802', 'LL1158790'])
  })
})
