/**
 * Streaming and celebrity news from an outlet pinned at home (Nov 23, 2026, M78): Gulf News' Percy Jackson and
 * IShowSpeed stories sat at Dubai. They get no pin; the same outlet's own news keeps its.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})

const { NEWS_SOURCE_REGISTRY, inferGeo } = await import('../news-rss')
const gulf = NEWS_SOURCE_REGISTRY.find(s => s.id === 'gulf-news')!

describe('streaming and celebrity headlines', () => {
  it('get no home pin', () => {
    for (const h of [
      'Percy Jackson season 4? Walker Scobell\'s latest comment has fans doing the math',
      'IShowSpeed runs 100m in 10.35 seconds, leaving Usain Bolt impressed',
      'New Netflix series tops the box office charts',
    ]) expect(inferGeo(h, '', gulf).countryCode, h).not.toBe('AE')
  })
  it('keep the outlet\'s own news at home', () => {
    expect(inferGeo('Dubai Metro Blue Line opens to the public', '', gulf).countryCode).toBe('AE')
  })
})
