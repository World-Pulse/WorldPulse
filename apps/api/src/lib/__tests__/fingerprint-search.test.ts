/**
 * Search by meaning over the in-house fingerprints (lib/fingerprint-search.ts).
 * The fingerprint engine itself is tested in the scraper
 * (apps/scraper/src/lib/__tests__/fingerprint.test.ts), which also checks
 * that its copy and the API's are identical.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const raw = vi.fn()
const trxRaw = vi.fn()

vi.mock('../../db/postgres', () => ({
  db: {
    raw: (...a: unknown[]) => raw(...a),
    transaction: async (fn: (trx: { raw: typeof trxRaw }) => unknown) => fn({ raw: trxRaw }),
  },
}))

const loadModel = vi.fn()
vi.mock('../fingerprint', async () => {
  const actual = await vi.importActual<typeof import('../fingerprint')>('../fingerprint')
  return { ...actual, loadFingerprintModel: () => loadModel() }
})

import { similarReports, searchByMeaning, SIMILAR_MIN_SCORE } from '../fingerprint-search'
import { FINGERPRINT_DIMS, FINGERPRINT_MODEL, parseVocab } from '../fingerprint'

const ID = '11111111-1111-4111-8111-111111111111'

function tinyModel() {
  const vocab = parseVocab(['[PAD]', '[UNK]', 'ship', 'sink'].join('\n'))
  const values = new Int8Array(4 * FINGERPRINT_DIMS)
  values[2 * FINGERPRINT_DIMS] = 127
  values[3 * FINGERPRINT_DIMS + 1] = 127
  return { vocab, rows: 4, scales: new Float32Array(4).fill(1 / 127), values }
}

beforeEach(() => {
  raw.mockReset()
  trxRaw.mockReset()
  loadModel.mockReset()
})

describe('similarReports', () => {
  it('is empty when the report has no fingerprint yet', async () => {
    raw.mockResolvedValue({ rows: [] })
    expect(await similarReports(ID)).toEqual([])
    expect(trxRaw).not.toHaveBeenCalled()
  })

  it('looks three weeks either side of the report, leaving the report itself out', async () => {
    raw.mockResolvedValue({ rows: [{ vec: '[0.1,0.2]', created_at: '2026-10-16T00:00:00Z' }] })
    trxRaw.mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: 'b', score: '0.8123' }, { id: 'c', score: 0.6 }] })
    const res = await similarReports(ID, 5)
    expect(res).toEqual([{ id: 'b', score: 0.812 }, { id: 'c', score: 0.6 }])
    expect(trxRaw.mock.calls[0]?.[0]).toMatch(/SET LOCAL hnsw\.ef_search = 200/)
    const [sql, args] = trxRaw.mock.calls[1] as [string, unknown[]]
    expect(sql).toMatch(/f\.signal_id <> \?::uuid/)
    expect(sql).toMatch(/s\.created_at >= \?/)
    expect(args).toEqual(['[0.1,0.2]', FINGERPRINT_MODEL, ID, '[0.1,0.2]', SIMILAR_MIN_SCORE,
      '2026-09-25T00:00:00.000Z', '2026-11-06T00:00:00.000Z', 5])
  })

  it('is empty (not an error) when the table is missing', async () => {
    raw.mockRejectedValue(new Error('relation "signal_fingerprints" does not exist'))
    expect(await similarReports(ID)).toEqual([])
  })
})

describe('searchByMeaning', () => {
  it('is null while the model is not available', async () => {
    loadModel.mockResolvedValue(null)
    expect(await searchByMeaning('ships attacked in the Gulf')).toBeNull()
  })

  it('is empty when no word of the question is known', async () => {
    loadModel.mockResolvedValue(tinyModel())
    expect(await searchByMeaning('zzzz')).toEqual([])
    expect(trxRaw).not.toHaveBeenCalled()
  })

  it('searches with the question\'s fingerprint, and filters by category', async () => {
    loadModel.mockResolvedValue(tinyModel())
    trxRaw.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ rows: [{ id: 'x', score: 0.5 }] })
    const res = await searchByMeaning('ship', { limit: 7, category: 'conflict' })
    expect(res).toEqual([{ id: 'x', score: 0.5 }])
    const [sql, args] = trxRaw.mock.calls[1] as [string, unknown[]]
    expect(sql).toMatch(/s\.category = \?/)
    expect(String(args[0]).startsWith('[1.000000,0.000000,')).toBe(true)
    expect(args.slice(-2)).toEqual(['conflict', 7])
  })
})
