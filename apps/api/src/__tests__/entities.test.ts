/**
 * OpenSanctions Entity Search — unit tests
 *
 * Tests cover:
 *  1. datasetLabel() — human-readable label lookup (known + unknown IDs)
 *  2. schemaLabel() — entity type display name mapping
 *  3. entityThreatLevel() — threat classification by dataset membership
 *  4. searchEntities() — API fetch with Redis cache hit/miss
 *  5. GET /api/v1/search/entities — route validation (query length, limit clamp)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { datasetLabel, entityThreatLevel } from '../lib/opensanctions'

// ─── Mock Redis ──────────────────────────────────────────────────────────────
vi.mock('../db/redis', () => ({
  redis: {
    get:   vi.fn(),
    // setex returns a promise, as ioredis's does (searchEntities calls .catch on it)
    setex: vi.fn(() => Promise.resolve('OK')),
  },
}))

// ─── Mock fetch ──────────────────────────────────────────────────────────────
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ─── 1. datasetLabel() ───────────────────────────────────────────────────────
describe('datasetLabel()', () => {
  it('returns "OFAC SDN" for us_ofac_sdn', () => {
    expect(datasetLabel('us_ofac_sdn')).toBe('OFAC SDN')
  })

  it('returns "EU Financial Sanctions" for eu_fsf', () => {
    expect(datasetLabel('eu_fsf')).toBe('EU Financial Sanctions')
  })

  it('returns "UN Security Council" for un_sc_sanctions', () => {
    expect(datasetLabel('un_sc_sanctions')).toBe('UN Security Council')
  })

  it('returns "Interpol Red Notices" for interpol_red_notices', () => {
    expect(datasetLabel('interpol_red_notices')).toBe('Interpol Red Notices')
  })

  it('returns "UK HM Treasury" for gb_hmt_sanctions', () => {
    expect(datasetLabel('gb_hmt_sanctions')).toBe('UK HM Treasury')
  })

  it('title-cases unknown dataset IDs', () => {
    // "some_unknown_list" → "Some Unknown List"
    const result = datasetLabel('some_unknown_list')
    expect(result).toBe('Some Unknown List')
  })

  it('handles single-segment dataset IDs', () => {
    const result = datasetLabel('interpol')
    expect(result).toBe('Interpol')
  })
})

// ─── 2. entityThreatLevel() ──────────────────────────────────────────────────
describe('entityThreatLevel()', () => {
  it('returns "critical" when OFAC SDN list present', () => {
    expect(entityThreatLevel(['us_ofac_sdn'])).toBe('critical')
  })

  it('returns "critical" when UN Security Council list present', () => {
    expect(entityThreatLevel(['un_sc_sanctions', 'some_other'])).toBe('critical')
  })

  it('returns "critical" when Interpol Red Notices list present', () => {
    expect(entityThreatLevel(['interpol_red_notices'])).toBe('critical')
  })

  it('returns "critical" when EU FSF list present', () => {
    expect(entityThreatLevel(['eu_fsf'])).toBe('critical')
  })

  it('returns "high" for UK HM Treasury (non-critical)', () => {
    expect(entityThreatLevel(['gb_hmt_sanctions'])).toBe('high')
  })

  it('returns "high" for US BIS Entity List', () => {
    expect(entityThreatLevel(['us_bis_entity'])).toBe('high')
  })

  it('returns "high" for World Bank Debarment', () => {
    expect(entityThreatLevel(['worldbank_debarment'])).toBe('high')
  })

  it('returns "medium" when entity appears on 2 non-critical lists', () => {
    expect(entityThreatLevel(['some_list_a', 'some_list_b'])).toBe('medium')
  })

  it('returns "low" for single unknown list', () => {
    expect(entityThreatLevel(['obscure_regional_list'])).toBe('low')
  })

  it('returns "low" for empty datasets array', () => {
    expect(entityThreatLevel([])).toBe('low')
  })

  it('critical takes precedence over high when both present', () => {
    expect(entityThreatLevel(['us_ofac_sdn', 'gb_hmt_sanctions'])).toBe('critical')
  })
})

// ─── 3. searchEntities() — cache hit ─────────────────────────────────────────
describe('searchEntities() — Redis cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns cached result without calling fetch when cache hit', async () => {
    const { redis } = await import('../db/redis')
    const cachedPayload = {
      entities: [
        { id: 'Q1', caption: 'Test Person', schema: 'Person', datasets: ['us_ofac_sdn'], score: 0.99, properties: {} },
      ],
      total: 1,
    }
    vi.mocked(redis.get).mockResolvedValueOnce(JSON.stringify(cachedPayload))

    const { searchEntities } = await import('../lib/opensanctions')
    const result = await searchEntities('Test Person')

    expect(result.entities).toHaveLength(1)
    expect(result.entities[0]?.caption).toBe('Test Person')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('calls OpenSanctions API on cache miss and caches result', async () => {
    const { redis } = await import('../db/redis')
    vi.mocked(redis.get).mockResolvedValueOnce(null) // cache miss

    const mockResponse = {
      results: [
        { id: 'Q2', caption: 'Acme Corp', schema: 'Company', datasets: ['eu_fsf'], score: 0.87, properties: {} },
      ],
      total: 1,
      limit: 10,
      offset: 0,
    }

    mockFetch.mockResolvedValueOnce({
      ok:   true,
      json: async () => mockResponse,
    })

    const { searchEntities } = await import('../lib/opensanctions')
    const result = await searchEntities('Acme Corp')

    expect(mockFetch).toHaveBeenCalledOnce()
    expect(result.entities).toHaveLength(1)
    expect(result.entities[0]?.caption).toBe('Acme Corp')
    // Ensure result was cached
    expect(redis.setex).toHaveBeenCalledOnce()
  })

  it('handles total as nested object { value, relation }', async () => {
    const { redis } = await import('../db/redis')
    vi.mocked(redis.get).mockResolvedValueOnce(null)

    const mockResponse = {
      results: [],
      total:   { value: 42, relation: 'gte' },
      limit:   10,
      offset:  0,
    }

    mockFetch.mockResolvedValueOnce({
      ok:   true,
      json: async () => mockResponse,
    })

    const { searchEntities } = await import('../lib/opensanctions')
    const result = await searchEntities('nobody')

    expect(result.total).toBe(42)
  })

  it('throws on non-OK HTTP response', async () => {
    const { redis } = await import('../db/redis')
    vi.mocked(redis.get).mockResolvedValueOnce(null)

    mockFetch.mockResolvedValueOnce({
      ok:         false,
      status:     502,
      statusText: 'Bad Gateway',
    })

    const { searchEntities } = await import('../lib/opensanctions')
    await expect(searchEntities('fail query')).rejects.toThrow('OpenSanctions API error: 502 Bad Gateway')
  })

  it('clamps limit to max 20', async () => {
    const { redis } = await import('../db/redis')
    vi.mocked(redis.get).mockResolvedValueOnce(null)

    mockFetch.mockResolvedValueOnce({
      ok:   true,
      json: async () => ({ results: [], total: 0, limit: 20, offset: 0 }),
    })

    const { searchEntities } = await import('../lib/opensanctions')
    await searchEntities('test', 100) // request 100, should cap at 20

    const callUrl = mockFetch.mock.calls[0]?.[0] as string
    expect(callUrl).toContain('limit=20')
  })
})

// ─── 6. The key, and a pause after OpenSanctions refuses us (plan P16, Oct 20, 2026) ───
describe('searchEntities(): the key and the refusal pause', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { resetSanctionsRefusal } = await import('../lib/opensanctions')
    resetSanctionsRefusal()
    delete process.env['OPENSANCTIONS_API_KEY']
  })

  it('sends OPENSANCTIONS_API_KEY as "Authorization: ApiKey <key>", and nothing without one', async () => {
    const { redis } = await import('../db/redis')
    const { searchEntities } = await import('../lib/opensanctions')
    const ok = { ok: true, json: async () => ({ results: [], total: 0, limit: 10, offset: 0 }) }

    vi.mocked(redis.get).mockResolvedValue(null)
    mockFetch.mockResolvedValueOnce(ok)
    await searchEntities('no key')
    const plain = (mockFetch.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers
    expect(plain['Authorization']).toBeUndefined()

    process.env['OPENSANCTIONS_API_KEY'] = '  test-key-123  '
    mockFetch.mockResolvedValueOnce(ok)
    await searchEntities('with key')
    const keyed = (mockFetch.mock.calls[1]?.[1] as { headers: Record<string, string> }).headers
    expect(keyed['Authorization']).toBe('ApiKey test-key-123')
  })

  it('after a 401 no call goes out for 10 minutes: the same error comes back at once', async () => {
    const { redis } = await import('../db/redis')
    const { searchEntities, sanctionsSearchRefused, REFUSED_PAUSE_MS } = await import('../lib/opensanctions')
    vi.mocked(redis.get).mockResolvedValue(null)
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' })

    await expect(searchEntities('first')).rejects.toThrow('OpenSanctions API error: 401 Unauthorized')
    expect(sanctionsSearchRefused()).toBe(true)
    await expect(searchEntities('second')).rejects.toThrow('OpenSanctions API error: 401 Unauthorized')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(REFUSED_PAUSE_MS).toBe(10 * 60 * 1000)
    expect(sanctionsSearchRefused(Date.now() + REFUSED_PAUSE_MS + 1)).toBe(false)
  })

  it('other failures (a 502) don\'t pause: the next call asks again', async () => {
    const { redis } = await import('../db/redis')
    const { searchEntities, sanctionsSearchRefused } = await import('../lib/opensanctions')
    vi.mocked(redis.get).mockResolvedValue(null)
    mockFetch.mockResolvedValueOnce({ ok: false, status: 502, statusText: 'Bad Gateway' })
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [], total: 0, limit: 10, offset: 0 }) })

    await expect(searchEntities('a')).rejects.toThrow('502')
    expect(sanctionsSearchRefused()).toBe(false)
    await expect(searchEntities('b')).resolves.toEqual({ entities: [], total: 0 })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})

// ─── 7. /sanctions/featured says when its list is the fixed fallback ─────────
describe('isLiveList()', () => {
  it('is false for the fixed fallback list (ids wp-seed-…) and for an empty list', async () => {
    const { isLiveList } = await import('../routes/sanctions')
    const { FEATURED_SEED } = await import('../lib/sanctions-seed')
    expect(isLiveList(FEATURED_SEED)).toBe(false)
    expect(isLiveList([])).toBe(false)
    expect(isLiveList([{ id: 'Q7747' }, { id: 'NK-abc' }])).toBe(true)
  })
})
