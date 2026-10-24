/**
 * The commodity watch on the website (Oct 23, 2026): the words and colours, a card, and the page.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { scoreColor, monthLabel, signedPct, dollarsK, partnersText, baciCredit, type CommodityCard, type CommodityOverview } from '@/lib/commodities'
import { CommodityCardView } from '@/components/commodities/CommodityCardView'
import { CommodityWatchView } from '@/components/commodities/CommodityWatchView'

const card: CommodityCard = {
  commodity: 'coffee', commodity_name: 'Coffee', group: 'softs', iso: 'BR', country: 'Brazil',
  outlook: { year: '2026/27', unit: '1000 60 KG BAGS', production: 71_900, previous: 63_000, change_pct: 14.1, revision_pct: null, share_pct: 37.9, estimate: '2026-07', text: "USDA: 71.9 million bags in 2026/27, up 14.1% on last year, 38% of the world's" },
  weather: { level: 3, weighted: 1.15, text: 'South Minas Gerais (Varginha): 4.8 mm of rain forecast in the next 10 days, 12% of normal, while the crop is flowering', regions: [] },
  trade: { unit: '1000 60 KG BAGS', exports: 49_070, exports_share_pct: 30.9, imports: 90, imports_share_pct: 0.1, us: null, text: "Exports 49.1 million bags, 31% of the world's" },
  market: { price: null, funds: null, text: 'Arabica coffee $7.26/kg in September, down 8.9% on the month' },
  news: { count: 1, latest: [{ id: 'abc', title: 'Coffee exports slow', created_at: '2026-10-19T00:00:00.000Z' }], text: '1 report in our sources in the last 14 days' },
  score: 55, call: 'cut likely', reasons: ['+40 High weather risk. South Minas Gerais', "+10 USDA expects a crop 14% bigger than last year's: room for a cut"],
  flag: { level: 3, text: 'Coffee in Brazil: dry' },
}

describe('words and colours', () => {
  it('colours the score at the calls\' breaks', () => {
    expect([scoreColor(55), scoreColor(30), scoreColor(10), scoreColor(5), scoreColor(0)]).toEqual(['#ef4444', '#f97316', '#f59e0b', '#38bdf8', '#475569'])
  })
  it('puts trade values and partners in words', () => {
    expect([dollarsK(12_000_000), dollarsK(4_372_678), dollarsK(952_801), dollarsK(48_065), dollarsK(180)]).toEqual(['$12 billion', '$4.4 billion', '$953 million', '$48 million', '$180,000'])
    expect(partnersText({ commodity: 'wheat', name: 'Wheat', value: 4_372_678, tonnes: null, top: [
      { iso: 'CN', name: 'China', value: 952_801, tonnes: null, share: 21.8 }, { iso: 'ID', name: 'Indonesia', value: 848_147, tonnes: null, share: 19.4 },
      { iso: 'PH', name: 'Philippines', value: 707_164, tonnes: null, share: 16.2 }, { iso: 'YE', name: 'Yemen', value: 448_288, tonnes: null, share: 10.3 },
    ] })).toBe('China 22%, Indonesia 19%, Philippines 16%')
    expect([baciCredit({ release: '202601' }), baciCredit({})]).toEqual(['CEPII BACI, January 2026 release', 'CEPII BACI'])
  })
  it('puts months and changes in words', () => {
    expect(monthLabel('2026-09')).toBe('September 2026')
    expect(signedPct(14.1)).toBe('+14.1%')
    expect(signedPct(-8.9)).toBe('−8.9%')
    expect(signedPct(null)).toBe('—')
  })
})

describe('a card', () => {
  it('shows the five readings, the score, the flag and why', () => {
    const html = renderToStaticMarkup(<CommodityCardView card={card} />)
    for (const text of ['Crop', 'Weather', 'Trade', 'Market', 'News', 'High risk. South Minas Gerais', 'Supply risk not in the news', 'Why 55', 'cut likely', 'href="/signals/abc"']) {
      expect(html).toContain(text)
    }
  })
  it('leaves trade and the reasons out when compact', () => {
    const html = renderToStaticMarkup(<CommodityCardView card={card} compact />)
    expect(html).not.toContain('Exports 49.1 million bags')
    expect(html).not.toContain('Why 55')
  })
})

describe('the page', () => {
  it('leads with the flags and lists every commodity', () => {
    const overview: CommodityOverview = {
      available: true, updated_at: '2026-10-24T10:00:00.000Z', sources: {}, counts: { cards: 2, flags: 1, commodities: 1 },
      scorecard: { outcomes: 0, by_call: {}, pending: 2 },
      flags: [{ commodity: 'coffee', commodity_name: 'Coffee', iso: 'BR', country: 'Brazil', score: 55, level: 3, text: 'Coffee in Brazil: dry' }],
      commodities: [{ key: 'coffee', name: 'Coffee', group: 'softs', countries: 2, flags: 1, top: { iso: 'BR', country: 'Brazil', score: 55, call: 'cut likely', headline: null } }],
    }
    const html = renderToStaticMarkup(<CommodityWatchView overview={overview} prices={null} />)
    expect(html).toContain('Supply risks not in the news')
    expect(html).toContain('Coffee · Brazil')
    expect(html).toContain('href="/commodities?commodity=coffee"')
    expect(html).toContain('No revisions checked yet: 2 calls are waiting for USDA')
  })
  it("says so before the watch has run", () => {
    expect(renderToStaticMarkup(<CommodityWatchView overview={null} prices={null} />)).toContain("hasn&#x27;t run yet")
  })
})
