/**
 * A report the database refused is stored on the next read (Nov 10, 2026): the event's cross-source claim was
 * left "pending" for its 6 hours, so the next read took the article for a duplicate of itself and marked it read.
 * SBC's first stories (a three-letter language in a two-letter column) were lost that way.
 */
import { describe, it, expect, vi } from 'vitest'

const store = new Map<string, string>()
vi.mock('../../lib/redis', () => ({
  redis: {
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return null
      store.set(key, value)
      return 'OK'
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => { store.delete(key); return 1 }),
    publish: vi.fn(async () => 0),
    zadd: vi.fn(async () => 1), zremrangebyscore: vi.fn(async () => 0), zcount: vi.fn(async () => 0),
    incr: vi.fn(async () => 1), expire: vi.fn(async () => 1), hgetall: vi.fn(async () => ({})),
  },
}))

let refuse = true
const inserted: unknown[] = []
vi.mock('../../lib/postgres', () => ({
  db: vi.fn(() => ({
    insert: (data: unknown) => ({
      returning: async () => {
        if (refuse) { refuse = false; throw new Error('value too long for type character(2)') }
        inserted.push(data)
        return [{ id: '11111111-1111-4111-8111-111111111111', title: 'Lasanble Nasyonal in aprouv proze-de-lwa', category: 'geopolitics', severity: 'low', created_at: new Date() }]
      },
    }),
  })),
}))
vi.mock('../correlate', () => ({ correlateSignal: vi.fn(async () => null), corroborateWithDuplicate: vi.fn(async () => false) }))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../../health', () => ({ recordSuccess: vi.fn(async () => undefined) }))

const { insertAndCorrelate } = await import('../insert-signal')

describe('a refused insert (Nov 10, 2026)', () => {
  it("lets go of the event's claim, so the next read stores the report", async () => {
    const signal = { title: 'Lasanble Nasyonal in aprouv proze-de-lwa pou amann Lalwa Kontrol Taba', category: 'geopolitics', severity: 'low', reliability_score: 0.7, language: 'fr' }
    await expect(insertAndCorrelate({ ...signal }, { lat: -4.62, lng: 55.45, sourceId: 'sbc-seychelles' })).rejects.toThrow(/character\(2\)/)
    expect([...store.values()]).not.toContain('pending')
    const second = await insertAndCorrelate({ ...signal }, { lat: -4.62, lng: 55.45, sourceId: 'sbc-seychelles' }) as { id?: string; _skipped?: boolean }
    expect(second._skipped).toBeUndefined()
    expect(inserted).toHaveLength(1)
  })
})
