/**
 * Tests for resilience-config — per-source resilience config store.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Redis mock ───────────────────────────────────────────────────────────────
const redisMock = {
  hgetall: vi.fn(),
  hset:    vi.fn(),
  del:     vi.fn(),
  sadd:    vi.fn(),
  srem:    vi.fn(),
  smembers: vi.fn(),
}

vi.mock('../redis.js', () => ({ redis: redisMock }))

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('resilience-config', () => {
  beforeEach(() => vi.clearAllMocks())

  // ── getResilienceConfig ────────────────────────────────────────────────────
  describe('getResilienceConfig', () => {
    it('returns defaults when no Redis key exists', async () => {
      redisMock.hgetall.mockResolvedValue({})
      const { getResilienceConfig, DEFAULT_RESILIENCE_CONFIG } = await import('../resilience-config.js')
      const cfg = await getResilienceConfig('src-1')
      expect(cfg).toEqual(DEFAULT_RESILIENCE_CONFIG)
    })

    it('returns defaults when Redis returns null', async () => {
      redisMock.hgetall.mockResolvedValue(null)
      const { getResilienceConfig, DEFAULT_RESILIENCE_CONFIG } = await import('../resilience-config.js')
      const cfg = await getResilienceConfig('src-1')
      expect(cfg).toEqual(DEFAULT_RESILIENCE_CONFIG)
    })

    it('parses stored failureThreshold override', async () => {
      redisMock.hgetall.mockResolvedValue({ failure_threshold: '3' })
      const { getResilienceConfig } = await import('../resilience-config.js')
      const cfg = await getResilienceConfig('src-2')
      expect(cfg.failureThreshold).toBe(3)
    })

    it('parses stored baseOpenMs override', async () => {
      redisMock.hgetall.mockResolvedValue({ base_open_ms: '120000' })
      const { getResilienceConfig } = await import('../resilience-config.js')
      const cfg = await getResilienceConfig('src-3')
      expect(cfg.baseOpenMs).toBe(120_000)
    })

    it('parses stored maxOpenMs override', async () => {
      redisMock.hgetall.mockResolvedValue({ max_open_ms: '3600000' })
      const { getResilienceConfig } = await import('../resilience-config.js')
      const cfg = await getResilienceConfig('src-4')
      expect(cfg.maxOpenMs).toBe(3_600_000)
    })

    it('parses stored retryDelays override', async () => {
      redisMock.hgetall.mockResolvedValue({ retry_delays_json: '[500,2000]' })
      const { getResilienceConfig } = await import('../resilience-config.js')
      const cfg = await getResilienceConfig('src-5')
      expect(cfg.retryDelays).toEqual([500, 2000])
    })

    it('falls back to default retryDelays for malformed JSON', async () => {
      redisMock.hgetall.mockResolvedValue({ retry_delays_json: '{bad}' })
      const { getResilienceConfig, DEFAULT_RESILIENCE_CONFIG } = await import('../resilience-config.js')
      const cfg = await getResilienceConfig('src-6')
      expect(cfg.retryDelays).toEqual(DEFAULT_RESILIENCE_CONFIG.retryDelays)
    })

    it('falls back to default retryDelays when array contains non-numbers', async () => {
      redisMock.hgetall.mockResolvedValue({ retry_delays_json: '["a","b"]' })
      const { getResilienceConfig, DEFAULT_RESILIENCE_CONFIG } = await import('../resilience-config.js')
      const cfg = await getResilienceConfig('src-7')
      expect(cfg.retryDelays).toEqual(DEFAULT_RESILIENCE_CONFIG.retryDelays)
    })

    it('returns full override when all fields are set', async () => {
      redisMock.hgetall.mockResolvedValue({
        failure_threshold:  '2',
        base_open_ms:       '30000',
        max_open_ms:        '300000',
        retry_delays_json:  '[0,0]',
      })
      const { getResilienceConfig } = await import('../resilience-config.js')
      const cfg = await getResilienceConfig('src-8')
      expect(cfg).toEqual({
        failureThreshold: 2,
        baseOpenMs:       30_000,
        maxOpenMs:        300_000,
        retryDelays:      [0, 0],
      })
    })
  })

  // ── setResilienceConfig ────────────────────────────────────────────────────
  describe('setResilienceConfig', () => {
    it('writes failure_threshold to Redis', async () => {
      redisMock.hset.mockResolvedValue(1)
      redisMock.sadd.mockResolvedValue(1)
      const { setResilienceConfig } = await import('../resilience-config.js')
      await setResilienceConfig('src-a', { failureThreshold: 3 })
      expect(redisMock.hset).toHaveBeenCalledWith(
        'scraper:rcfg:src-a',
        expect.objectContaining({ failure_threshold: '3' }),
      )
      expect(redisMock.sadd).toHaveBeenCalledWith('scraper:rcfg:index', 'src-a')
    })

    it('writes retry_delays_json to Redis', async () => {
      redisMock.hset.mockResolvedValue(1)
      redisMock.sadd.mockResolvedValue(1)
      const { setResilienceConfig } = await import('../resilience-config.js')
      await setResilienceConfig('src-b', { retryDelays: [500, 2000, 10000] })
      expect(redisMock.hset).toHaveBeenCalledWith(
        'scraper:rcfg:src-b',
        expect.objectContaining({ retry_delays_json: '[500,2000,10000]' }),
      )
    })

    it('writes all fields when all are provided', async () => {
      redisMock.hset.mockResolvedValue(1)
      redisMock.sadd.mockResolvedValue(1)
      const { setResilienceConfig } = await import('../resilience-config.js')
      await setResilienceConfig('src-c', {
        failureThreshold: 2,
        baseOpenMs:       30_000,
        maxOpenMs:        300_000,
        retryDelays:      [0, 0],
      })
      const [, fields] = redisMock.hset.mock.calls[0] as [string, Record<string, string>]
      expect(fields['failure_threshold']).toBe('2')
      expect(fields['base_open_ms']).toBe('30000')
      expect(fields['max_open_ms']).toBe('300000')
      expect(fields['retry_delays_json']).toBe('[0,0]')
    })

    it('does nothing when no fields are provided', async () => {
      const { setResilienceConfig } = await import('../resilience-config.js')
      await setResilienceConfig('src-d', {})
      expect(redisMock.hset).not.toHaveBeenCalled()
    })

    it('throws RangeError for failureThreshold < 1', async () => {
      const { setResilienceConfig } = await import('../resilience-config.js')
      await expect(setResilienceConfig('src-e', { failureThreshold: 0 }))
        .rejects.toBeInstanceOf(RangeError)
    })

    it('throws RangeError for baseOpenMs < 1000', async () => {
      const { setResilienceConfig } = await import('../resilience-config.js')
      await expect(setResilienceConfig('src-f', { baseOpenMs: 500 }))
        .rejects.toBeInstanceOf(RangeError)
    })

    it('throws TypeError for retryDelays containing non-numbers', async () => {
      const { setResilienceConfig } = await import('../resilience-config.js')
      await expect(
        // @ts-expect-error intentionally wrong type for test
        setResilienceConfig('src-g', { retryDelays: ['fast', 'slow'] }),
      ).rejects.toBeInstanceOf(TypeError)
    })
  })

  // ── deleteResilienceConfig ─────────────────────────────────────────────────
  describe('deleteResilienceConfig', () => {
    it('deletes the Redis key and removes from index', async () => {
      redisMock.del.mockResolvedValue(1)
      redisMock.srem.mockResolvedValue(1)
      const { deleteResilienceConfig } = await import('../resilience-config.js')
      await deleteResilienceConfig('src-z')
      expect(redisMock.del).toHaveBeenCalledWith('scraper:rcfg:src-z')
      expect(redisMock.srem).toHaveBeenCalledWith('scraper:rcfg:index', 'src-z')
    })
  })

  // ── listConfiguredSources ──────────────────────────────────────────────────
  describe('listConfiguredSources', () => {
    it('returns all configured source IDs', async () => {
      redisMock.smembers.mockResolvedValue(['src-1', 'src-2', 'src-3'])
      const { listConfiguredSources } = await import('../resilience-config.js')
      const ids = await listConfiguredSources()
      expect(ids).toEqual(['src-1', 'src-2', 'src-3'])
    })

    it('returns empty array when no sources are configured', async () => {
      redisMock.smembers.mockResolvedValue([])
      const { listConfiguredSources } = await import('../resilience-config.js')
      const ids = await listConfiguredSources()
      expect(ids).toEqual([])
    })
  })
})
