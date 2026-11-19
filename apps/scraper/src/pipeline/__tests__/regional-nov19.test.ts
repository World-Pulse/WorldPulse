/**
 * The regional round (Nov 19, 2026; Devon, 7:29 AM: "Yes" to regional outlets in the thin languages): sixteen feeds in
 * Swahili, Persian, Thai, Bengali, Hindi and Chinese, and Bengali place names for the first Bengali feed.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})

const { NEWS_SOURCE_REGISTRY } = await import('../../sources/news-rss')
const { withLocalNames } = await import('../local-names')

describe('the regional feeds', () => {
  const byId = new Map(NEWS_SOURCE_REGISTRY.map(s => [s.id, s]))
  it('lists all sixteen in their own language and country', () => {
    const want: Array<[string, string, string]> = [
      ['jamhuri-tz', 'sw', 'TZ'], ['globalpublishers-tz', 'sw', 'TZ'], ['kayhan-london', 'fa', 'IR'], ['etilaatroz', 'fa', 'AF'],
      ['thai-post', 'th', 'TH'], ['transborder-news-th', 'th', 'TH'], ['chiangmai-news', 'th', 'TH'],
      ['dainik-azadi', 'bn', 'BD'], ['janchowk', 'hi', 'IN'], ['newtalk-tw', 'zh', 'TW'],
      ['michuzi-tz', 'sw', 'TZ'], ['rukhshana', 'fa', 'AF'], ['deshe-bideshe', 'bn', 'BD'], ['kolkata24x7', 'bn', 'IN'],
      ['devbhoomi-media', 'hi', 'IN'], ['himachal-abhi-abhi', 'hi', 'IN'],
    ]
    for (const [id, language, countryCode] of want) expect(byId.get(id), id).toMatchObject({ language, countryCode })
    expect(new Set(NEWS_SOURCE_REGISTRY.map(s => s.id)).size).toBe(NEWS_SOURCE_REGISTRY.length)
  })
})

describe('Bengali place names', () => {
  it('reads them with their case endings', () => {
    expect(withLocalNames('চট্টগ্রামে ১২ প্লাটুন বিজিবি মোতায়েন', 'bn')).toContain('Chittagong')
    expect(withLocalNames('ঢাকায় বিক্ষোভ, বাংলাদেশের রাজনীতি', 'bn')).toMatch(/Dhaka[\s\S]*Bangladesh/)
    expect(withLocalNames('ভারতের সঙ্গে আলোচনা', 'bn')).toContain('India')
  })
  it('does not read "Chinese" as China', () => {
    expect(withLocalNames('চীনা পণ্য', 'bn')).not.toContain('China')
  })
})
