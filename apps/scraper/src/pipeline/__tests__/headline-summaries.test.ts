/**
 * The repair for summaries that only repeat the headline and the story posts
 * that show it twice (H-0024, Oct 20, 2026; repairs.ts repairHeadlineSummaries).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  signals: [] as Array<{ id: string; title: string; summary: string; original_urls: string[] }>,
  articles: [] as Array<{ url: string; body: string }>,
  posts: [] as Array<{ id: string; content: string; summary: string | null }>,
  updates: [] as Array<{ table: string; params: unknown[] }>,
  asked: [] as string[],
}))

vi.mock('../../lib/postgres', () => ({
  db: Object.assign(vi.fn(), {
    raw: vi.fn(async (sql: string, params: unknown[] = []) => {
      h.asked.push(sql)
      if (/^\s*SELECT id, title, summary, original_urls/.test(sql)) return { rows: h.signals }
      if (/FROM raw_articles/.test(sql)) {
        const wanted = new Set(params[0] as string[])
        return { rows: h.articles.filter(a => wanted.has(a.url)) }
      }
      if (/FROM posts p/.test(sql)) return { rows: h.posts }
      if (/UPDATE signals/.test(sql)) {
        h.updates.push({ table: 'signals', params })
        // the posts read the repaired summaries
        for (let i = 0; i < params.length; i += 2) for (const p of h.posts) if (p.id.endsWith(String(params[i]).slice(-4))) p.summary = params[i + 1] as string | null
        return { rowCount: params.length / 2 }
      }
      if (/UPDATE posts/.test(sql)) { h.updates.push({ table: 'posts', params }); return { rowCount: params.length / 2 } }
      return { rows: [] }
    }),
  }),
}))

import { repairHeadlineSummaries } from '../repairs'

const T1 = 'Tourist attractions shut and cattle starving: How El Niño is wreaking havoc around the world'
const T2 = 'Alberta rejects move toward independence from Canada'

describe('repairHeadlineSummaries', () => {
  beforeEach(() => {
    h.updates.length = 0
    h.asked.length = 0
    h.signals = [
      // the older reader: the headline as the summary; its feed had more
      { id: '00000000-0000-4000-8000-000000000001', title: T1, summary: T1, original_urls: ['https://www.euronews.com/2026/10/20/el-nino'] },
      // the headline cut at 150 characters; its feed had nothing more
      { id: '00000000-0000-4000-8000-000000000002', title: T2, summary: T2.slice(0, 30), original_urls: ['https://www.cbc.ca/news/alberta'] },
      // a short summary that says more: left alone
      { id: '00000000-0000-4000-8000-000000000003', title: T2, summary: 'Voters said no on Sunday.', original_urls: [] },
    ]
    h.articles = [
      { url: 'https://www.euronews.com/2026/10/20/el-nino', body: '<p>From Peru to Indonesia, the weather pattern is upending tourism and farming.</p>' },
      { url: 'https://www.cbc.ca/news/alberta', body: T2 },
    ]
    h.posts = [
      { id: 'post-0001', content: `${T1}\n\n${T1}`, summary: T1 },
      { id: 'post-0002', content: `${T2}\n\n${T2.slice(0, 30)}`, summary: T2.slice(0, 30) },
      // a post whose text says more (an AI Digest piece): left alone
      { id: 'post-0003', content: '📡 FLASH: Quake\n\nA magnitude 6.1 earthquake struck off northern Japan.', summary: null },
    ]
  })

  it("gives each report the article's opening from its feed, else no summary, and leaves real summaries alone", async () => {
    const t = await repairHeadlineSummaries()
    expect(t.summaries).toBe(2)
    const sig = h.updates.find(u => u.table === 'signals')!
    expect(sig.params).toEqual([
      '00000000-0000-4000-8000-000000000001', 'From Peru to Indonesia, the weather pattern is upending tourism and farming.',
      '00000000-0000-4000-8000-000000000002', null,
    ])
  })

  it('shows each story post\'s headline once, with the new summary when there is one, and leaves other posts alone', async () => {
    const t = await repairHeadlineSummaries()
    expect(t.posts).toBe(2)
    const posts = h.updates.find(u => u.table === 'posts')!
    expect(posts.params).toEqual([
      'post-0001', `${T1}\n\nFrom Peru to Indonesia, the weather pattern is upending tourism and farming.`,
      'post-0002', T2,
    ])
  })

  it('stays within the last 3 days and finds nothing more to do once done', async () => {
    await repairHeadlineSummaries()
    expect(h.asked.filter(q => /INTERVAL '3 days'/.test(q))).toHaveLength(2)
    h.updates.length = 0
    h.signals = []
    h.posts = [
      { id: 'post-0001', content: `${T1}\n\nFrom Peru to Indonesia, the weather pattern is upending tourism and farming.`, summary: 'From Peru to Indonesia, the weather pattern is upending tourism and farming.' },
      { id: 'post-0002', content: T2, summary: null },
    ]
    expect(await repairHeadlineSummaries()).toEqual({ summaries: 0, posts: 0 })
    expect(h.updates).toHaveLength(0)
  })
})
