/**
 * Fingerprints pipeline (pipeline/fingerprints.ts): the table, storing, and the
 * backfill's walk back through the archive.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const raw = vi.fn()
vi.mock('../../lib/postgres', () => ({ db: { raw: (...a: unknown[]) => raw(...a) } }))

const store = new Map<string, string>()
vi.mock('../../lib/redis', () => ({
  redis: {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { store.set(k, v); return 'OK' }),
  },
}))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }))

const loadModel = vi.fn()
vi.mock('../../lib/fingerprint', async () => {
  const actual = await vi.importActual<typeof import('../../lib/fingerprint')>('../../lib/fingerprint')
  return { ...actual, loadFingerprintModel: () => loadModel() }
})

import { FINGERPRINT_DIMS, FINGERPRINT_MODEL, parseVocab } from '../../lib/fingerprint'

function tinyModel() {
  const vocab = parseVocab(['[PAD]', '[UNK]', 'ship', 'sink'].join('\n'))
  const values = new Int8Array(4 * FINGERPRINT_DIMS)
  values[2 * FINGERPRINT_DIMS] = 127
  values[3 * FINGERPRINT_DIMS + 1] = 127
  return { vocab, rows: 4, scales: new Float32Array(4).fill(1 / 127), values }
}

const row = (id: string, at: string, title = 'ship sink') => ({ id, title, summary: null, created_at: new Date(at) })

/** A fresh copy of the module (its "table ready" promise is module state) */
async function fresh() {
  vi.resetModules()
  return import('../fingerprints')
}

beforeEach(() => {
  raw.mockReset()
  store.clear()
  loadModel.mockReset()
  loadModel.mockResolvedValue(tinyModel())
})

describe('the table', () => {
  it('is created with its indexes when missing, once', async () => {
    raw.mockResolvedValue({ rows: [] })
    const m = await fresh()
    expect(await m.ensureFingerprintTable()).toBe(true)
    expect(await m.ensureFingerprintTable()).toBe(true)
    const sql = raw.mock.calls.map(c => String(c[0]))
    expect(sql.filter(s => /CREATE TABLE IF NOT EXISTS signal_fingerprints/.test(s))).toHaveLength(1)
    expect(sql.some(s => new RegExp(`vector\\(${FINGERPRINT_DIMS}\\)`).test(s))).toBe(true)
    expect(sql.some(s => /USING hnsw \(vec vector_cosine_ops\)/.test(s))).toBe(true)
  })

  it('reports false (and stores nothing) when it cannot be created', async () => {
    raw.mockRejectedValue(new Error('permission denied'))
    const m = await fresh()
    expect(await m.ensureFingerprintTable()).toBe(false)
    expect(await m.storeFingerprints([row('a', '2026-10-16T00:00:00Z')])).toBe(0)
  })
})

describe('storing', () => {
  it('writes one row per report with a known word, joined with signals, keeping existing ones', async () => {
    raw.mockImplementation(async (sql: string) => (/INSERT INTO signal_fingerprints/.test(sql) ? { rowCount: 1 } : { rows: [] }))
    const m = await fresh()
    const n = await m.storeFingerprints([row('a', '2026-10-16T00:00:00Z'), row('b', '2026-10-16T00:00:00Z', 'zzzz')])
    expect(n).toBe(1)
    const insert = raw.mock.calls.find(c => /INSERT INTO signal_fingerprints/.test(String(c[0])))!
    expect(String(insert[0])).toMatch(/JOIN signals s ON s\.id = v\.id::uuid/)
    expect(String(insert[0])).toMatch(/ON CONFLICT \(signal_id\) DO NOTHING/)
    const args = insert[1] as unknown[]
    expect(args).toHaveLength(4)                          // only "a": "zzzz" has no known word
    expect(args.slice(0, 3)).toEqual(['a', '2026-10-16T00:00:00.000Z', FINGERPRINT_MODEL])
    expect(String(args[3]).startsWith('[0.707107,0.707107,')).toBe(true)
  })

  it('stores nothing while the model is not available', async () => {
    raw.mockResolvedValue({ rows: [] })
    loadModel.mockResolvedValue(null)
    const m = await fresh()
    expect(await m.storeFingerprints([row('a', '2026-10-16T00:00:00Z')])).toBe(0)
    expect(raw.mock.calls.some(c => /INSERT INTO/.test(String(c[0])))).toBe(false)
  })

  it('never throws for a new report', async () => {
    raw.mockImplementation(async (sql: string) => { if (/INSERT/.test(sql)) throw new Error('db down'); return { rows: [] } })
    const m = await fresh()
    await expect(m.fingerprintSignal('a', 'ship', null, new Date())).resolves.toBe(false)
  })
})

describe('the backfill', () => {
  it('catches up recent reports, then walks the archive newest first and keeps its place', async () => {
    const pages: Record<string, unknown[]> = {
      recent: [row('r1', '2026-10-15T10:00:00Z')],
      first:  Array.from({ length: 2000 }, (_, i) => row(`o${i}`, `2026-10-1${i < 1000 ? 3 : 2}T00:00:00Z`)),
      next:   [row('z1', '2026-05-01T00:00:00Z')],
    }
    raw.mockImplementation(async (sql: string, args?: unknown[]) => {
      if (/LEFT JOIN signal_fingerprints/.test(sql)) return { rows: pages.recent }
      if (/FROM signals/.test(sql) && /\(created_at, id\) </.test(sql)) return { rows: pages.next, args }
      if (/FROM signals/.test(sql)) return { rows: pages.first }
      if (/INSERT INTO signal_fingerprints/.test(sql)) return { rowCount: ((args as unknown[]).length / 4) }
      return { rows: [] }
    })
    const m = await fresh()
    const one = await m.backfillFingerprints()
    expect(one).toMatchObject({ recent: 1, older: 2000, historyDone: false })
    expect(JSON.parse(store.get('fingerprints:history:cursor')!)).toEqual({ at: '2026-10-12T00:00:00.000Z', id: 'o1999' })

    const two = await m.backfillFingerprints()
    expect(two).toMatchObject({ older: 1, historyDone: true })
    const call = raw.mock.calls.find(c => /\(created_at, id\) </.test(String(c[0])))!
    expect(call[1]).toEqual(['2026-10-12T00:00:00.000Z', 'o1999'])
    expect(store.get('fingerprints:history:done')).toBe('1')

    const three = await m.backfillFingerprints()
    expect(three).toMatchObject({ older: 0, historyDone: true })
    expect(JSON.parse(store.get('fingerprints:stats')!)).toMatchObject({ model: FINGERPRINT_MODEL, history_done: true, error: null })
  })

  it('records why a run could not work', async () => {
    raw.mockResolvedValue({ rows: [] })
    loadModel.mockResolvedValue(null)
    const m = await fresh()
    const res = await m.backfillFingerprints()
    expect(res.error).toBeTruthy()
    expect(JSON.parse(store.get('fingerprints:stats')!).error).toBeTruthy()
  })
})
