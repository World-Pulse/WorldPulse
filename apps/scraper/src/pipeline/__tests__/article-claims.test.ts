/**
 * One stored report per news article, whichever of the two news readers gets
 * to it first (H-0014, Oct 20, 2026): the address key, the claim, and the
 * older reader's group step (pipeline/article-claims.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ store: new Map<string, string>(), ttl: new Map<string, number>(), down: false }))

vi.mock('../../lib/redis', () => ({
  redis: {
    get: vi.fn(async (k: string) => { if (h.down) throw new Error('down'); return h.store.get(k) ?? null }),
    set: vi.fn(async (k: string, v: string, ...opts: Array<string | number>) => {
      if (h.down) throw new Error('down')
      if (opts.includes('NX') && h.store.has(k)) return null
      h.store.set(k, v)
      const ex = opts.indexOf('EX')
      if (ex >= 0) h.ttl.set(k, Number(opts[ex + 1]))
      return 'OK'
    }),
    del: vi.fn(async (k: string) => (h.store.delete(k) ? 1 : 0)),
  },
}))

const { dedup, articleKey } = await import('../dedup')
const { claimArticleGroup } = await import('../article-claims')

const HELD = '6f1c2a9e-3b4d-4e5f-8a9b-0c1d2e3f4a5b'
const BBC = 'https://www.bbc.com/news/articles/c4g9xk2v7lzo?at_medium=RSS&at_campaign=rss'

describe('articleKey', () => {
  it('is the same however a feed spells one article', () => {
    const k = articleKey(BBC)
    expect(k).toMatch(/^[0-9a-f]{32}$/)
    for (const same of [
      'https://bbc.com/news/articles/c4g9xk2v7lzo',
      'http://www.bbc.com/news/articles/c4g9xk2v7lzo/',
      'https://www.BBC.com/news/articles/c4g9xk2v7lzo#comments',
      'https://www.bbc.com/news/articles/c4g9xk2v7lzo?utm_source=twitter&at_campaign=other',
      // as the newer reader reads it from the feed's XML (Oct 20, 2026: one BBC article was still stored twice)
      'https://www.bbc.com/news/articles/c4g9xk2v7lzo?at_medium=RSS&amp;at_campaign=rss',
    ]) expect(articleKey(same)).toBe(k)
  })

  it('keeps parameters that tell articles apart, in any order', () => {
    expect(articleKey('https://example.org/story.php?id=12&lang=en')).toBe(articleKey('https://example.org/story.php?lang=en&id=12&utm_medium=rss'))
    expect(articleKey('https://example.org/story.php?id=12')).not.toBe(articleKey('https://example.org/story.php?id=13'))
    expect(articleKey('https://www.dw.com/en/a-1')).not.toBe(articleKey('https://www.dw.com/en/a-2'))
  })

  it("can't tell an article by a front page, a non-web address or nonsense", () => {
    expect(articleKey('https://www.aljazeera.com/')).toBeNull()
    expect(articleKey('https://www.aljazeera.com?utm_source=rss')).toBeNull()
    expect(articleKey('tag:example.org,2026:123')).toBeNull()
    expect(articleKey('not a url')).toBeNull()
  })
})

describe('dedup.claimArticle', () => {
  beforeEach(() => { h.store.clear(); h.ttl.clear(); h.down = false })

  it('claims an article once, briefly, then remembers the report that holds it for 4 days', async () => {
    const first = await dedup.claimArticle(BBC)
    expect(first?.seen).toBeNull()
    expect(h.ttl.get(first!.key)).toBe(300)
    // the other reader, with the feed's own tags or without
    expect((await dedup.claimArticle('https://www.bbc.com/news/articles/c4g9xk2v7lzo'))?.seen).toBe('pending')
    await dedup.rememberArticle(first!.key, HELD)
    expect((await dedup.claimArticle(BBC))?.seen).toBe(HELD)
    expect(h.ttl.get(first!.key)).toBe(4 * 24 * 3600)
  })

  it('leaves another article free', async () => {
    await dedup.claimArticle(BBC)
    expect((await dedup.claimArticle('https://www.bbc.com/news/articles/c0000000000o'))?.seen).toBeNull()
  })

  it('lets go of a claim when nothing was stored, but never of a remembered report', async () => {
    const c = await dedup.claimArticle(BBC)
    await dedup.releaseArticle(c!.key)
    expect((await dedup.claimArticle(BBC))?.seen).toBeNull()
    const again = await dedup.claimArticle('https://www.dw.com/en/a-1')
    await dedup.rememberArticle(again!.key, HELD)
    await dedup.releaseArticle(again!.key)
    expect((await dedup.claimArticle('https://www.dw.com/en/a-1'))?.seen).toBe(HELD)
  })

  it('claims nothing for an address that tells no article', async () => {
    expect(await dedup.claimArticle('https://www.aljazeera.com/')).toBeNull()
    expect(h.store.size).toBe(0)
  })
})

describe('claimArticleGroup (the older news reader)', () => {
  beforeEach(() => { h.store.clear(); h.ttl.clear(); h.down = false })
  const art = (url: string) => ({ url, title: 't' })

  it('claims new articles, and keeps them for the report that stores them', async () => {
    const { articles, claims, heldBy } = await claimArticleGroup([art(BBC), art('https://www.dw.com/en/a-1')])
    expect(articles).toHaveLength(2)
    expect(heldBy).toBeNull()
    await claims.keep(HELD)
    await claims.release()   // does nothing once kept
    expect((await dedup.claimArticle(BBC))?.seen).toBe(HELD)
    expect((await dedup.claimArticle('https://dw.com/en/a-1'))?.seen).toBe(HELD)
  })

  it('leaves out an article the other reader is storing right now', async () => {
    await dedup.claimArticle(BBC)   // the newer reader, mid-insert
    const { articles, claims } = await claimArticleGroup([art(BBC), art('https://www.dw.com/en/a-1')])
    expect(articles.map(a => a.url)).toEqual(['https://www.dw.com/en/a-1'])
    expect(claims.keys).toHaveLength(1)
  })

  it('brings the group to the report that already holds one of its articles', async () => {
    const c = await dedup.claimArticle(BBC)
    await dedup.rememberArticle(c!.key, HELD)
    const { articles, heldBy, claims } = await claimArticleGroup([art(BBC), art('https://www.dw.com/en/a-1')])
    expect(heldBy).toBe(HELD)
    expect(articles).toHaveLength(2)
    expect(claims.keys).toHaveLength(1)   // only the new one is claimed
  })

  it('lets go of its claims when nothing was stored', async () => {
    const { claims } = await claimArticleGroup([art(BBC)])
    await claims.release()
    expect((await dedup.claimArticle(BBC))?.seen).toBeNull()
  })

  it('processes everything as before when Redis is down', async () => {
    h.down = true
    const { articles, claims, heldBy } = await claimArticleGroup([art(BBC), art('https://www.dw.com/en/a-1')])
    expect(articles).toHaveLength(2)
    expect(claims.keys).toHaveLength(0)
    expect(heldBy).toBeNull()
  })
})
