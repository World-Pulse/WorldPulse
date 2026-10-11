import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ raws: [] as Array<{ sql: string; params?: unknown[] }> }))

vi.mock('../../lib/postgres', () => ({
  db: Object.assign(vi.fn(), {
    raw: vi.fn(async (sql: string, params?: unknown[]) => { h.raws.push({ sql, params }); return { rowCount: 3 } }),
  }),
}))

import { fixLocalhostUploadUrls, undoTemplateCorroboration } from '../repairs'
import { EVENT_TEMPLATE_SQL } from '../event-titles'

describe('fixLocalhostUploadUrls', () => {
  beforeEach(() => { h.raws.length = 0 })

  it('points localhost upload URLs at the public site and reports how many posts changed', async () => {
    expect(await fixLocalhostUploadUrls()).toBe(3)
    const [{ sql, params }] = h.raws
    expect(sql).toMatch(/UPDATE posts/)
    expect(sql).toMatch(/WITH ORDINALITY/) // keeps the order of a post's media
    expect(params?.[1]).toBe('https://world-pulse.io/uploads/')
  })

  it('only rewrites the API-internal prefix', () => {
    const re = new RegExp('^https?://(localhost|127\\.0\\.0\\.1):3001/uploads/')
    const fix = (u: string) => u.replace(re, 'https://world-pulse.io/uploads/')
    expect(fix('http://localhost:3001/uploads/post-media/abc.webp')).toBe('https://world-pulse.io/uploads/post-media/abc.webp')
    expect(fix('http://127.0.0.1:3001/uploads/post-media/x.mp4')).toBe('https://world-pulse.io/uploads/post-media/x.mp4')
    expect(fix('https://cdn.example.com/uploads/a.png')).toBe('https://cdn.example.com/uploads/a.png')
    expect(fix('https://world-pulse.io/uploads/post-media/ok.webp')).toBe('https://world-pulse.io/uploads/post-media/ok.webp')
  })
})

describe('undoTemplateCorroboration', () => {
  beforeEach(() => { h.raws.length = 0 })

  it('puts corroborated GDELT event-label signals back to one source and pending', async () => {
    expect(await undoTemplateCorroboration()).toBe(3)
    const [{ sql, params }] = h.raws
    expect(sql).toMatch(/SET status = 'pending'/)
    expect(sql).toMatch(/source_count = 1/)
    expect(sql).toMatch(/original_urls = original_urls\[1:1\]/) // its own link only
    expect(sql).toMatch(/tags @> ARRAY\['gdelt'\]/)
    expect(sql).toMatch(/INTERVAL '7 days'/)
    expect(sql).toMatch(/status = 'verified' OR source_count > 1/) // nothing to do on a later start
    expect(params).toEqual([0.65, EVENT_TEMPLATE_SQL])
  })

  it('matches the event-label titles and not real headlines (POSIX classes read as Unicode classes)', () => {
    const js = new RegExp(EVENT_TEMPLATE_SQL.replace(/\[\[:upper:\]\]/g, '\\p{Lu}').replace(/\[:alpha:\]/g, '\\p{L}'), 'u')
    expect(js.test('Armed conflict in Washington, District of Columbia, United States')).toBe(true)
    expect(js.test('Disapproval in Ghazipur, Uttar Pradesh, India')).toBe(true)
    expect(js.test('Consultation in Sydney, New South Wales, Australia')).toBe(true)
    expect(js.test('Protest')).toBe(true)
    expect(js.test('Protest in Paris over pension reform turns violent')).toBe(false)
    expect(js.test('At least 12 dead in Riyadh airport attack')).toBe(false)
  })
})
