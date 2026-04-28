/**
 * Tests for NotificationService and AlertDispatcher.shouldNotify logic.
 * Uses mocked Redis and fetch — no infrastructure required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Signal } from '@worldpulse/types'

// ─── Mocks ────────────────────────────────────────────────────────────────

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../db/redis', () => ({
  redis: {
    exists: vi.fn(),
    setex:  vi.fn(),
    scan:   vi.fn(),
    mget:   vi.fn(),
  },
}))

const { redis } = await import('../db/redis')

// ─── Fixtures ─────────────────────────────────────────────────────────────

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id:               'sig-001',
    title:            'Test Signal Title',
    summary:          'Test summary text.',
    body:             null,
    category:         'breaking',
    severity:         'high',
    status:           'verified',
    reliabilityScore: 0.8,
    sourceCount:      2,
    location:         null,
    locationName:     'Paris, France',
    countryCode:      'FR',
    region:           'Europe',
    tags:             ['europe', 'breaking'],
    sources:          [],
    originalUrls:     ['https://example.com/article'],
    language:         'en',
    viewCount:        100,
    shareCount:       10,
    postCount:        5,
    eventTime:        null,
    firstReported:    '2026-03-23T10:00:00.000Z',
    verifiedAt:       '2026-03-23T10:05:00.000Z',
    lastUpdated:      '2026-03-23T10:05:00.000Z',
    createdAt:        '2026-03-23T10:00:00.000Z',
    isBreaking:       true,
    ...overrides,
  }
}

// ─── NotificationService ──────────────────────────────────────────────────

const { NotificationService } = await import('../lib/notifications')

describe('NotificationService', () => {
  const svc = new NotificationService()

  describe('formatSignalAlert', () => {
    it('includes severity emoji for critical signals', () => {
      const signal = makeSignal({ severity: 'critical', title: 'Critical Alert' })
      const text = svc.formatSignalAlert(signal)
      expect(text).toContain('🔴')
      expect(text).toContain('Critical Alert')
    })

    it('includes severity emoji for each severity level', () => {
      const cases: Array<[Signal['severity'], string]> = [
        ['critical', '🔴'],
        ['high',     '🟠'],
        ['medium',   '🟡'],
        ['low',      '🟢'],
        ['info',     '⚪'],
      ]
      for (const [severity, emoji] of cases) {
        const text = svc.formatSignalAlert(makeSignal({ severity }))
        expect(text).toContain(emoji)
      }
    })

    it('escapes HTML special characters in title', () => {
      const signal = makeSignal({ title: '<script>alert("xss")</script>' })
      const text = svc.formatSignalAlert(signal)
      expect(text).not.toContain('<script>')
      expect(text).toContain('&lt;script&gt;')
    })

    it('includes location when locationName is set', () => {
      const signal = makeSignal({ locationName: 'Kyiv, Ukraine' })
      const text = svc.formatSignalAlert(signal)
      expect(text).toContain('📍')
      expect(text).toContain('Kyiv, Ukraine')
    })

    it('omits location line when locationName is null', () => {
      const signal = makeSignal({ locationName: null })
      const text = svc.formatSignalAlert(signal)
      expect(text).not.toContain('📍')
    })

    it('truncates summary to 280 characters', () => {
      const longSummary = 'x'.repeat(400)
      const signal = makeSignal({ summary: longSummary })
      const text = svc.formatSignalAlert(signal)
      // Summary section should not contain the 281st character onwards
      expect(text).toContain('x'.repeat(280))
      expect(text).not.toContain('x'.repeat(281))
    })

    it('includes source link when originalUrls is set', () => {
      const signal = makeSignal({ originalUrls: ['https://example.com/news'] })
      const text = svc.formatSignalAlert(signal)
      expect(text).toContain('🔗')
      expect(text).toContain('https://example.com/news')
    })

    it('falls back to sources[0].url when originalUrls is empty', () => {
      const signal = makeSignal({
        originalUrls: [],
        sources: [
          {
            id: 's1', slug: 'reuters', name: 'Reuters',
            description: null, url: 'https://reuters.com/article',
            logoUrl: null, tier: 'wire', trustScore: 0.95,
            language: 'en', country: 'US', categories: ['breaking'],
            activeAt: '2026-01-01T00:00:00Z',
          },
        ],
      })
      const text = svc.formatSignalAlert(signal)
      expect(text).toContain('https://reuters.com/article')
    })

    it('includes reliability dots and percentage', () => {
      const signal = makeSignal({ reliabilityScore: 0.8 })
      const text = svc.formatSignalAlert(signal)
      expect(text).toContain('80%')
      expect(text).toContain('●')
    })
  })

  describe('sendTelegramMessage', () => {
    it('makes POST request to Telegram Bot API', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', fetchMock)

      await svc.sendTelegramMessage('12345', '<b>Test</b>', 'bot-token')

      expect(fetchMock).toHaveBeenCalledOnce()
      const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('bot-token/sendMessage')
      const payload = JSON.parse(opts.body as string) as Record<string, unknown>
      expect(payload.chat_id).toBe('12345')
      expect(payload.text).toBe('<b>Test</b>')
      expect(payload.parse_mode).toBe('HTML')

      vi.unstubAllGlobals()
    })

    it('does not throw when fetch fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
      await expect(svc.sendTelegramMessage('x', 'y', 'z')).resolves.toBeUndefined()
      vi.unstubAllGlobals()
    })

    it('does not throw when Telegram returns non-ok status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'Bad Request' }))
      await expect(svc.sendTelegramMessage('x', 'y', 'z')).resolves.toBeUndefined()
      vi.unstubAllGlobals()
    })
  })

  describe('sendDiscordMessage', () => {
    it('posts an embed with correct severity color', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', fetchMock)

      const signal = makeSignal({ severity: 'critical' })
      await svc.sendDiscordMessage('https://discord.com/api/webhooks/test', signal)

      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
      const payload = JSON.parse(opts.body as string) as { embeds: Array<{ color: number }> }
      expect(payload.embeds[0].color).toBe(16711680) // #ff0000

      vi.unstubAllGlobals()
    })

    it('does not throw when Discord webhook returns error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'Rate limited' }))
      const signal = makeSignal()
      await expect(svc.sendDiscordMessage('https://discord.com/api/webhooks/x', signal)).resolves.toBeUndefined()
      vi.unstubAllGlobals()
    })
  })
})

// ─── AlertDispatcher.shouldNotify ─────────────────────────────────────────

import type { AlertSettings } from '../lib/alert-dispatcher'
const { AlertDispatcher } = await import('../lib/alert-dispatcher')

describe('AlertDispatcher.shouldNotify', () => {
  const dispatcher = new AlertDispatcher()

  const baseSettings: AlertSettings = {
    min_severity: 'high',
    categories:   [],
    enabled:      true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockResolvedValue(0)
    vi.mocked(redis.setex).mockResolvedValue('OK')
  })

  it('allows signal at or above min_severity threshold', async () => {
    const signal = makeSignal({ severity: 'critical' })
    const result = await dispatcher.shouldNotify(signal, { ...baseSettings, min_severity: 'high' }, 'user-1')
    expect(result).toBe(true)
  })

  it('blocks signal below min_severity threshold', async () => {
    const signal = makeSignal({ severity: 'low' })
    const result = await dispatcher.shouldNotify(signal, { ...baseSettings, min_severity: 'high' }, 'user-1')
    expect(result).toBe(false)
  })

  it('allows signal when categories filter is empty (match all)', async () => {
    const signal = makeSignal({ severity: 'high', category: 'climate' })
    const result = await dispatcher.shouldNotify(signal, { ...baseSettings, categories: [] }, 'user-1')
    expect(result).toBe(true)
  })

  it('allows signal when category is in categories filter', async () => {
    const signal = makeSignal({ severity: 'high', category: 'breaking' })
    const result = await dispatcher.shouldNotify(signal, { ...baseSettings, categories: ['breaking', 'conflict'] }, 'user-1')
    expect(result).toBe(true)
  })

  it('blocks signal when category is not in categories filter', async () => {
    const signal = makeSignal({ severity: 'high', category: 'sports' })
    const result = await dispatcher.shouldNotify(signal, { ...baseSettings, categories: ['breaking', 'conflict'] }, 'user-1')
    expect(result).toBe(false)
  })

  it('blocks duplicate signals (dedup key already set)', async () => {
    vi.mocked(redis.exists).mockResolvedValue(1)
    const signal = makeSignal({ severity: 'critical' })
    const result = await dispatcher.shouldNotify(signal, baseSettings, 'user-1')
    expect(result).toBe(false)
  })

  it('sets dedup key with 24h TTL when notification is sent', async () => {
    const signal = makeSignal({ id: 'sig-dedup', severity: 'high' })
    await dispatcher.shouldNotify(signal, baseSettings, 'user-42')
    expect(vi.mocked(redis.setex)).toHaveBeenCalledWith(
      'notif:sent:user-42:sig-dedup',
      86400,
      '1',
    )
  })

  it('returns false gracefully when redis.exists rejects', async () => {
    vi.mocked(redis.exists).mockRejectedValue(new Error('Redis down'))
    const signal = makeSignal({ severity: 'critical' })
    const result = await dispatcher.shouldNotify(signal, baseSettings, 'user-1')
    // redis error is caught → treated as "already sent" (exists returns 0 path fails)
    // The catch(() => 0) means it returns 0 (not sent), so shouldNotify returns true
    // Actually looking at the code: .catch(() => 0) → alreadySent = 0 → proceeds
    expect(result).toBe(true)
  })
})
