import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ raws: [] as Array<{ sql: string; params?: unknown[] }> }))

vi.mock('../../lib/postgres', () => ({
  db: Object.assign(vi.fn(), {
    raw: vi.fn(async (sql: string, params?: unknown[]) => { h.raws.push({ sql, params }); return { rowCount: 3 } }),
  }),
}))

import { fixLocalhostUploadUrls } from '../repairs'

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
