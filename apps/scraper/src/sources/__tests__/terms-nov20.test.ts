/**
 * Devon, Nov 20, 2026, 7:03 AM, on outlets whose terms say personal or non-commercial use only: "proceed". Bans on
 * robots, scraping, data mining or AI training still keep an outlet out.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})

const { NEWS_SOURCE_REGISTRY } = await import('../news-rss')
const hosts = NEWS_SOURCE_REGISTRY.map(s => new URL(s.feedUrl).hostname)
const listed = (host: string) => hosts.some(h => h === host || h.endsWith(`.${host}`))

describe('outlets whose terms only limited use to personal or non-commercial use', () => {
  it('reads them, Malay from three outlets', () => {
    for (const host of ['bhaskar.com', 'divyabhaskar.co.in', 'utusan.com.my', 'kosmo.com.my', 'hbl.fi', 'egemen.kz', '24tv.ua',
      'focus.ua', 'tsn.ua', 'agi.it', 'zdfheute.de', 'skai.gr', 'dimokratiki.gr', 'bankwars.gr']) expect(listed(host), host).toBe(true)
    expect(NEWS_SOURCE_REGISTRY.filter(s => s.language === 'ms').length).toBeGreaterThanOrEqual(3)
  })

  it('still leaves out the ones whose terms ban scraping, bots or AI training', () => {
    for (const host of ['amarujala.com', 'mathrubhumi.com', 'siasat.com', 'prajavani.net', 'legit.ng']) expect(listed(host), host).toBe(false)
  })

  it('marks state media and keeps their reliability below 0.6', () => {
    for (const id of ['trt-haber', 'egemen']) {
      const src = NEWS_SOURCE_REGISTRY.find(s => s.id === id)
      expect(src?.biasLabel, id).toBe('state-media')
      expect(src!.reliability, id).toBeLessThan(0.6)
    }
  })
})
