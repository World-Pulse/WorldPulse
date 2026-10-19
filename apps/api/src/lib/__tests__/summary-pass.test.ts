import { describe, it, expect, vi, beforeEach } from 'vitest'

// The verified stories the database returns, and what Redis keeps
const rows = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }))
const store = vi.hoisted(() => ({ kept: new Set<string>(), tried: new Set<string>(), lock: null as string | null }))
const gen = vi.hoisted(() => ({ fn: vi.fn(), allowed: vi.fn(async () => true) }))

vi.mock('../../db/postgres', () => {
  const chain: Record<string, unknown> = {}
  for (const op of ['where', 'orderBy', 'limit']) chain[op] = () => chain
  chain.select = async () => rows.list
  return { db: () => chain }
})

vi.mock('../../db/redis', () => ({
  redis: {
    set: vi.fn(async (key: string, _v: string, ...args: string[]) => {
      if (key === 'signal-ai-summary:pass-lock' && args.includes('NX')) {
        if (store.lock) return null
        store.lock = 'held'
      }
      if (key.startsWith('signal-ai-summary:tried:')) store.tried.add(key)
      return 'OK'
    }),
    del: vi.fn(async (key: string) => { if (key === 'signal-ai-summary:pass-lock') store.lock = null; return 1 }),
    mget: vi.fn(async (...keys: string[]) => keys.map(k => (store.kept.has(k) || store.tried.has(k) ? '1' : null))),
  },
}))

vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }))

vi.mock('../signal-summary', () => ({
  CACHE_KEY_PREFIX: 'signal-ai-summary:',
  generateSignalSummary: gen.fn,
  summaryAllowed: gen.allowed,
}))

const story = (id: string) => ({ id, title: `Story ${id}`, summary: 's', body: 'b', category: 'conflict', severity: 'high', tags: ['x'], language: 'en' })

describe('summarizeVerifiedStories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rows.list = [story('a'), story('b'), story('c')]
    store.kept = new Set(['signal-ai-summary:b'])
    store.tried = new Set()
    store.lock = null
    gen.allowed.mockImplementation(async () => true)
    gen.fn.mockImplementation(async (s: { id: string }) => ({ text: `AI ${s.id}`, model: 'anthropic', generatedAt: 'now' }))
  })

  it('summarizes the verified stories that have none, newest first', async () => {
    const { summarizeVerifiedStories } = await import('../summary-pass')
    const r = await summarizeVerifiedStories(new Date('2026-10-19T17:00:00Z'))
    expect(r).toMatchObject({ checked: 3, missing: 2, written: 2 })
    expect(gen.fn.mock.calls.map(c => (c[0] as { id: string }).id)).toEqual(['a', 'c'])
    expect(store.lock).toBeNull()
  })

  it('stops when no AI can answer now (the cap or the day\'s limit)', async () => {
    gen.allowed.mockImplementation(async () => false)
    const { summarizeVerifiedStories } = await import('../summary-pass')
    const r = await summarizeVerifiedStories(new Date())
    expect(r.written).toBe(0)
    expect(r.stopped).toMatch(/no AI now/)
    expect(gen.fn).not.toHaveBeenCalled()
  })

  it('a story whose summary fails waits 6 hours, and the pass goes on to the next', async () => {
    gen.fn.mockResolvedValueOnce({ text: 'x', model: 'extractive', generatedAt: 'now' })
    const { summarizeVerifiedStories, storiesWithoutSummary } = await import('../summary-pass')
    const r = await summarizeVerifiedStories(new Date())
    expect(r.written).toBe(1)
    expect(gen.fn.mock.calls.map(c => (c[0] as { id: string }).id)).toEqual(['a', 'c'])
    expect(store.tried.has('signal-ai-summary:tried:a')).toBe(true)
    // the next pass leaves it out
    const next = await storiesWithoutSummary(new Date())
    expect(next.todo.map(s => s.id)).toEqual(['c'])
  })

  it('three failures in a row end the pass', async () => {
    rows.list = Array.from({ length: 6 }, (_, i) => story(`s${i}`))
    store.kept = new Set()
    gen.fn.mockResolvedValue({ text: 'x', model: 'extractive', generatedAt: 'now' })
    const { summarizeVerifiedStories } = await import('../summary-pass')
    const r = await summarizeVerifiedStories(new Date())
    expect(r.stopped).toBe('three summaries failed in a row')
    expect(gen.fn).toHaveBeenCalledTimes(3)
  })

  it('writes at most a batch a pass', async () => {
    rows.list = Array.from({ length: 50 }, (_, i) => story(`s${i}`))
    store.kept = new Set()
    const { summarizeVerifiedStories } = await import('../summary-pass')
    const r = await summarizeVerifiedStories(new Date(), 30)
    expect(r.written).toBe(30)
    expect(r.missing).toBe(50)
  })

  it('does nothing while another pass runs', async () => {
    store.lock = 'held'
    const { summarizeVerifiedStories } = await import('../summary-pass')
    const r = await summarizeVerifiedStories(new Date())
    expect(r.stopped).toBe('another pass is running')
    expect(gen.fn).not.toHaveBeenCalled()
  })
})
