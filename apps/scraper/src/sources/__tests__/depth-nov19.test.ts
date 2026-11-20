/**
 * The depth round (Nov 19, 2026, night; Devon, 8:37 PM: languages first, then sources): the big languages where the list
 * was thinnest against the outlets GDELT's translated list showed publishing in two hours.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})

const { NEWS_SOURCE_REGISTRY } = await import('../news-rss')

describe("the depth round's feeds", () => {
  it('reads more outlets in Italian, Japanese, Ukrainian, Greek, Turkish and German', () => {
    const count = (lang: string) => NEWS_SOURCE_REGISTRY.filter(s => s.language === lang).length
    expect(count('it')).toBeGreaterThanOrEqual(13)
    expect(count('ja')).toBeGreaterThanOrEqual(11)
    expect(count('uk')).toBeGreaterThanOrEqual(7)
    expect(count('el')).toBeGreaterThanOrEqual(8)
    expect(count('tr')).toBeGreaterThanOrEqual(9)
    expect(count('de')).toBeGreaterThanOrEqual(15)
  })

  it("adds each feed once, at an address no other entry reads", () => {
    const ids = ['unn-uk', 'espreso-tv', 'glavcom', 'il-messaggero', 'il-mattino', 'il-gazzettino', 'il-giorno', 'la-nazione',
      'il-resto-del-carlino', 'gazzetta-del-mezzogiorno', 'open-online', 'swr', 'wdr', 'cnn-greece', 'efsyn', 'newsbomb', 'enikos',
      'sigmalive', 'chiba-nippo', 'fukui-shimbun', 'hokkoku-shimbun', 'j-cast', 'akita-sakigake', 'haber7', 'mynet-haber']
    for (const id of ids) {
      const entries = NEWS_SOURCE_REGISTRY.filter(s => s.id === id)
      expect(entries.length, id).toBe(1)
      expect(NEWS_SOURCE_REGISTRY.filter(s => s.feedUrl === entries[0]!.feedUrl).length, id).toBe(1)
    }
  })
})
