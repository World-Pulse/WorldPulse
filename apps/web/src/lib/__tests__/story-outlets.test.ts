import { describe, it, expect, vi, beforeEach } from 'vitest'

// The story page asks for its story's outlet count on the server (Oct 20,
// 2026: a story of 87 outlets showed "Reported by 9 outlets" to search
// engines and link previews, until the browser had asked)

const h = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@/lib/server-fetch', () => ({ cachedFetch: h.fetch }))

import { fetchStoryOutlets } from '@/lib/story-outlets'

const ID = '3b77739f-04bc-4bf9-b7c5-5c90d537e740'
const answer = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

describe('fetchStoryOutlets', () => {
  beforeEach(() => { h.fetch.mockReset() })

  it("returns the story's outlet count", async () => {
    h.fetch.mockResolvedValue(answer({ success: true, data: { stories: { [ID]: { storyId: 's', size: 313, outlets: 87, verified: true } } } }))
    expect(await fetchStoryOutlets(ID)).toBe(87)
    expect(h.fetch.mock.calls[0]![0]).toMatch(new RegExp(`/api/v1/stories/outlets\\?ids=${ID}$`))
  })

  it("returns null when the story isn't known", async () => {
    h.fetch.mockResolvedValue(answer({ success: true, data: { stories: {} } }))
    expect(await fetchStoryOutlets(ID)).toBeNull()
  })

  it('returns null when the API answers an error', async () => {
    h.fetch.mockResolvedValue(answer({}, 500))
    expect(await fetchStoryOutlets(ID)).toBeNull()
  })

  it("returns null when the API can't be reached, so the report's own outlets stand in", async () => {
    h.fetch.mockImplementation(() => Promise.reject(new Error('down')))
    const n = await fetchStoryOutlets(ID)
    expect(n).toBeNull()
  })
})
