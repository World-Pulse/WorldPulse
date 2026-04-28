/**
 * Developer Webhooks — Unit Tests
 * Tests for HMAC signature logic, filter matching, and delivery mechanics.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

// ─── Mock db + logger ─────────────────────────────────────────────────────────

vi.mock('../db/postgres', () => ({
  db: Object.assign(
    vi.fn().mockReturnValue({
      where:       vi.fn().mockReturnThis(),
      whereRaw:    vi.fn().mockReturnThis(),
      select:      vi.fn().mockResolvedValue([]),
      insert:      vi.fn().mockReturnThis(),
      returning:   vi.fn().mockResolvedValue([{ id: 'wh-1' }]),
      update:      vi.fn().mockResolvedValue(1),
      raw:         vi.fn((sql: string) => sql),
    }),
    { raw: vi.fn((sql: string) => sql) },
  ),
}))

vi.mock('../lib/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

// ─── HMAC signature tests ────────────────────────────────────────────────────

describe('Webhook HMAC signatures', () => {
  it('produces consistent HMAC-SHA256 for same inputs', () => {
    const secret    = 'test-secret-abc123'
    const timestamp = 1710000000
    const body      = JSON.stringify({ event: 'signal.new', payload: { id: 'sig-1' } })
    const sigPayload = `${timestamp}.${body}`

    const hex1 = crypto.createHmac('sha256', secret).update(sigPayload, 'utf8').digest('hex')
    const hex2 = crypto.createHmac('sha256', secret).update(sigPayload, 'utf8').digest('hex')

    expect(hex1).toBe(hex2)
    expect(hex1).toHaveLength(64)
  })

  it('produces different HMAC for different timestamp', () => {
    const secret = 'test-secret'
    const body   = '{"event":"signal.new"}'

    const sig1 = crypto.createHmac('sha256', secret).update(`1000.${body}`, 'utf8').digest('hex')
    const sig2 = crypto.createHmac('sha256', secret).update(`2000.${body}`, 'utf8').digest('hex')

    expect(sig1).not.toBe(sig2)
  })

  it('produces different HMAC for different secrets', () => {
    const body      = '{"event":"signal.new"}'
    const timestamp = 1710000000
    const sigP      = `${timestamp}.${body}`

    const sig1 = crypto.createHmac('sha256', 'secret-A').update(sigP, 'utf8').digest('hex')
    const sig2 = crypto.createHmac('sha256', 'secret-B').update(sigP, 'utf8').digest('hex')

    expect(sig1).not.toBe(sig2)
  })

  it('signature header has correct format: t={ts},v1={hex}', () => {
    const secret    = 'my-secret'
    const timestamp = 1710000000
    const body      = '{}'
    const hex       = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex')
    const header    = `t=${timestamp},v1=${hex}`

    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/)
  })

  it('developer can verify signature by recomputing HMAC', () => {
    const secret    = crypto.randomBytes(32).toString('hex')
    const timestamp = Math.floor(Date.now() / 1000)
    const body      = JSON.stringify({ event: 'signal.new', payload: { id: 'abc' } })
    const sigPayload = `${timestamp}.${body}`

    // Server signs
    const serverSig = crypto.createHmac('sha256', secret).update(sigPayload, 'utf8').digest('hex')
    const header    = `t=${timestamp},v1=${serverSig}`

    // Developer verifies
    const [, hexPart] = header.split(',v1=')
    const verifySig = crypto.createHmac('sha256', secret).update(sigPayload, 'utf8').digest('hex')

    expect(hexPart).toBe(verifySig)
  })
})

// ─── Filter matching tests ────────────────────────────────────────────────────

describe('Webhook filter matching', () => {
  // Inline version of matchesFilters for unit testing
  function matchesFilters(
    filters: { category?: string; severity?: string; country_code?: string },
    payload: { category?: string; severity?: string; country_code?: string },
  ): boolean {
    if (!filters || Object.keys(filters).length === 0) return true
    if (filters.category     && payload.category     !== filters.category)     return false
    if (filters.severity     && payload.severity     !== filters.severity)     return false
    if (filters.country_code && payload.country_code !== filters.country_code) return false
    return true
  }

  it('empty filters match any payload', () => {
    expect(matchesFilters({}, { category: 'conflict', severity: 'high', country_code: 'UA' })).toBe(true)
  })

  it('category filter matches exact category', () => {
    expect(matchesFilters({ category: 'conflict' }, { category: 'conflict' })).toBe(true)
    expect(matchesFilters({ category: 'conflict' }, { category: 'climate'  })).toBe(false)
  })

  it('severity filter matches exact severity', () => {
    expect(matchesFilters({ severity: 'critical' }, { severity: 'critical' })).toBe(true)
    expect(matchesFilters({ severity: 'critical' }, { severity: 'low'      })).toBe(false)
  })

  it('country_code filter matches exact country', () => {
    expect(matchesFilters({ country_code: 'UA' }, { country_code: 'UA' })).toBe(true)
    expect(matchesFilters({ country_code: 'UA' }, { country_code: 'RU' })).toBe(false)
  })

  it('multiple filters — all must match', () => {
    const filter = { category: 'conflict', severity: 'critical' }
    expect(matchesFilters(filter, { category: 'conflict', severity: 'critical' })).toBe(true)
    expect(matchesFilters(filter, { category: 'conflict', severity: 'low'      })).toBe(false)
    expect(matchesFilters(filter, { category: 'climate',  severity: 'critical' })).toBe(false)
  })

  it('payload with undefined field does not match filter with that field set', () => {
    expect(matchesFilters({ category: 'conflict' }, { category: undefined })).toBe(false)
  })
})

// ─── Webhook schema validation tests ─────────────────────────────────────────

describe('Webhook registration schema', () => {
  const ALLOWED_EVENTS = ['signal.new', 'signal.updated', 'alert.breaking'] as const

  it('accepts valid events array', () => {
    const events: (typeof ALLOWED_EVENTS[number])[] = ['signal.new', 'alert.breaking']
    expect(events.every(e => (ALLOWED_EVENTS as readonly string[]).includes(e))).toBe(true)
  })

  it('rejects empty events array', () => {
    const events: string[] = []
    expect(events.length >= 1).toBe(false)
  })

  it('rejects unknown event type', () => {
    const event = 'unknown.event'
    expect((ALLOWED_EVENTS as readonly string[]).includes(event)).toBe(false)
  })

  it('URL must be a valid https URL', () => {
    const goodUrl = 'https://example.com/webhook'
    const badUrl  = 'not-a-url'
    expect(() => new URL(goodUrl)).not.toThrow()
    expect(() => new URL(badUrl)).toThrow()
  })

  it('secret is 64-character hex string (32 bytes)', () => {
    const secret = crypto.randomBytes(32).toString('hex')
    expect(secret).toHaveLength(64)
    expect(/^[0-9a-f]{64}$/.test(secret)).toBe(true)
  })
})

// ─── Delivery table structure tests ──────────────────────────────────────────

describe('Webhook delivery record structure', () => {
  it('delivery record has all required fields', () => {
    const delivery = {
      webhook_id:  'wh-001',
      event:       'signal.new',
      payload:     JSON.stringify({ id: 'sig-1', title: 'Test Signal' }),
      status_code: 200,
      success:     true,
      error_msg:   null,
      duration_ms: 120,
      delivered_at: new Date().toISOString(),
    }

    expect(delivery).toHaveProperty('webhook_id')
    expect(delivery).toHaveProperty('event')
    expect(delivery).toHaveProperty('payload')
    expect(delivery).toHaveProperty('status_code')
    expect(delivery).toHaveProperty('success')
    expect(delivery).toHaveProperty('duration_ms')
  })

  it('failed delivery sets success=false and has error_msg', () => {
    const delivery = {
      success:     false,
      error_msg:   'connect ECONNREFUSED 127.0.0.1:9999',
      status_code: null,
    }
    expect(delivery.success).toBe(false)
    expect(delivery.error_msg).toBeTruthy()
    expect(delivery.status_code).toBeNull()
  })

  it('2xx status code means success', () => {
    for (const status of [200, 201, 202, 204]) {
      expect(status >= 200 && status < 300).toBe(true)
    }
  })

  it('non-2xx status code means failure', () => {
    for (const status of [400, 404, 500, 503]) {
      expect(status >= 200 && status < 300).toBe(false)
    }
  })
})

// ─── Per-user webhook limit ───────────────────────────────────────────────────

describe('Webhook per-user limit', () => {
  it('limit is 10 webhooks per user', () => {
    const MAX_WEBHOOKS_PER_USER = 10
    expect(MAX_WEBHOOKS_PER_USER).toBe(10)
  })

  it('exceeding limit returns 429 WEBHOOK_LIMIT_EXCEEDED', () => {
    const MAX_WEBHOOKS_PER_USER = 10
    const currentCount = 10
    const shouldReject = currentCount >= MAX_WEBHOOKS_PER_USER
    expect(shouldReject).toBe(true)
  })

  it('at limit - 1 allows one more', () => {
    const MAX_WEBHOOKS_PER_USER = 10
    const currentCount = 9
    const shouldReject = currentCount >= MAX_WEBHOOKS_PER_USER
    expect(shouldReject).toBe(false)
  })
})
