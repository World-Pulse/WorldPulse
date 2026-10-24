/**
 * Trade partners from CEPII's BACI (Oct 23, 2026). The rows and country codes are BACI's own
 * (BACI_HS22_V202601: the 2024 file, Australia's wheat buyers and some small flows).
 */

import { describe, it, expect } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { commodityOf, readCountryCodes, readFlows, newestYear, findZipUrl, fixMojibake, inflatedLines } from '../baci-trade'
import { centralDirectory, dataStart } from '../../lib/zip'
import { zipFiles } from '../../lib/__tests__/zip-fixture'

const CODES = 'country_code,country_name,country_iso2,country_iso3\n4,Afghanistan,AF,AFG\n8,Albania,AL,ALB\n31,Azerbaijan,AZ,AZE\n36,Australia,AU,AUS\n40,Austria,AT,AUT\n56,Belgium,BE,BEL\n124,Canada,CA,CAN\n156,China,CN,CHN\n360,Indonesia,ID,IDN\n372,Ireland,IE,IRL\n392,Japan,JP,JPN\n410,Rep. of Korea,KR,KOR\n458,Malaysia,MY,MYS\n490,"Other Asia, nes",,S19\n508,Mozambique,MZ,MOZ\n608,Philippines,PH,PHL\n699,India,IN,IND\n704,Viet Nam,VN,VNM\n724,Spain,ES,ESP\n757,Switzerland,CH,CHE\n764,Thailand,TH,THA\n792,TÃ¼rkiye,TR,TUR\n800,Uganda,UG,UGA\n826,United Kingdom,GB,GBR\n860,Uzbekistan,UZ,UZB\n887,Yemen,YE,YEM\n'

const ROWS = [
  't,i,j,k,v,q',
  '2024,4,56,090111,0.005,',
  '2024,4,124,090121,0.004,',
  '2024,4,724,100111,48.065,4.566',
  '2024,4,800,100111,0.077,0.04',
  '2024,4,860,100199,131.37,906',
  '2024,4,24,330499,2.295,0.23',
  '2024,36,360,100199,848147.409,3119167.854',
  '2024,36,156,100199,805861.263,2365836.866',
  '2024,36,608,100199,707164.28,2460122.928',
  '2024,36,887,100199,448288.207,1583928.6',
  '2024,36,392,100199,361115.542,1089062.483',
  '2024,36,410,100199,347202.515,1204212.376',
  '2024,36,704,100199,324059.558,1146309.65',
  '2024,36,458,100199,237137.127,775625.505',
  '2024,36,156,100119,146939.513,10297.91',
  '2024,36,764,100199,146762.402,484327.625',
]

describe('reading BACI', () => {
  it('maps HS codes to commodities by their longest prefix', () => {
    expect(commodityOf('100199')).toBe('wheat')
    expect(commodityOf('090121')).toBe('coffee')
    expect(commodityOf('151211')).toBe('sunflower-oil')
    expect(commodityOf('151221')).toBe('cottonseed-oil')
    expect(commodityOf('330499')).toBeNull()
  })

  it('reads the country codes: Taiwan for "Other Asia", our names, garbled ones put right', () => {
    const codes = readCountryCodes(CODES)
    expect(codes.get('699')).toEqual({ iso: 'IN', name: 'India' })
    expect(codes.get('490')).toEqual({ iso: 'TW', name: 'Taiwan' })
    expect(codes.get('704')).toEqual({ iso: 'VN', name: 'Vietnam' })
    expect(fixMojibake('TÃ¼rkiye')).toBe('Türkiye')
    expect(fixMojibake('Türkiye')).toBe('Türkiye')
  })

  it("puts each country's buyers and suppliers in order, with shares", async () => {
    const trade = await readFlows(ROWS, readCountryCodes(CODES))
    const au = trade.AU!.exports.wheat!
    expect(au.value).toBe(4_372_678)                                           // $4.37 billion of wheat
    expect(au.top.map(p => p.iso)).toEqual(['CN', 'ID', 'PH', 'YE', 'JP', 'KR'])   // China's two wheats together
    expect(au.top[0]).toMatchObject({ name: 'China', value: 952_801, share: 21.8, tonnes: 2_376_135 })
    expect(trade.CN!.imports.wheat!.top[0]).toMatchObject({ iso: 'AU', share: 100 })
    // Afghanistan's coffee to Belgium and Canada: $9 in all, too small to keep; its $180,000 of wheat kept
    expect(trade.AF!.exports.coffee).toBeUndefined()
    expect(trade.AF!.exports.wheat).toMatchObject({ value: 180, tonnes: 911 })
  })

  it("adds each country's trade in all goods: totals, main partners, main product groups", async () => {
    const trade = await readFlows([...ROWS, '2024,36,156,270900,500000,1000000', '2024,36,392,870323,20000,'], readCountryCodes(CODES))
    const au = trade.AU!.total!
    expect([au.exports, au.imports]).toEqual([4_892_678, 0])            // wheat $4.37 billion, crude oil, cars
    expect(au.buyers[0]).toMatchObject({ iso: 'CN', name: 'China', value: 1_452_801, share: 29.7, tonnes: null })
    expect(au.exports_by.map(g => [g.name, g.share])).toEqual([['Cereals', 89.4], ['Oil, gas and coal', 10.2], ['Vehicles', 0.4]])
    expect(trade.AU!.exports['crude-oil']).toMatchObject({ value: 500_000, tonnes: 1_000_000 })
    expect(trade.CN!.total).toMatchObject({ imports: 1_452_801, suppliers: [{ iso: 'AU', share: 100 }] })
    expect(trade.AF!.total).toBeUndefined()                             // $180,000 in all: too small to show
  })

  it('maps energy and metals too', () => {
    expect([commodityOf('270900'), commodityOf('271111'), commodityOf('271112'), commodityOf('740311'), commodityOf('710812')]).toEqual(['crude-oil', 'natural-gas', null, 'copper', 'gold'])
  })

  it('leaves the tonnes out when a flow has none', async () => {
    const trade = await readFlows(['t,i,j,k,v,q', '2024,4,56,090111,150,', '2024,4,124,090121,40,2'], readCountryCodes(CODES))
    expect(trade.AF!.exports.coffee).toMatchObject({ value: 190, tonnes: null })
    expect(trade.AF!.exports.coffee!.top[0]).toMatchObject({ iso: 'BE', tonnes: null })
  })
})

describe('reading the zip by parts', () => {
  const zip = zipFiles([
    ['BACI_HS22_Y2023_V202601.csv', ROWS.join('\n')],
    ['BACI_HS22_Y2024_V202601.csv', ROWS.join('\n')],
    ['country_codes_V202601.csv', CODES],
  ])

  it('lists the files from the last bytes and finds the newest year', () => {
    const tailStart = zip.length - 300
    const listing = centralDirectory(zip.subarray(tailStart), tailStart)
    expect(listing.map(e => e.name)).toEqual(['BACI_HS22_Y2023_V202601.csv', 'BACI_HS22_Y2024_V202601.csv', 'country_codes_V202601.csv'])
    const newest = newestYear(listing)!
    expect(newest.year).toBe(2024)
    const start = dataStart(zip.subarray(newest.entry.local, newest.entry.local + 30), newest.entry.local)
    expect(start).toBe(newest.entry.local + 30 + 'BACI_HS22_Y2024_V202601.csv'.length)
  })

  it('streams a deflated file into lines', async () => {
    const lines: string[] = []
    async function* body() { const d = deflateRawSync(Buffer.from(ROWS.join('\n'))); yield d.subarray(0, 50); yield d.subarray(50) }
    for await (const l of inflatedLines(body())) lines.push(l)
    expect(lines).toEqual(ROWS)
  })

  it("finds the zip on BACI's page", () => {
    expect(findZipUrl('<a href="../data/BACI_HS17_V202601.zip">HS17</a> <a href="../data/BACI_HS22_V202601.zip">HS22</a>'))
      .toBe('https://www.cepii.fr/DATA_DOWNLOAD/baci/data/BACI_HS22_V202601.zip')
  })
})
