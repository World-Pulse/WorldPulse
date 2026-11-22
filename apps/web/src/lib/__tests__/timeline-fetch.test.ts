import { describe, it, expect, vi } from 'vitest'
import { fetchJsonWithRetry, WAITS_MS } from '../timeline-fetch'

const answer = (status: number, body: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

describe('the map timeline, asked again when it fails (Nov 21, 2026)', () => {
  it('asks again after 2 and 6 seconds, and returns the first answer that works', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(answer(503))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(answer(200, { data: { buckets: [1] } }))
    const sleep = vi.fn(async () => {})
    const json = await fetchJsonWithRetry('/t', { fetchImpl: fetchImpl as unknown as typeof fetch, sleep })
    expect(json).toEqual({ data: { buckets: [1] } })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map(c => (c as unknown as [number])[0])).toEqual([...WAITS_MS])
  })

  it('throws the last error after three tries', async () => {
    const fetchImpl = vi.fn(async () => answer(500))
    await expect(fetchJsonWithRetry('/t', { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} }))
      .rejects.toThrow('Timeline API returned 500')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it("doesn't ask again for the request's own fault (400), but does after a 429", async () => {
    const bad = vi.fn(async () => answer(400))
    await expect(fetchJsonWithRetry('/t', { fetchImpl: bad as unknown as typeof fetch, sleep: async () => {} })).rejects.toThrow('400')
    expect(bad).toHaveBeenCalledTimes(1)
    const busy = vi.fn().mockResolvedValueOnce(answer(429)).mockResolvedValueOnce(answer(200, { ok: 1 }))
    await expect(fetchJsonWithRetry('/t', { fetchImpl: busy as unknown as typeof fetch, sleep: async () => {} })).resolves.toEqual({ ok: 1 })
  })
})
