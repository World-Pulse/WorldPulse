/**
 * The China round (Nov 19, 2026; Devon, 4:11 PM: "3 sources for a country with a billion people means we're
 * practically not covering China at all"): of 71 outlets, three pass; most mainland outlets advertise no feed and
 * publish no news sitemap, and the ones that do (China News Service) say "未经授权禁止转载、摘编、复制".
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

describe('China', () => {
  const cn = NEWS_SOURCE_REGISTRY.filter(s => s.countryCode === 'CN')
  it('has its new outlets, Global Times labelled state media', () => {
    expect(cn.map(s => s.id)).toEqual(expect.arrayContaining(['ifeng', 'global-times', 'nyt-chinese']))
    expect(cn.find(s => s.id === 'global-times')).toMatchObject({ biasLabel: 'state-media' })
    expect(cn.find(s => s.id === 'global-times')!.reliability).toBeLessThan(0.6)
  })
  it('keeps China News Service out (its pages bar reprinting)', () => {
    expect(NEWS_SOURCE_REGISTRY.some(s => s.feedUrl.includes('chinanews.com'))).toBe(false)
  })
})
