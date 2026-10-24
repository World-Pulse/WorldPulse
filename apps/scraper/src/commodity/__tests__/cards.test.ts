/**
 * The commodity watch's cards, score, flag and calls (Oct 23, 2026). USDA's figures are its own
 * (the October 2026 PSD file, coffee and soybeans, some countries); prices the World Bank's for
 * September 2026; the weather the forecast in weather.test.ts made dry in South Minas Gerais.
 */

import { describe, it, expect, vi } from 'vitest'
// watch.ts stores flags through the signal pipeline, which opens Redis on import
vi.mock('../../pipeline/insert-signal', () => ({ insertAndCorrelate: vi.fn() }))

import { buildCard, buildCards, cardCountries, amount, yearLabel, priceLabel, flagTitle, type CardInputs } from '../cards'
import { updateCalls, scorecard, countForCountry, assessAll, type ForecastEntry, type NewsRow } from '../watch'
import { BY_KEY, COMMODITIES } from '../catalog'
import { REGIONS, pointKey } from '../regions'
import { assessRegion, countryWeather, type PointForecast } from '../weather'
import type { PsdSnapshot } from '../../sources/usda-psd'
import type { PricesSnapshot, PriceSeries } from '../../sources/worldbank-prices'

const PSD = JSON.parse("{\"file_date\":\"Fri, 09 Oct 2026 19:02:03 GMT\",\"release\":\"2026-10\",\"commodities\":{\"2222000\":{\"name\":\"Oilseed, Soybean\",\"unit\":\"1000 MT\",\"current_year\":2026,\"previous_year\":2025,\"countries\":{\"BR\":{\"iso\":\"BR\",\"name\":\"Brazil\",\"current\":{\"area\":50000,\"consumption\":69600,\"ending_stocks\":37281,\"exports\":118000,\"imports\":1000,\"production\":186000,\"yield\":3.72},\"previous\":{\"area\":48500,\"consumption\":66900,\"ending_stocks\":37881,\"exports\":114460,\"imports\":1053,\"production\":180500,\"yield\":3.72},\"estimate\":\"2026-10\"},\"US\":{\"iso\":\"US\",\"name\":\"United States\",\"current\":{\"area\":34755,\"consumption\":78702,\"ending_stocks\":8572,\"exports\":46130,\"imports\":680,\"production\":124147,\"yield\":3.57},\"previous\":{\"area\":32544,\"consumption\":75592,\"ending_stocks\":8577,\"exports\":41243,\"imports\":606,\"production\":115966,\"yield\":3.56},\"estimate\":\"2026-10\"},\"AR\":{\"iso\":\"AR\",\"name\":\"Argentina\",\"current\":{\"area\":17100,\"consumption\":49650,\"ending_stocks\":24071,\"exports\":6450,\"imports\":6500,\"production\":50000,\"yield\":2.92},\"previous\":{\"area\":16200,\"consumption\":48900,\"ending_stocks\":23671,\"exports\":8900,\"imports\":7500,\"production\":49300,\"yield\":3.04},\"estimate\":\"2026-10\"},\"CH\":{\"iso\":\"CN\",\"name\":\"China\",\"current\":{\"area\":10300,\"consumption\":136000,\"ending_stocks\":44259,\"exports\":100,\"imports\":115000,\"production\":21000,\"yield\":2.04},\"previous\":{\"area\":10300,\"consumption\":133900,\"ending_stocks\":44359,\"exports\":130,\"imports\":113000,\"production\":20900,\"yield\":2.03},\"estimate\":\"2026-10\"}}},\"0711100\":{\"name\":\"Coffee, Green\",\"unit\":\"1000 60 KG BAGS\",\"current_year\":2026,\"previous_year\":2025,\"countries\":{\"BR\":{\"iso\":\"BR\",\"name\":\"Brazil\",\"current\":{\"consumption\":22390,\"ending_stocks\":4425,\"exports\":49070,\"imports\":90,\"production\":71900},\"previous\":{\"consumption\":22280,\"ending_stocks\":3895,\"exports\":37870,\"imports\":90,\"production\":63000},\"estimate\":\"2026-07\"},\"VM\":{\"iso\":\"VN\",\"name\":\"Vietnam\",\"current\":{\"consumption\":5000,\"ending_stocks\":489,\"exports\":28950,\"imports\":1250,\"production\":32500},\"previous\":{\"consumption\":4900,\"ending_stocks\":689,\"exports\":28500,\"imports\":1300,\"production\":31700},\"estimate\":\"2026-07\"},\"CO\":{\"iso\":\"CO\",\"name\":\"Colombia\",\"current\":{\"consumption\":2200,\"ending_stocks\":670,\"exports\":13400,\"imports\":2004,\"production\":13400},\"previous\":{\"consumption\":2200,\"ending_stocks\":866,\"exports\":12810,\"imports\":2454,\"production\":12500},\"estimate\":\"2026-07\"},\"ID\":{\"iso\":\"ID\",\"name\":\"Indonesia\",\"current\":{\"consumption\":4830,\"ending_stocks\":671,\"exports\":8050,\"imports\":1420,\"production\":11380},\"previous\":{\"consumption\":4810,\"ending_stocks\":751,\"exports\":8842,\"imports\":1411,\"production\":12370},\"estimate\":\"2026-07\"},\"ET\":{\"iso\":\"ET\",\"name\":\"Ethiopia\",\"current\":{\"consumption\":5000,\"ending_stocks\":145,\"exports\":7130,\"imports\":0,\"production\":12100},\"previous\":{\"consumption\":4500,\"ending_stocks\":175,\"exports\":6965,\"imports\":0,\"production\":11560},\"estimate\":\"2026-07\"},\"US\":{\"iso\":\"US\",\"name\":\"United States\",\"current\":{\"consumption\":26950,\"ending_stocks\":5700,\"exports\":0,\"imports\":26900,\"production\":50},\"previous\":{\"consumption\":25550,\"ending_stocks\":5700,\"exports\":0,\"imports\":25500,\"production\":50},\"estimate\":\"2026-07\"},\"E4\":{\"iso\":\"EU\",\"name\":\"European Union\",\"current\":{\"consumption\":42500,\"ending_stocks\":9300,\"exports\":5700,\"imports\":50000,\"production\":0},\"previous\":{\"consumption\":41570,\"ending_stocks\":7500,\"exports\":5600,\"imports\":46500,\"production\":0},\"estimate\":\"2026-07\"}}}}}") as PsdSnapshot

const series = (key: string, name: string, unit: string, value: number, previous: number, yearAgo: number, extra: Partial<PriceSeries> = {}): PriceSeries => ({
  key, name, unit, month: '2026-09', value, previous, year_ago: yearAgo,
  change_month_pct: Math.round(((value - previous) / previous) * 1000) / 10, change_year_pct: Math.round(((value - yearAgo) / yearAgo) * 1000) / 10,
  highest_since: null, lowest_since: null, history: { start: '2021-10', values: [] }, ...extra,
})
const PRICES: PricesSnapshot = {
  source: 'World Bank Commodity Price Data (The Pink Sheet)', licence: 'CC BY 4.0', file_url: 'x', file_date: null, updated: '2026-10-02', month: '2026-09',
  series: {
    'coffee-arabica': series('coffee-arabica', 'Coffee, Arabica', '$/kg', 7.26, 7.97, 8.83, { lowest_since: '2026-06' }),
    soybeans: series('soybeans', 'Soybeans', '$/mt', 524, 482, 439, { highest_since: '2024-01' }),
  },
}

// The real South Minas Gerais forecast with its rain cut to a twentieth: a dry flowering
const WINDOWS: Array<[string, number, number, number]> = [["10-24T00",17,17.4,0],["10-24T06",17.4,21.8,0.1],["10-24T12",23.1,25.8,0.2],["10-24T18",19.1,24.6,3.5],["10-25T00",18.8,19.1,0],["10-25T06",19.5,22.1,3.7],["10-25T12",21.4,24.4,5.6],["10-25T18",20.5,21.2,3.6],["10-26T00",19.2,20.4,7.9],["10-26T06",19,21.4,0.7],["10-26T12",21.4,25.5,1],["10-26T18",16.5,25.3,0],["10-27T00",12.9,16.5,0],["10-27T06",11.9,18.6,0],["10-27T12",18.6,25.3,0],["10-27T18",17.7,25.2,0],["10-28T00",14.6,17.7,0],["10-28T06",14.5,19,0],["10-28T12",19,22.7,1.6],["10-28T18",18.4,22.8,3.1],["10-29T00",16.8,18.4,0.6],["10-29T06",16.7,20.2,0.5],["10-29T12",20.2,22.4,1],["10-29T18",18.9,22.5,1.5],["10-30T00",17.7,18.9,14.6],["10-30T06",17.7,18.9,17.2],["10-30T12",18.9,22.7,10.5],["10-30T18",18.2,22.4,4.2],["10-31T00",17.9,18.3,0.1],["10-31T06",17.7,21.1,0.5],["10-31T12",21.1,26.2,1.1],["10-31T18",19.3,26.3,0.2],["11-01T00",16.9,19.3,0],["11-01T06",16.4,21.4,0],["11-01T12",21.4,26.2,0.8],["11-01T18",18.3,25.9,6.5],["11-02T00",17.3,18.4,4.8],["11-02T06",17.1,20.7,0.1]]
const dry: PointForecast = { updated: '2026-10-23T23:18:45Z', windows: WINDOWS.map(([t, min, max, rain]) => ({ start: `2026-${t}:00:00Z`, min, max, rain: rain / 20 })) }
const NORMALS = [7.39, 5.67, 4.65, 2.12, 1.44, 0.71, 0.49, 0.6, 1.66, 3.19, 5.72, 6.92]
const NOW = new Date('2026-10-24T00:30:00Z')
const coffee = BY_KEY.get('coffee')!
const brCoffee = REGIONS.filter(r => r.commodity === 'coffee' && r.iso === 'BR')
const weatherBR = countryWeather('coffee', 'BR', brCoffee.map(r => assessRegion(r, coffee, dry, NORMALS, NOW)))

const inputs = (over: Partial<CardInputs> = {}): CardInputs => ({
  psd: PSD, previousPsd: null, prices: PRICES, esr: null, cftc: null,
  weather: new Map([['coffee:BR', weatherBR]]),
  news: new Map([['coffee:BR', { count: 1, latest: [{ id: 'a', title: 'Coffee prices slip', created_at: '2026-10-20T10:00:00.000Z' }] }]]),
  ...over,
})

describe('words', () => {
  it("puts USDA's units in words", () => {
    expect(amount(71_900, '1000 60 KG BAGS')).toBe('71.9 million bags')
    expect(amount(186_000, '1000 MT')).toBe('186 million t')
    expect(amount(5_500, '1000 480 lb. Bales')).toBe('5.5 million bales')
    expect(amount(49_070, 'MT')).toBe('49,070 t')
    expect(yearLabel(2026, 'softs')).toBe('2026/27')
    expect(yearLabel(2027, 'meat')).toBe('2027')
    expect(priceLabel('Coffee, Arabica')).toBe('Arabica coffee')
    expect(priceLabel('Sugar, world')).toBe('World sugar')
    expect(priceLabel('Cotton, A Index')).toBe('Cotton (A Index)')
    expect(priceLabel('Soybeans')).toBe('Soybeans')
  })
})

describe('a card', () => {
  const card = buildCard(coffee, 'BR', inputs())

  it('reads the five readings', () => {
    expect(card.outlook).toMatchObject({ year: '2026/27', production: 71_900, previous: 63_000, change_pct: 14.1, estimate: '2026-07' })
    expect(card.outlook!.text).toBe('USDA: 71.9 million bags in 2026/27, up 14.1% on last year, 51% of the world\'s')
    expect(card.weather).toMatchObject({ level: 3 })
    expect(card.weather!.text).toMatch(/^South Minas Gerais \(Varginha\): 4\.8 mm of rain forecast in the next 10 days, 12% of normal, while the crop is flowering$/)
    expect(card.trade!.text).toBe("Exports 49.1 million bags, 44% of the world's; imports 90,000 bags")
    expect(card.market!.text).toBe('Arabica coffee $7.26/kg in September, down 8.9% on the month, down 17.8% on the year, the lowest since June 2026')
    expect(card.news).toMatchObject({ count: 1, text: '1 report in our sources in the last 14 days' })
  })

  it('scores the risk and says why', () => {
    // High weather risk 40 + a crop 14% up 10 + prices down 8.9% with a real weather risk 5
    expect(card.score).toBe(55)
    expect(card.call).toBe('cut likely')
    expect(card.reasons[0]).toMatch(/^\+40 High weather risk\. South Minas Gerais/)
    expect(card.reasons.slice(1)).toEqual([
      "+10 USDA expects a crop 14% bigger than last year's: room for a cut",
      "+5 Arabica coffee fell 8.9% in September: the market isn't paying for the weather risk",
    ])
  })

  it('raises the flag: a real risk, a country that matters, little in the news', () => {
    expect(card.flag).toMatchObject({ level: 3 })
    expect(card.flag!.text).toMatch(/^Coffee in Brazil: South Minas Gerais/)
    expect(flagTitle(card, weatherBR)).toBe("Little rain forecast for Brazil's coffee as it flowers, a supply risk few are reporting")
  })

  it('raises no flag when the news is full of it, or when the count failed', () => {
    const busy = buildCard(coffee, 'BR', inputs({ news: new Map([['coffee:BR', { count: 12, latest: [] }]]) }))
    expect(busy.flag).toBeNull()
    expect(busy.score).toBe(55)
    expect(buildCard(coffee, 'BR', inputs({ news: null })).flag).toBeNull()
  })

  it('gives countries without growing regions their other readings', () => {
    const vn = buildCard(coffee, 'VN', inputs())
    expect(vn.weather).toBeNull()
    expect(vn.outlook!.text).toBe("USDA: 32.5 million bags in 2026/27, up 2.5% on last year, 23% of the world's")
    expect(vn.score).toBe(0)
    expect(vn.call).toBe('no cut expected')
    const us = buildCard(BY_KEY.get('coffee')!, 'US', inputs())
    expect(us.trade!.text).toBe("Imports 26.9 million bags, 33% of the world's")
  })
})

describe('which countries get cards', () => {
  it('takes producers, exporters and big importers, and every country with regions', () => {
    const list = cardCountries(coffee, PSD)
    for (const iso of ['BR', 'VN', 'CO', 'ID', 'ET', 'US', 'EU', 'UG', 'IN', 'HN', 'PE', 'MX', 'GT']) expect(list).toContain(iso)
    // Cocoa has no USDA figures: its countries are its regions'
    expect(cardCountries(BY_KEY.get('cocoa')!, PSD)).toEqual(['BR', 'CI', 'CM', 'EC', 'GH', 'ID', 'NG'])
  })

  it('builds every card without failing on missing sources', () => {
    const cards = buildCards({ psd: null, previousPsd: null, prices: null, esr: null, cftc: null, weather: new Map(), news: null })
    expect(cards.length).toBe(new Set(REGIONS.map(r => `${r.commodity}:${r.iso}`)).size)
    expect(cards.every(c => c.score === 0 && !c.flag)).toBe(true)
    expect(COMMODITIES.length).toBeGreaterThan(55)
  })
})

describe("the calls' record", () => {
  it("keeps the latest call until USDA revises, then records what USDA did", () => {
    const card = buildCard(coffee, 'BR', inputs())
    const first = updateCalls(new Map(), [card], new Date('2026-10-24T01:00:00Z'))
    expect(first.outcomes).toEqual([])
    const e = first.entries.get('coffee:BR') as ForecastEntry
    expect(e).toMatchObject({ year: '2026/27', production: 71_900, estimate: '2026-07', first: { score: 55, call: 'cut likely' } })

    // USDA's December release cuts Brazil's crop to 68 million bags
    const revised = JSON.parse(JSON.stringify(PSD)) as PsdSnapshot
    revised.commodities['0711100']!.countries.BR!.current.production = 68_000
    revised.commodities['0711100']!.countries.BR!.estimate = '2026-12'
    const after = buildCard(coffee, 'BR', inputs({ psd: revised }))
    const second = updateCalls(first.entries, [after], new Date('2026-12-12T18:00:00Z'))
    expect(second.outcomes).toHaveLength(1)
    expect(second.outcomes[0]).toMatchObject({ before: 71_900, after: 68_000, change_pct: -5.4, outcome: 'cut', estimate_before: '2026-07', estimate_after: '2026-12' })
    expect(scorecard(second.outcomes)).toEqual({ 'cut likely': { calls: 1, cut: 1, raised: 0, unchanged: 0 } })
    expect(second.entries.get('coffee:BR')).toMatchObject({ production: 68_000, estimate: '2026-12' })
  })
})

describe('counting the news', () => {
  const rows: NewsRow[] = [
    { id: '1', title: 'Frost fears lift arabica', summary: 'Growers in Minas Gerais watch the cold', country_code: 'GB', created_at: '2026-10-20T00:00:00Z' },
    { id: '2', title: 'Coffee exports slow', summary: null, country_code: 'BR', created_at: '2026-10-19T00:00:00Z' },
    { id: '3', title: "Vietnam's robusta harvest starts", summary: null, country_code: 'VN', created_at: '2026-10-18T00:00:00Z' },
    { id: '4', title: 'Brazilian roasters raise prices', summary: null, country_code: null, created_at: '2026-10-17T00:00:00Z' },
  ]
  it('counts stories placed in the country, naming it, or naming one of its regions', () => {
    expect(countForCountry(rows, coffee, 'BR')).toMatchObject({ count: 3 })
    expect(countForCountry(rows, coffee, 'VN').latest.map(r => r.id)).toEqual(['3'])
  })
})

describe('assessing every region', () => {
  it('needs a forecast for at least one of a country\'s regions', () => {
    const minas = REGIONS.find(r => r.id === 'coffee:BR:south-minas-gerais-varginha')!
    const { regions, byCountry } = assessAll(new Map([[pointKey(minas.lat, minas.lon), dry]]), new Map([[pointKey(minas.lat, minas.lon), NORMALS]]), NOW)
    expect(regions).toHaveLength(REGIONS.length)
    expect([...byCountry.keys()]).toEqual(['coffee:BR'])
    expect(byCountry.get('coffee:BR')!.level).toBe(3)
  })
})
