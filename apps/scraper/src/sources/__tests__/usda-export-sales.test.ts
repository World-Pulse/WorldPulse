/**
 * USDA Weekly Export Sales (Oct 23, 2026): reading USDA's report files, its release time, and the
 * reports WorldPulse makes from a week. The rows below are USDA's own, from the week ending
 * October 15, 2026 (some trimmed; corn's buyer rows built from that week's highlights).
 */

import { describe, it, expect } from 'vitest'
import {
  parseDetails, parseHighlights, vsFourWeekAverage, isoDate, releaseTime, federalHolidays,
  formatQuantity, usdaCountry, readWeek, planSignals, commoditySeverity, GROUPS, shortDate,
} from '../usda-export-sales'

const SUMMARY_XML = `<?xml version="1.0" encoding="utf-8"?><Report Name="CWRCommoditySummary" ReportTitle="COMPLETE WEEKLY REPORT - COMMODITY SUMMARY&#xD;&#xA;U. S. EXPORT SALES AS OF 10/15/2026&#xD;&#xA;&#xD;&#xA;All numbers are in the Thousands" xmlns="CWRCommoditySummary"><Tablix1><Details_Collection>`
  + `<Details CommodityCode="107" CommodityName="ALL WHEAT" PeriodEndingDate="10/15/2026" MarketingYearWeekNumber="20" MYCOType="Standard" MarketingYear="Jun 2026/May 2027" NewSales="242" PurchaseForeignSellers="0" BuyBacks_Cancellations="2.4" WeeklyExports="240.31" NetSales="239.627" OutstandingSales="3180.4" AccumulatedExports="8500.2" TotalCommitment="11680.6" PreviousMKTYearAccumulatedExports="9001.5" PreviousMKTYearOutstandingSales="3500" NextMKTYearOutstandingSales="0" NextMKTYearNetSales="0" WASDEReportProjectionsQuantity="0" />`
  + `<Details CommodityCode="107" CommodityName="ALL WHEAT" PeriodEndingDate="10/08/2026" MarketingYearWeekNumber="19" MYCOType="Standard" MarketingYear="Jun 2026/May 2027" NewSales="322" PurchaseForeignSellers="0" BuyBacks_Cancellations="2.1" WeeklyExports="323.649" NetSales="319.901" OutstandingSales="3181.1" AccumulatedExports="8259.9" TotalCommitment="11441" PreviousMKTYearAccumulatedExports="8700" PreviousMKTYearOutstandingSales="3600" NextMKTYearOutstandingSales="0" NextMKTYearNetSales="0" WASDEReportProjectionsQuantity="0" />`
  + `<Details CommodityCode="401" CommodityName="CORN - UNMILLED" PeriodEndingDate="10/15/2026" MarketingYearWeekNumber="7" MYCOType="Standard" MarketingYear="Sep 2026/Aug 2027" NewSales="1530" PurchaseForeignSellers="0" BuyBacks_Cancellations="2.878" WeeklyExports="780.26" NetSales="1527.122" OutstandingSales="30100" AccumulatedExports="9800" TotalCommitment="39900" PreviousMKTYearAccumulatedExports="7600" PreviousMKTYearOutstandingSales="20000" NextMKTYearOutstandingSales="0" NextMKTYearNetSales="0" WASDEReportProjectionsQuantity="0" />`
  + `<Details CommodityCode="401" CommodityName="CORN - UNMILLED" PeriodEndingDate="10/08/2026" MarketingYearWeekNumber="6" MYCOType="Standard" MarketingYear="Sep 2026/Aug 2027" NewSales="1125" PurchaseForeignSellers="0" BuyBacks_Cancellations="2.558" WeeklyExports="1362.581" NetSales="1122.442" OutstandingSales="29353" AccumulatedExports="9020" TotalCommitment="38373" PreviousMKTYearAccumulatedExports="7000" PreviousMKTYearOutstandingSales="19800" NextMKTYearOutstandingSales="0" NextMKTYearNetSales="0" WASDEReportProjectionsQuantity="0" />`
  + `<Details CommodityCode="801" CommodityName="SOYBEANS" PeriodEndingDate="10/15/2026" MarketingYearWeekNumber="7" MYCOType="Standard" MarketingYear="Sep 2026/Aug 2027" NewSales="2858.506" PurchaseForeignSellers="0" BuyBacks_Cancellations="17.307" WeeklyExports="2016.753" NetSales="2841.199" OutstandingSales="19095.747" AccumulatedExports="7105.559" TotalCommitment="26201.306" PreviousMKTYearAccumulatedExports="5151.106" PreviousMKTYearOutstandingSales="9346.983" NextMKTYearOutstandingSales="1" NextMKTYearNetSales="0" WASDEReportProjectionsQuantity="0" />`
  + `<Details CommodityCode="801" CommodityName="SOYBEANS" PeriodEndingDate="10/08/2026" MarketingYearWeekNumber="6" MYCOType="Standard" MarketingYear="Sep 2026/Aug 2027" NewSales="580" PurchaseForeignSellers="0" BuyBacks_Cancellations="5.122" WeeklyExports="1153.971" NetSales="574.878" OutstandingSales="18271.301" AccumulatedExports="5088.806" TotalCommitment="23360.107" PreviousMKTYearAccumulatedExports="4300" PreviousMKTYearOutstandingSales="9000" NextMKTYearOutstandingSales="1" NextMKTYearNetSales="0" WASDEReportProjectionsQuantity="0" />`
  + `<Details CommodityCode="902" CommodityName="SOYBEAN OIL" PeriodEndingDate="10/15/2026" MarketingYearWeekNumber="3" MYCOType="Standard" MarketingYear="Oct 2026/Sep 2027" NewSales="1.6" PurchaseForeignSellers="0" BuyBacks_Cancellations="0.7" WeeklyExports="1.593" NetSales="0.916" OutstandingSales="20" AccumulatedExports="5" TotalCommitment="25" PreviousMKTYearAccumulatedExports="8" PreviousMKTYearOutstandingSales="30" NextMKTYearOutstandingSales="0" NextMKTYearNetSales="0" WASDEReportProjectionsQuantity="0" />`
  + `</Details_Collection></Tablix1></Report>`

const row = (code: string, name: string, cc: string, country: string, week: string, net: string, exp: string, out: string, acc: string, prevAcc: string) =>
  `<Details CommodityCode="${code}" CommodityName="${name}" CountryCode="${cc}" CountryName="${country}" PeriodEndingDate="${week}" MarketingYearWeekNumber="7" MYCOType="Standard" MarketingYear="Sep 2026/Aug 2027" BeginingBalance="0" NewSales="0" PurchaseForeignSellers="0" BuyBacksCancellations="0" NetSales="${net}" OutstandingSales="${out}" WeeklyExports="${exp}" AccumulatedExports="${acc}" TotalCommitment="0" PreviousYearAccumulatedExports="${prevAcc}" PreviousYearOutstandingSales="0" NextYearOutstandingSales="0" NextYearNetSales="0"/>`

const COUNTRY_XML = `<?xml version="1.0" encoding="utf-8"?><Report Name="CWRCountryCommoditySummary" xmlns="CWRCountryCommoditySummary"><Tablix2><CommodityName_Collection>`
  + `<CommodityName CommodityCodeName="401 - CORN - UNMILLED"><Details_Collection>`
  + row('401', 'CORN - UNMILLED', '2010', 'MEXICO                         ', '10/15/2026', '477.7', '379.2', '9000', '3000', '2500')
  + row('401', 'CORN - UNMILLED', '5880', 'JAPAN                          ', '10/15/2026', '285.4', '20', '4000', '900', '1200')
  + row('401', 'CORN - UNMILLED', '4120', 'UNITED KINGDOM                 ', '10/15/2026', '141.8', '0', '141.8', '0', '0')
  + row('401', 'CORN - UNMILLED', '4700', 'SPAIN                          ', '10/15/2026', '-8', '0', '50', '100', '80')
  + row('401', 'CORN - UNMILLED', '9990', 'UNKNOWN                        ', '10/15/2026', '307.2', '0', '6000', '0', '0')
  + row('401', 'CORN - UNMILLED', '', 'Total Known and Unknown', '10/15/2026', '1527.122', '780.26', '30100', '9800', '7600')
  + `</Details_Collection></CommodityName><CommodityName CommodityCodeName="801 - SOYBEANS"><Details_Collection>`
  // USDA's own rows, as its file has them
  + `<Details CommodityCode="801" CommodityName="SOYBEANS" CountryCode="2010" CountryName="MEXICO                         " PeriodEndingDate="10/15/2026" MarketingYearWeekNumber="7" MYCOType="Standard" MarketingYear="Sep 2026/Aug 2027" BeginingBalance="1691.037" NewSales="232.646" PurchaseForeignSellers="0" BuyBacksCancellations="0.433" NetSales="232.213" OutstandingSales="1684.422" WeeklyExports="238.828" AccumulatedExports="492.044" TotalCommitment="2176.466" PreviousYearAccumulatedExports="803.567" PreviousYearOutstandingSales="1969.684" NextYearOutstandingSales="0" NextYearNetSales="0"/>`
  + `<Details CommodityCode="801" CommodityName="SOYBEANS" CountryCode="2230" CountryName="COSTA RICA                     " PeriodEndingDate="10/15/2026" MarketingYearWeekNumber="7" MYCOType="Standard" MarketingYear="Sep 2026/Aug 2027" BeginingBalance="69.5" NewSales="0" PurchaseForeignSellers="0" BuyBacksCancellations="0.5" NetSales="-0.5" OutstandingSales="56.5" WeeklyExports="12.5" AccumulatedExports="32.197" TotalCommitment="88.697" PreviousYearAccumulatedExports="31.779" PreviousYearOutstandingSales="92.75" NextYearOutstandingSales="0" NextYearNetSales="0"/>`
  + `<Details CommodityCode="801" CommodityName="SOYBEANS" CountryCode="5700" CountryName="CHINA, PEOPLES REPUBLIC OF     " PeriodEndingDate="10/15/2026" MarketingYearWeekNumber="7" MYCOType="Standard" MarketingYear="Sep 2026/Aug 2027" BeginingBalance="8281" NewSales="1791.135" PurchaseForeignSellers="0" BuyBacksCancellations="2.494" NetSales="2178.641" OutstandingSales="9126" WeeklyExports="1333.641" AccumulatedExports="4321.228" TotalCommitment="13447.228" PreviousYearAccumulatedExports="0" PreviousYearOutstandingSales="0" NextYearOutstandingSales="0" NextYearNetSales="0"/>`
  + `<Details CommodityCode="801" CommodityName="SOYBEANS" CountryCode="5700" CountryName="CHINA, PEOPLES REPUBLIC OF     " PeriodEndingDate="10/08/2026" MarketingYearWeekNumber="6" MYCOType="Standard" MarketingYear="Sep 2026/Aug 2027" BeginingBalance="7900" NewSales="400" PurchaseForeignSellers="0" BuyBacksCancellations="0" NetSales="400" OutstandingSales="8281" WeeklyExports="900" AccumulatedExports="2987.587" TotalCommitment="11268.587" PreviousYearAccumulatedExports="0" PreviousYearOutstandingSales="0" NextYearOutstandingSales="0" NextYearNetSales="0"/>`
  + `<Details CommodityCode="801" CommodityName="SOYBEANS" CountryCode="9990" CountryName="UNKNOWN                        " PeriodEndingDate="10/15/2026" MarketingYearWeekNumber="7" MYCOType="Standard" MarketingYear="Sep 2026/Aug 2027" BeginingBalance="5637.85" NewSales="649.45" PurchaseForeignSellers="0" BuyBacksCancellations="11" NetSales="23.25" OutstandingSales="5661.1" WeeklyExports="0" AccumulatedExports="0" TotalCommitment="5661.1" PreviousYearAccumulatedExports="0" PreviousYearOutstandingSales="3358.35" NextYearOutstandingSales="0" NextYearNetSales="0"/>`
  + `<Details CommodityCode="801" CommodityName="SOYBEANS" CountryCode="" CountryName="Total Known and Unknown" PeriodEndingDate="10/15/2026" MarketingYearWeekNumber="7" MYCOType="Standard" MarketingYear="Sep 2026/Aug 2027" BeginingBalance="18271.301" NewSales="2858.506" PurchaseForeignSellers="0" BuyBacksCancellations="17.307" NetSales="2841.199" OutstandingSales="19095.747" WeeklyExports="2016.753" AccumulatedExports="7105.559" TotalCommitment="26201.306" PreviousYearAccumulatedExports="5151.106" PreviousYearOutstandingSales="9346.983" NextYearOutstandingSales="1" NextYearNetSales="0"/>`
  + `</Details_Collection></CommodityName></CommodityName_Collection></Tablix2></Report>`

const NL = '&#xD;&#xA;&#xD;&#xA;&#xD;&#xA;'
const HIGHLIGHTS_XML = `<?xml version="1.0" encoding="utf-8"?><Report Name="WeeklyHighlightsReport" xmlns="WeeklyHighlightsReport"><Tablix1><Details_Collection><Details Textbox1="`
  + `This summary is based on reports from exporters for the period October 9-15, 2026. ${NL}`
  + `Wheat: Net sales of 239,600 metric tons (MT) for 2026/2027 were down 25 percent from the previous week and 28 percent from the prior 4-week average. Increases primarily for Mexico (98,000 MT), unknown destinations (49,900 MT), South Korea (19,000 MT), Singapore (18,000 MT), and Japan (15,100 MT), were offset by reductions for Venezuela (2,000 MT). Exports of 240,300 MT were down 26 percent from the previous week and 23 percent from the prior 4-week average. ${NL}`
  + `Corn: Net sales of 1,527,100 MT for 2026/2027 were up 36 percent from the previous week and 87 percent from the prior 4-week average. Increases primarily for Mexico (477,700 MT, including 55,000 MT switched from unknown destinations and decreases of 700 MT), unknown destinations (307,200 MT), Japan (285,400 MT, including 5,800 MT switched from unknown destinations), the United Kingdom (141,800 MT), and Honduras (79,100 MT), were offset by reductions for Spain (8,000 MT). Exports of 780,300 MT were down 43 percent from the previous week and 51 percent from the prior 4-week average. ${NL}`
  + `Export Adjustments: Accumulated exports of corn to Panama were adjusted down 22,341 MT for week ending September 24. ${NL}`
  + `Soybeans: Net sales of 2,841,200 MT for 2026/2027 were up noticeably from the previous week and from the prior 4-week average. Increases primarily for China (2,178,600 MT, including 390,000 MT switched from unknown destinations and decreases of 2,500 MT), Mexico (232,200 MT, including decreases of 400 MT), were offset by reductions for Costa Rica (500 MT). Exports of 2,016,800 MT were up 75 percent from the previous week and 88 percent from the prior 4-week average. ${NL}`
  + `Exports for Own Account: For 2026/2027, exports for own account totaling 1,800 MT, all Taiwan. ${NL}`
  + `Soybean Cake and Meal: Net sales of 242,200 MT for 2026/2027 primarily for Vietnam (69,900 MT, including 48,000 MT switched from unknown destinations), Saudi Arabia (60,000 MT). ${NL}`
  + `Beef: Net sales of 18,500 MT for 2026 were down 7 percent from the previous week, but up 30 percent from the prior 4-week average. Increases primarily for South Korea (8,300 MT, including decreases of 1,100 MT). ${NL}`
  + `Exports for Own Account: For 2026/2027, new exports for own account totaling 600 RB were to India. &#xD;&#xA;&#xD;&#xA;`
  + `" /></Details_Collection></Tablix1></Report>`

describe('reading USDA files', () => {
  it('reads every row and its attributes, with or without a space before />', () => {
    const rows = parseDetails(SUMMARY_XML)
    expect(rows).toHaveLength(7)
    expect(rows[0]).toMatchObject({ CommodityCode: '107', NetSales: '239.627', PeriodEndingDate: '10/15/2026' })
    const countries = parseDetails(COUNTRY_XML)
    expect(countries.find(r => r.CountryCode === '5700')?.CountryName?.trim()).toBe('CHINA, PEOPLES REPUBLIC OF')
  })

  it('turns USDA dates into ISO dates', () => {
    expect(isoDate('10/15/2026')).toBe('2026-10-15')
    expect(isoDate('1/2/2027')).toBe('2027-01-02')
    expect(isoDate('')).toBeNull()
    expect(shortDate('2026-10-15')).toBe('Oct 15')
  })

  it('splits the weekly highlights into paragraphs by heading, keeping the first of each', () => {
    const h = parseHighlights(HIGHLIGHTS_XML)
    expect(h.period).toBe('October 9-15, 2026')
    expect(h.paragraphs.get('Wheat')).toMatch(/^Net sales of 239,600 metric tons/)
    expect(h.paragraphs.get('Soybean Cake and Meal')).toMatch(/^Net sales of 242,200 MT/)
    expect(h.paragraphs.get('Exports for Own Account')).toMatch(/1,800 MT, all Taiwan/)
    expect([...h.paragraphs.keys()]).not.toContain('This summary is based on reports from exporters for the period October 9')
  })

  it("reads USDA's comparison with the four weeks before", () => {
    const h = parseHighlights(HIGHLIGHTS_XML)
    expect(vsFourWeekAverage(h.paragraphs.get('Wheat')!)).toEqual({ dir: 'down', pct: 28 })
    expect(vsFourWeekAverage(h.paragraphs.get('Corn')!)).toEqual({ dir: 'up', pct: 87 })
    expect(vsFourWeekAverage(h.paragraphs.get('Soybeans')!)).toEqual({ dir: 'up', pct: null })   // "noticeably"
    expect(vsFourWeekAverage(h.paragraphs.get('Beef')!)).toEqual({ dir: 'up', pct: 30 })        // "down 7 …, but up 30"
    expect(vsFourWeekAverage(h.paragraphs.get('Soybean Cake and Meal')!)).toBeNull()
  })

  it("names USDA's buyers by ISO code, leaving out groups of places", () => {
    expect(usdaCountry('CHINA, PEOPLES REPUBLIC OF     ')).toMatchObject({ code: 'CN' })
    expect(usdaCountry('KOREA, REPUBLIC OF').code).toBe('KR')
    expect(usdaCountry('SOUTH AFRICA, REPUBLIC OF').code).toBe('ZA')
    expect(usdaCountry('TAIWAN').code).toBe('TW')
    expect(usdaCountry('LEEWARD-WINDWARD ISLANDS').code).toBeNull()
    expect(usdaCountry('UNITED KINGDOM').name).toBeTruthy()
  })
})

describe("USDA's release time", () => {
  it('is the next Thursday at 8:30 AM in New York', () => {
    expect(releaseTime('2026-10-15').toISOString()).toBe('2026-10-22T12:30:00.000Z')   // EDT
    expect(releaseTime('2026-12-10').toISOString()).toBe('2026-12-17T13:30:00.000Z')   // EST
  })

  it('moves to the Friday in a week with a federal holiday', () => {
    expect(releaseTime('2026-10-08').toISOString()).toBe('2026-10-16T12:30:00.000Z')   // Columbus Day, Mon Oct 12
    expect(releaseTime('2026-11-19').toISOString()).toBe('2026-11-27T13:30:00.000Z')   // Thanksgiving, Thu Nov 26
  })

  it('knows the federal holidays as observed', () => {
    const h = federalHolidays(2026)
    expect(h.has('2026-07-03')).toBe(true)    // July 4 is a Saturday
    expect(h.has('2026-11-26')).toBe(true)    // Thanksgiving
    expect(h.has('2026-05-25')).toBe(true)    // Memorial Day, the last Monday of May
    expect(h.has('2026-01-19')).toBe(true)    // Martin Luther King Jr. Day
  })
})

describe('the week and its reports', () => {
  const week = readWeek(SUMMARY_XML, COUNTRY_XML, HIGHLIGHTS_XML)!

  it('reads the latest week, in units (not thousands)', () => {
    expect(week.week_ending).toBe('2026-10-15')
    expect(week.released_at).toBe('2026-10-22T12:30:00.000Z')
    const soy = week.commodities.find(c => c.key === 'soybeans')!
    expect(soy).toMatchObject({ net_sales: 2_841_199, exports: 2_016_753, prev_week_net_sales: 574_878, unit: 't' })
    expect(soy.usda_summary).toMatch(/^Net sales of 2,841,200 MT/)
  })

  it('keeps every named buyer of that week, without UNKNOWN or the totals', () => {
    expect(week.buyers.map(b => b.usda_code)).not.toContain('9990')
    expect(week.buyers.every(b => b.usda_code !== '')).toBe(true)
    expect(week.buyers.filter(b => b.commodity === 'soybeans').map(b => b.country_code)).toEqual(['CN', 'MX', 'CR'])
    expect(week.buyers[0]).toMatchObject({ country_code: 'CN', net_sales: 2_178_641, prev_year_accumulated_exports: 0 })
  })

  it('makes a report per commodity, in USDA words, and skips a commodity too small to matter', () => {
    const plan = planSignals(week)
    const soy = plan.find(p => p.dedupKey === 'osint:usda-esr:2026-10-15:801')!
    expect(soy.title).toBe('US soybean export sales jumped to 2.84 million t in the week to Oct 15; China bought 2.18 million t')
    expect(soy.severity).toBe('high')
    expect(soy.summary).toMatch(/^USDA: Net sales of 2,841,200 MT/)
    expect(soy.summary).toMatch(/net sales 2,841,199 t, shipments 2,016,753 t/)
    expect(soy.countryCode).toBe('US')
    const wheat = plan.find(p => p.dedupKey === 'osint:usda-esr:2026-10-15:107')!
    expect(wheat.title).toBe('US wheat export sales fell to 239,600 t in the week to Oct 15')
    expect(wheat.severity).toBe('low')
    expect(plan.find(p => p.dedupKey === 'osint:usda-esr:2026-10-15:902')).toBeUndefined()   // 916 t of soybean oil
  })

  it("pins the week's large buyers in their capitals, the largest for its commodity first", () => {
    const buyers = planSignals(week).filter(p => p.tags.includes('trade-flow'))
    expect(buyers.map(b => b.title)).toEqual([
      'China bought 2.18 million t of US soybeans in the week to Oct 15',
      'Mexico bought 477,700 t of US corn in the week to Oct 15',
      'Japan bought 285,400 t of US corn in the week to Oct 15',
      'Mexico bought 232,200 t of US soybeans in the week to Oct 15',
      'United Kingdom bought 141,800 t of US corn in the week to Oct 15',
    ].map(t => t.replace('United Kingdom', buyers.find(b => b.countryCode === 'GB')?.locationName ?? 'United Kingdom')))
    const china = buyers[0]!
    expect(china.severity).toBe('high')                         // 10 times the 100,000 t mark
    expect(china.summary).toMatch(/against none by this point last year/)
    expect(china.lat).not.toBeNull()
    expect(china.tags).toContain('buyer-cn')
    expect(buyers.find(b => b.locationName === 'Spain')).toBeUndefined()   // 8,000 t cancelled: under the mark
  })

  it('reads net cancellations as such', () => {
    const g = GROUPS.find(x => x.key === 'corn')!
    const c = { ...week.commodities.find(x => x.key === 'corn')!, net_sales: -120_000 }
    expect(commoditySeverity(c, g)).toBe('high')
    const plan = planSignals({ ...week, commodities: [c], buyers: [] })
    expect(plan[0]!.title).toBe('US corn export sales: net cancellations of 120,000 t in the week to Oct 15')
  })

  it('rounds quantities as USDA does', () => {
    expect(formatQuantity(239_627, 't')).toBe('239,600 t')
    expect(formatQuantity(2_000_000, 't')).toBe('2 million t')
    expect(formatQuantity(1_527_122, 't')).toBe('1.53 million t')
    expect(formatQuantity(-199_629, 'bales')).toBe('199,600 bales')
  })
})
