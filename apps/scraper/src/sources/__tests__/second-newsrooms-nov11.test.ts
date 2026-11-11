/**
 * Second newsrooms for the places one outlet reads (Nov 11, 2026; Devon, Nov 10: "Run another scan on your end").
 * Tonga Independent News was found: Tonga's second feed beside Kaniva Tonga, in English and Tongan. The scan's other
 * finds were left out (the registry's notes). Headlines from its feed on Nov 11.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: {} }))

const { NEWS_SOURCE_REGISTRY, HOME_PIN_SOURCES, inferGeo, thinPlaces } = await import('../news-rss')

const src = NEWS_SOURCE_REGISTRY.find(s => s.id === 'tonga-independent')!
const at = (title: string) => inferGeo(title, '', src)

describe('Tonga Independent News (Nov 11, 2026)', () => {
  it("is Tonga's second feed, read once, with a home pin", () => {
    expect(src).toMatchObject({ countryCode: 'TO', language: 'en', feedUrl: 'https://tongaindependent.com/feed/' })
    expect(NEWS_SOURCE_REGISTRY.filter(s => s.feedUrl.includes('tongaindependent.com'))).toHaveLength(1)
    expect(NEWS_SOURCE_REGISTRY.filter(s => s.countryCode === 'TO').map(s => s.id).sort()).toEqual(['kaniva-tonga', 'tonga-independent'])
    expect(HOME_PIN_SOURCES.has(src.id)).toBe(true)
    // still a thinly covered place, so its two outlets' stories are matched over two days (correlate.ts)
    expect(thinPlaces()).toContain('TO')
  })

  it("puts Tonga's own stories in Tonga, in English and in Tongan, and the world's where they name", () => {
    for (const title of [
      'Climate Fund Applicants Face Delays as Tonga Secures US$15 Million More',
      'Analysis: Fuel Prices Fell but Tonga’s Inflation Kept Rising',
      'Defendants Seek to Set Aside Lord Chief Justice’s Ruling in Liahona/Saineha Alumni Dispute',
      'Ulungia loua Mate Ma’a Tonga mo e Toa Samoa ‘i he Semi Final.',
      'Longoa’a Mamani ‘o e ‘akapulu Liiki he kehekehe fakavalevale ‘o e vahe kau va’inga he Ipu ‘a Mamani.',
    ]) expect(at(title).countryCode, title).toBe('TO')
    expect(at('Kei taki Netanyahu sea 53 hoko hake Eisenkot sea 48, Arab Parties sea 19 ko e 85.6% ia kau vouta ‘o').countryCode).toBe('IL')
  })

  it('leaves out the finds whose terms or feeds rule them out', () => {
    for (const host of ['nknews.org', 'info.gov.pg', 'thebhutanese.bt', 'thescoop.co', 'weefmgrenada.com', 'press.vatican.va', 'kuenselonline.com']) {
      expect(NEWS_SOURCE_REGISTRY.some(s => s.feedUrl.includes(host)), host).toBe(false)
    }
  })
})
