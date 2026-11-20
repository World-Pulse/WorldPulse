/**
 * Second and third outlets for the languages one outlet read (Nov 20, 2026; Devon, 11:05 AM: "Proceed"), so a story
 * in them can be confirmed by another outlet: Bulgarian, Croatian, Macedonian, Amharic, Burmese, Punjabi, Somali,
 * Sindhi, Hebrew and Tagalog.
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

const ADDED: Record<string, string[]> = {
  bg: ['nova-bg'],
  hr: ['n1info-hr', 'novilist-hr'],
  mk: ['nova-makedonija', 'telma-mk', 'a1on-mk', '360stepeni-mk', 'radiomof-mk', 'meta-mk-mk'],
  am: ['wazema-radio'],
  my: ['myanmar-now-mm'],
  pa: ['rozana-spokesman'],
  so: ['puntland-post', 'horseed-media', 'sonna-so', 'radio-muqdisho'],
  sd: ['ktn-news'],
  he: ['mako-news'],
  tl: ['gma-ulat-filipino'],
}

describe('second and third outlets (Nov 20, 2026)', () => {
  const byId = new Map(NEWS_SOURCE_REGISTRY.map(s => [s.id, s]))

  it('reads each in its language, from its own feed', () => {
    for (const [language, ids] of Object.entries(ADDED)) {
      for (const id of ids) {
        const source = byId.get(id)
        expect(source, id).toBeDefined()
        expect(source!.language, id).toBe(language)
        expect(source!.feedUrl, id).toMatch(/^https:\/\//)
        expect(NEWS_SOURCE_REGISTRY.filter(s => s.feedUrl === source!.feedUrl), id).toHaveLength(1)
      }
    }
  })

  it('gives each language more than one outlet', () => {
    for (const language of Object.keys(ADDED)) {
      expect(NEWS_SOURCE_REGISTRY.filter(s => s.language === language).length, language).toBeGreaterThanOrEqual(2)
    }
  })

  it("labels Somalia's state news agency and state radio, below 0.6", () => {
    for (const id of ['sonna-so', 'radio-muqdisho']) {
      expect(byId.get(id)!.biasLabel).toBe('state-media')
      expect(byId.get(id)!.reliability).toBeLessThan(0.6)
      expect(byId.get(id)!.extraTags).toContain('state-media')
    }
  })
})
