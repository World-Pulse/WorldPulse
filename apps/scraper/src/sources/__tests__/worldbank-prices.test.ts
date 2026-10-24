/**
 * The World Bank's monthly prices (Oct 23, 2026). The sheet below is the October 2026 file's own:
 * its title rows, names and units, and its prices for August 2025 to September 2026 (some columns).
 */

import { describe, it, expect } from 'vitest'
import { readSheet } from '../../lib/xlsx'
import { workbookOf } from '../../lib/__tests__/zip-fixture'
import { readPrices, findFileUrl, seriesKey, cleanName, cleanUnit, updatedOn, addMonths, SHEET } from '../worldbank-prices'

const MONTHS = ['2025M08', '2025M09', '2025M10', '2025M11', '2025M12', '2026M01', '2026M02', '2026M03', '2026M04', '2026M05', '2026M06', '2026M07', '2026M08', '2026M09']
const SERIES: Array<[col: string, name: string, unit: string, values: Array<number | null>]> = [
  ['C', 'Crude oil, Brent', '($/bbl)', [68.2, 68, 64.7, 63.6, 62.7, 66.8, 71.099999999999994, 103.7, 120.4, 107.5, 85.4, 83.4, 90.9, 116.8]],
  ['E', 'Crude oil, WTI', '($/bbl)', [64.099999999999994, 63.7, 60.2, 59.6, 57.9, 60.3, 64.599999999999994, 91.2, 98.6, 99.1, 81.900000000000006, 79.400000000000006, 82.7, 96.9]],
  ['L', 'Cocoa', '($/kg)', [7.6, 7.03, 5.95, 5.61, 5.78, 4.97, 3.59, 3.24, 3.4, 4.16, 4.4000000000000004, 5.61, 5.95, 5.92]],
  ['M', 'Coffee, Arabica', '($/kg)', [8.08, 8.83, 8.9, 9.0500000000000007, 8.4, 8.02, 7.08, 7.37, 7.3, 6.95, 6.79, 7.91, 7.97, 7.26]],
  ['N', 'Coffee, Robusta', '($/kg)', [4.3899999999999997, 4.66, 4.74, 4.74, 4.2, 4.24, 3.96, 3.9, 3.63, 3.67, 3.73, 4.07, 3.98, 3.69]],
  ['AE', 'Maize', '($/mt)', [185.5, 197.4, 198.1, 202, 205.7, 204.5, 209.6, 212.7, 214, 216.2, 197.1, 213.4, 224, 239.6]],
  ['AF', 'Sorghum', '($/mt)', Array(14).fill(null)],
  ['AG', 'Rice, Thai 5% ', '($/mt)', [375, 374, 356, 368, 424, 408, 409, 381, 403, 440, 494, 467, 471, 482]],
  ['BJ', 'Potassium chloride **', '($/mt)', [356.5, 352.5, 352, 353.8, 358.3, 366, 372.5, 380.6, 401.3, 405, 402.5, 396.5, 386.9, 367.5]],
  ['BR', 'Gold', '($/troy oz)', [3368, 3668, 4058, 4087, 4309, 4753, 5020, 4856, 4721, 4587, 4228, 4073, 4411, 4319]],
]

/** The October 2026 file's Monthly Prices sheet, these columns only, as Excel writes it */
function pinkSheet(): Buffer {
  const strings: string[] = []
  const s = (text: string): number => { const i = strings.indexOf(text); return i >= 0 ? i : strings.push(text) - 1 }
  const text = (ref: string, value: string): string => `<c r="${ref}" s="10" t="s"><v>${s(value)}</v></c>`
  const rows = [
    `<row r="1" spans="1:72">${text('A1', 'World Bank Commodity Price Data (The Pink Sheet)')}<c r="C1" s="7"/></row>`,
    `<row r="2">${text('A2', 'monthly prices in nominal US dollars, 1960 to present')}</row>`,
    `<row r="3">${text('A3', '(monthly series are available only in nominal US dollars)')}<c r="C3" s="2"/></row>`,
    `<row r="4">${text('A4', 'Updated on October 02, 2026')}</row>`,
    `<row r="5"><c r="A5" s="2"/>${SERIES.map(([c, name]) => text(`${c}5`, name)).join('')}</row>`,
    `<row r="6">${SERIES.map(([c, , unit]) => text(`${c}6`, unit)).join('')}</row>`,
    ...MONTHS.map((m, i) => `<row r="${794 + i}">${text(`A${794 + i}`, m)}${SERIES.map(([c, , , values]) => {
      const v = values[i]
      return v === null || v === undefined ? text(`${c}${794 + i}`, '…') : `<c r="${c}${794 + i}" s="82"><v>${v}</v></c>`
    }).join('')}</row>`),
  ]
  const monthly = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`
  // The file's hidden first sheet, which must not be read for prices
  const mismatch = `<worksheet><sheetData><row r="5">${text('C5', 'Not a price')}</row><row r="6">${text('C6', '($/kg)')}</row><row r="7">${text('A7', '2026M09')}<c r="C7"><v>1</v></c></row></sheetData></worksheet>`
  return workbookOf([{ name: 'Mismatch Details', xml: mismatch, hidden: true }, { name: SHEET, xml: monthly }, { name: 'Monthly Indices', xml: '<worksheet><sheetData/></worksheet>' }], strings)
}

describe('reading the Monthly Prices sheet', () => {
  const prices = readPrices(readSheet(pinkSheet(), SHEET), 'https://thedocs.worldbank.org/x/CMO-Historical-Data-Monthly.xlsx', 'Fri, 02 Oct 2026 14:00:00 GMT')

  it("reads the file's month and the World Bank's date", () => {
    expect(prices).toMatchObject({ month: '2026-09', updated: '2026-10-02', licence: 'CC BY 4.0', file_date: 'Fri, 02 Oct 2026 14:00:00 GMT' })
    expect(Object.keys(prices.series)).toHaveLength(SERIES.length)
  })

  it('gives each series its latest price, the month before and a year before', () => {
    expect(prices.series['crude-oil-brent']).toMatchObject({
      name: 'Crude oil, Brent', unit: '$/bbl', month: '2026-09', value: 116.8, previous: 90.9, year_ago: 68,
      change_month_pct: 28.5, change_year_pct: 71.8, highest_since: '2026-04', lowest_since: null,
    })
    expect(prices.series['coffee-arabica']).toMatchObject({ value: 7.26, previous: 7.97, year_ago: 8.83, change_month_pct: -8.9, change_year_pct: -17.8, highest_since: null, lowest_since: '2026-06' })
    expect(prices.series.cocoa).toMatchObject({ value: 5.92, change_month_pct: -0.5, change_year_pct: -15.8, lowest_since: '2026-07' })
    expect(prices.series.gold).toMatchObject({ unit: '$/troy oz', value: 4319, change_month_pct: -2.1, change_year_pct: 17.7 })
  })

  it('says how far back a higher or a lower price was last seen', () => {
    expect(prices.series.maize).toMatchObject({ value: 239.6, change_month_pct: 7, change_year_pct: 21.4, highest_since: 'record', lowest_since: null })
    expect(prices.series['potassium-chloride']).toMatchObject({ name: 'Potassium chloride', value: 367.5, change_month_pct: -5, lowest_since: '2026-01' })
  })

  it('keeps 60 months of history, ending with the newest month', () => {
    const brent = prices.series['crude-oil-brent']!
    expect(brent.history.start).toBe('2021-10')
    expect(brent.history.values).toHaveLength(60)
    expect(brent.history.values[59]).toBe(116.8)
    expect(brent.history.values[46]).toBe(68.2)       // August 2025, the sheet's first month here
    expect(brent.history.values[45]).toBeNull()
  })

  it('leaves a series without prices empty, not zero', () => {
    expect(prices.series.sorghum).toMatchObject({ month: null, value: null, previous: null, change_month_pct: null, highest_since: null })
    expect(prices.series.sorghum!.history.values.every(v => v === null)).toBe(true)
  })

  it('names series without the footnote marks and trailing spaces', () => {
    expect(prices.series['rice-thai-5']).toMatchObject({ name: 'Rice, Thai 5%', value: 482 })
  })
})

describe('the parts', () => {
  it('makes keys, names and units', () => {
    expect(seriesKey('Rice, Thai A.1')).toBe('rice-thai-a-1')
    expect(seriesKey('Coal, South African **')).toBe('coal-south-african')
    expect(seriesKey('Tobacco, US import u.v.')).toBe('tobacco-us-import-u-v')
    expect(cleanName('Rubber, TSR20 **')).toBe('Rubber, TSR20')
    expect(cleanUnit('(2010=100)')).toBe('2010=100')
    expect(cleanUnit('(cents/sheet)')).toBe('cents/sheet')
  })

  it('reads dates and counts months', () => {
    expect(updatedOn('Updated on October 02, 2026')).toBe('2026-10-02')
    expect(updatedOn('Updated on Sept 2, 2026')).toBeNull()
    expect(addMonths('2026-09', -12)).toBe('2025-09')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2021-10', 59)).toBe('2026-09')
  })

  it("finds the monthly file's address on the Commodity Markets page", () => {
    const html = `<a href="https://thedocs.worldbank.org/en/doc/18675f1d1639c7a34d463f59263ba0a2-0050012025/related/CMO-Historical-Data-Annual.xlsx">Annual prices</a>
      <a href="https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx" target="_blank">Monthly prices</a>`
    expect(findFileUrl(html)).toBe('https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx')
    expect(findFileUrl('<a href="//thedocs.worldbank.org/en/doc/abc/related/CMO-Historical-Data-Monthly.xlsx">')).toBe('https://thedocs.worldbank.org/en/doc/abc/related/CMO-Historical-Data-Monthly.xlsx')
    expect(findFileUrl('<p>no link</p>')).toBeNull()
  })
})
