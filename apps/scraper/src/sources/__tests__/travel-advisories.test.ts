/**
 * US travel advisories (Nov 5, 2026). The items below are shaped as the State Department's feed
 * (travel.state.gov/_res/rss/TAsTWs.xml) gave them that day, cut short.
 */
import { describe, it, expect } from 'vitest'
import {
  advisoryDay, advisoryText, parseAdvisories, parseSeen, advisoryChange, advisorySeverity, advisorySignalText,
  advisoryPlace, type Advisory,
} from '../travel-advisories'

const item = (title: string, link: string, day: string, html = '') =>
  `<item>\n      <title>${title}</title>\n      <link>${link}</link>\n      <pubDate>${day}</pubDate>\n      <description><![CDATA[${html}]]></description>\n    </item>`
const PAGE = (code: string) => `https://travel.state.gov/content/tsg_aem/us/en/home/international-travel/travel-advisories/destination.${code}.html`
const OLD = (slug: string) => `https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories/${slug}-travel-advisory.html`

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0"><channel><title>travel.state.gov: Travel Advisories</title>
${item('Iran - Level 4: Do Not Travel', PAGE('irn'), 'Fri, 23 Oct 2026',
  "Do not travel<p>to <b>Iran </b>due to the risk of <b>terrorism</b>, <b>unrest</b>, <b>kidnapping</b>, <b>arbitrary arrest</b> of U.S. citizens, and <b>wrongful detention</b>. Read the entire Travel Advisory.</p>\n<ul>\n<li><span class='body-regular'><b>Do not travel to Iran for any reason. U.S. citizens in Iran should leave immediately</b>.&nbsp;</span></li></ul>")}
${item('Republic of Congo - Level 2: Exercise Increased Caution', PAGE('cog'), 'Wed, 02 Oct 2024')}
${item('Mexico Travel Advisory - Level 2: Exercise Increased Caution', PAGE('mex'), 'Fri, 29 May 2026')}
${item('Tonga - Level 1: Exercise Normal Precautions', OLD('tonga'), 'Mon, 02 Dec 2024')}
${item('Tonga - Level 1: Exercise Normal Precautions', PAGE('ton'), 'Tue, 01 Sep 2026')}
${item('Jordan - Level 3: Reconsider Travel', PAGE('jor'), 'Fri, 23 Oct 2026')}
${item('Gaza - Level 4: Do Not Travel', PAGE('xgz'), 'Wed, 26 Aug 2026')}
${item('The West Bank - Level 3: Reconsider Travel', PAGE('xwb'), 'Wed, 26 Aug 2026')}
${item('Antarctica - Level 1: Exercise Normal Precautions', PAGE('ata'), 'Thu, 05 Jan 2023')}
${item('Travel Advisory Updates', PAGE('upd'), 'Fri, 23 Oct 2026')}
</channel></rss>`

const NOW = Date.parse('2026-10-24T12:00:00Z')
const byCode = (code: string) => parseAdvisories(FEED).find(a => a.code === code)!

describe('reading the feed', () => {
  it('dates an advisory by its day', () => {
    expect(advisoryDay('Fri, 23 Oct 2026')).toBe('2026-10-23')
    expect(advisoryDay('Mon, 2 Dec 2024')).toBe('2024-12-02')
    expect(advisoryDay('2026-11-05T13:44:01Z')).toBe('2026-11-05')
    expect(advisoryDay('soon')).toBeNull()
  })

  it('reads one advisory per place, the newest when a place is listed twice', () => {
    const list = parseAdvisories(FEED)
    expect(list.map(a => a.code).sort()).toEqual(['ata', 'cog', 'irn', 'jor', 'mex', 'ton', 'xgz', 'xwb'])
    expect(byCode('ton')).toMatchObject({ country: 'Tonga', level: 1, day: '2026-09-01' })
    expect(byCode('mex')).toMatchObject({ country: 'Mexico', level: 2, label: 'Exercise Increased Caution' })
    expect(byCode('irn')).toMatchObject({ country: 'Iran', level: 4, label: 'Do Not Travel', day: '2026-10-23', link: PAGE('irn') })
  })

  it('keeps the opening lines as plain text', () => {
    expect(byCode('irn').text).toBe('Do not travel to Iran due to the risk of terrorism, unrest, kidnapping, arbitrary arrest of U.S. citizens, and wrongful detention. Do not travel to Iran for any reason. U.S. citizens in Iran should leave immediately.')
    expect(advisoryText(`<p>${'A sentence about the risks here. '.repeat(30)}</p>`).length).toBeLessThanOrEqual(500)
  })

  it('reads what was kept for a place', () => {
    expect(parseSeen('4|2026-10-23')).toEqual({ level: 4, day: '2026-10-23' })
    expect(parseSeen(null)).toBeNull()
    expect(parseSeen('5|2026-10-23')).toBeNull()
  })
})

describe('which advisories are news', () => {
  const a = (level: Advisory['level'], day = '2026-10-23'): Advisory => ({ ...byCode('irn'), level, day })

  it('a level raised or lowered, whatever the level', () => {
    expect(advisoryChange(a(4), { level: 3, day: '2026-08-01' }, NOW)).toBe('raised')
    expect(advisoryChange(a(2), { level: 1, day: '2026-08-01' }, NOW)).toBe('raised')
    expect(advisoryChange(a(1), { level: 2, day: '2026-08-01' }, NOW)).toBe('lowered')
  })

  it('a Level 3 or 4 advisory reissued, but not a routine Level 1 or 2 one', () => {
    expect(advisoryChange(a(4), { level: 4, day: '2026-08-01' }, NOW)).toBe('reissued')
    expect(advisoryChange(a(3), { level: 3, day: '2026-08-01' }, NOW)).toBe('reissued')
    expect(advisoryChange(a(2), { level: 2, day: '2026-08-01' }, NOW)).toBeNull()
    expect(advisoryChange(a(4), { level: 4, day: '2026-10-23' }, NOW)).toBeNull()
  })

  it('the first time a place is seen, only a recent Level 3 or 4 advisory', () => {
    expect(advisoryChange(a(4), null, NOW)).toBe('new')
    expect(advisoryChange(a(4, '2026-10-01'), null, NOW)).toBeNull()
    expect(advisoryChange(a(2), null, NOW)).toBeNull()
  })

  it('a raise to Level 4 is high; a raise to 3 or any Level 4, medium; the rest low', () => {
    expect(advisorySeverity({ level: 4 }, 'raised')).toBe('high')
    expect(advisorySeverity({ level: 3 }, 'raised')).toBe('medium')
    expect(advisorySeverity({ level: 4 }, 'reissued')).toBe('medium')
    expect(advisorySeverity({ level: 3 }, 'reissued')).toBe('low')
    expect(advisorySeverity({ level: 2 }, 'lowered')).toBe('low')
  })

  it('says what changed in the headline and names the State Department', () => {
    const iran = byCode('irn')
    expect(advisorySignalText(iran, 'raised', { level: 3, day: '2026-08-01' }).title)
      .toBe('US raises its travel advisory for Iran to Level 4: Do Not Travel (was Level 3)')
    expect(advisorySignalText({ ...iran, level: 2, label: 'Exercise Increased Caution' }, 'lowered', { level: 4, day: '2026-08-01' }).title)
      .toBe('US lowers its travel advisory for Iran to Level 2: Exercise Increased Caution (was Level 4)')
    expect(advisorySignalText(iran, 'reissued', { level: 4, day: '2026-08-01' }).title).toBe('US reissues its travel advisory for Iran: Level 4, Do Not Travel')
    expect(advisorySignalText(iran, 'new', null).summary).toMatch(/\nSource: U\.S\. Department of State, travel advisory of 2026-10-23\.$/)
  })
})

describe('where an advisory goes on the map', () => {
  it('trusts the State Department\'s code over a country name the place-finder misreads', () => {
    expect(advisoryPlace(byCode('cog'))).toMatchObject({ countryCode: 'CG' })
    expect(advisoryPlace(byCode('jor'))).toMatchObject({ countryCode: 'JO' })
    expect(advisoryPlace(byCode('irn'))).toMatchObject({ countryCode: 'IR' })
  })

  it('keeps Gaza and the West Bank apart, and puts nothing on the map for Antarctica', () => {
    const gaza = advisoryPlace(byCode('xgz')), bank = advisoryPlace(byCode('xwb'))
    expect([gaza.countryCode, bank.countryCode]).toEqual(['PS', 'PS'])
    expect(gaza.lat).not.toBe(bank.lat)
    expect(advisoryPlace(byCode('ata'))).toMatchObject({ lat: null, lng: null, countryCode: 'AQ' })
  })
})
