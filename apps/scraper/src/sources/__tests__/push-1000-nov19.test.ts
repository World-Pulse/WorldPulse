/**
 * The push to 1,000 (Nov 19, 2026; Devon, 10:40 AM: "Ok let's keep pushing to 1,000"): countries with four feeds or
 * fewer, a feed where the outlet advertises one, else the news sitemap its robots.txt names; and place names in the
 * languages it brought.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})

const { NEWS_SOURCE_REGISTRY } = await import('../news-rss')
const { withLocalNames } = await import('../../pipeline/local-names')

describe('the push to 1,000', () => {
  it('lists the round with no id twice', () => {
    const ids = new Set(NEWS_SOURCE_REGISTRY.map(s => s.id))
    for (const id of ['opinion-bo', 'nrk-no', 'hs-fi', 'ruv-is', 'mediapool-bg', 'sdk-mk', 'telegram-hr', 'el-colombiano', 'la-nacion-cr', 'republic-of-togo',
      'e24-no', 'kloop-kg', 'netgazeti-ge', 'caasimada', 'dn-pt', 'vietnamnet', 'tengrinews-ru', 'el-watan-eg'])
      expect(ids.has(id), id).toBe(true)
    expect(ids.size).toBe(NEWS_SOURCE_REGISTRY.length)
  })
  it('labels the sites the governments run as state media', () => {
    for (const id of ['republic-of-togo', 'vietnamnet']) expect(NEWS_SOURCE_REGISTRY.find(s => s.id === id), id).toMatchObject({ biasLabel: 'state-media' })
  })
  it('passes 1,000 feeds', () => {
    expect(NEWS_SOURCE_REGISTRY.length).toBeGreaterThanOrEqual(1000)
  })
  it('reads the new languages’ place names', () => {
    expect(withLocalNames('Удар по Украйна', 'bg')).toContain('Ukraine')
    expect(withLocalNames('Напад во Украина', 'mk')).toContain('Ukraine')
    expect(withLocalNames('Droneangrep i Russland', 'no')).toContain('Russia')
    expect(withLocalNames('Räjähdys Venäjällä', 'fi')).toContain('Russia')
    expect(withLocalNames('Árás í Úkraínu', 'is')).toContain('Ukraine')
    expect(withLocalNames('აფეთქება რუსეთში', 'ka')).toContain('Russia')
    expect(withLocalNames('Qarax ka dhacay Muqdisho', 'so')).toContain('Mogadishu')
  })
})
