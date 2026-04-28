/**
 * Alert Dispatcher — DB Subscription Email Delivery Tests
 *
 * Tests dispatchDbSubscriptionAlerts() — the function that reads active
 * alert_subscriptions from the database, matches signals against
 * keyword/category/country/severity criteria, and sends emails to
 * users who have channels.email = true.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock setup ─────────────────────────────────────────────────────────────

const mockDbQuery = {
  join:         vi.fn().mockReturnThis(),
  where:        vi.fn().mockReturnThis(),
  whereRaw:     vi.fn().mockReturnThis(),
  whereNotNull: vi.fn().mockReturnThis(),
  select:       vi.fn().mockResolvedValue([]),
}

vi.mock('../db/postgres', () => ({
  db: vi.fn(() => mockDbQuery),
}))

vi.mock('../db/redis', () => ({
  redis: {
    scan:      vi.fn().mockResolvedValue(['0', []]),
    mget:      vi.fn().mockResolvedValue([]),
    exists:    vi.fn().mockResolvedValue(0),
    setex:     vi.fn().mockResolvedValue('OK'),
    duplicate: vi.fn().mockReturnValue({
      subscribe:   vi.fn((_ch: string, cb: (e: Error | null) => void) => cb(null)),
      on:          vi.fn(),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      disconnect:  vi.fn(),
    }),
  },
}))

vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('./notifications', () => ({
  notificationService: {
    formatSignalAlert:         vi.fn().mockReturnValue('text'),
    sendTelegramMessage:       vi.fn().mockResolvedValue(undefined),
    sendDiscordMessage:        vi.fn().mockResolvedValue(undefined),
    sendSlackMessage:          vi.fn().mockResolvedValue(undefined),
    sendTeamsMessage:          vi.fn().mockResolvedValue(undefined),
    formatTieredTelegramAlert: vi.fn().mockReturnValue('text'),
    sendTieredDiscordMessage:  vi.fn().mockResolvedValue(undefined),
    sendTieredSlackMessage:    vi.fn().mockResolvedValue(undefined),
    sendTieredTeamsMessage:    vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('./alert-tier', () => ({
  parseAlertTier: vi.fn().mockReturnValue('ROUTINE'),
}))

vi.mock('./email', () => ({
  sendAlertEmail: vi.fn().mockResolvedValue(undefined),
}))

// ─── Imports (after mocks — vi.mock calls are hoisted) ───────────────────────

import type { Signal } from '@worldpulse/types'
import { alertDispatcher } from '../lib/alert-dispatcher'
import { sendAlertEmail } from '../lib/email'

const mockSendAlertEmail = sendAlertEmail as ReturnType<typeof vi.fn>

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id:               'sig-001',
    title:            'Major earthquake in Japan',
    summary:          'A 7.2 magnitude earthquake has struck near Tokyo',
    body:             '',
    category:         'disaster',
    severity:         'high',
    status:           'verified',
    reliabilityScore: 0.85,
    alertTier:        'PRIORITY',
    sourceCount:      3,
    location:         null,
    locationName:     'Tokyo, Japan',
    countryCode:      'JP',
    region:           'Asia',
    tags:             [],
    sources:          [],
    originalUrls:     ['https://example.com/story'],
    language:         'en',
    viewCount:        0,
    shareCount:       0,
    postCount:        0,
    eventTime:        null,
    firstReported:    '2026-03-27T10:00:00Z',
    verifiedAt:       null,
    lastUpdated:      '2026-03-27T10:00:00Z',
    createdAt:        '2026-03-27T10:00:00Z',
    ...overrides,
  }
}

// ─── Subscription factory ────────────────────────────────────────────────────

function makeSub(overrides: Record<string, unknown> = {}) {
  return {
    sub_id:       'sub-001',
    user_id:      'user-001',
    keywords:     [] as string[],
    categories:   [] as string[],
    countries:    [] as string[],
    min_severity: 'medium' as const,
    email:        'user@example.com',
    display_name: 'Test User',
    ...overrides,
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('dispatchDbSubscriptionAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends email when signal matches subscription with no filters (all signals)', async () => {
    mockDbQuery.select.mockResolvedValueOnce([makeSub()])

    await alertDispatcher.dispatchDbSubscriptionAlerts([makeSignal()])

    expect(mockSendAlertEmail).toHaveBeenCalledOnce()
    expect(mockSendAlertEmail).toHaveBeenCalledWith('user@example.com', expect.objectContaining({ id: 'sig-001' }))
  })

  it('does nothing when no active DB subscriptions exist', async () => {
    mockDbQuery.select.mockResolvedValueOnce([])

    await alertDispatcher.dispatchDbSubscriptionAlerts([makeSignal()])

    expect(mockSendAlertEmail).not.toHaveBeenCalled()
  })

  it('does nothing with empty signal array', async () => {
    await alertDispatcher.dispatchDbSubscriptionAlerts([])

    // DB should not even be queried
    expect(mockDbQuery.select).not.toHaveBeenCalled()
    expect(mockSendAlertEmail).not.toHaveBeenCalled()
  })

  it('filters by category — match', async () => {
    mockDbQuery.select.mockResolvedValueOnce([makeSub({ categories: ['disaster', 'conflict'] })])

    await alertDispatcher.dispatchDbSubscriptionAlerts([makeSignal({ category: 'disaster' })])

    expect(mockSendAlertEmail).toHaveBeenCalledOnce()
  })

  it('filters by category — no match', async () => {
    mockDbQuery.select.mockResolvedValueOnce([makeSub({ categories: ['conflict'] })])

    await alertDispatcher.dispatchDbSubscriptionAlerts([makeSignal({ category: 'health' })])

    expect(mockSendAlertEmail).not.toHaveBeenCalled()
  })

  it('passes through when category list is empty (subscribe to all)', async () => {
    mockDbQuery.select.mockResolvedValueOnce([makeSub({ categories: [] })])

    await alertDispatcher.dispatchDbSubscriptionAlerts([makeSignal({ category: 'technology' })])

    expect(mockSendAlertEmail).toHaveBeenCalledOnce()
  })

  it('filters by country — match', async () => {
    mockDbQuery.select.mockResolvedValueOnce([makeSub({ countries: ['JP', 'US'] })])

    await alertDispatcher.dispatchDbSubscriptionAlerts([makeSignal({ countryCode: 'JP' })])

    expect(mockSendAlertEmail).toHaveBeenCalledOnce()
  })

  it('filters by country — no match', async () => {
    mockDbQuery.select.mockResolvedValueOnce([makeSub({ countries: ['US'] })])

    await alertDispatcher.dispatchDbSubscriptionAlerts([makeSignal({ countryCode: 'JP' })])

    expect(mockSendAlertEmail).not.toHaveBeenCalled()
  })

  it('passes through when country list is empty (subscribe to all)', async () => {
    mockDbQuery.select.mockResolvedValueOnce([makeSub({ countries: [] })])

    await alertDispatcher.dispatchDbSubscriptionAlerts([makeSignal({ countryCode: 'BR' })])

    expect(mockSendAlertEmail).toHaveBeenCalledOnce()
  })

  it('filters by minimum severity — signal below threshold', async () => {
    mockDbQuery.select.mockResolvedValueOnce([makeSub({ min_severity: 'critical' })])

    await alertDispatcher.dispatchDbSubscriptionAlerts([makeSignal({ severity: 'medium' })])

    expect(mockSendAlertEmail).not.toHaveBeenCalled()
  })

  it('filters by minimum severity — signal at threshold', async () => {
    mockDbQuery.select.mockResolvedValueOnce([makeSub({ min_severity: 'high' })])

    await alertDispatcher.dispatchDbSubscriptionAlerts([makeSignal({ severity: 'high' })])

    expect(mockSendAlertEmail).toHaveBeenCalledOnce()
  })

  it('filters by minimum severity — signal above threshold', async () => {
    mockDbQuery.select.mockResolvedValueOnce([makeSub({ min_severity: 'medium' })])

    await alertDispatcher.dispatchDbSubscriptionAlerts([makeSignal({ severity: 'critical' })])

    expect(mockSendAlertEmail).toHaveBeenCalledOnce()
  })

  it('filters by keyword — match in title', async () => {
    mockDbQuery.select.mockResolvedValueOnce([makeSub({ keywords: ['earthquake', 'tsunami'] })])

    await alertDispatcher.dispatchDbSubscriptionAlerts([makeSignal({ title: 'Massive earthquake destroys city' })])

    expect(mockSendAlertEmail).toHaveBeenCalledOnce()
  })

  it('filters by keyword — match in summary', async () => {
    mockDbQuery.select.mockResolvedValueOnce([makeSub({ keywords: ['tokyo'] })])

    await alertDispatcher.dispatchDbSubscriptionAlerts([
      makeSignal({ title: 'Breaking news', summary: 'Explosion reported in Tokyo city centre' }),
    ])

    expect(mockSendAlertEmail).toHaveBeenCalledOnce()
  })

  it('filters by keyword — case insensitive', async () => {
    mockDbQuery.select.mockResolvedValueOnce([makeSub({ keywords: ['EARTHQUAKE'] })])

    await alertDispatcher.dispatchDbSubscriptionAlerts([makeSignal({ title: 'Major earthquake in Japan' })])

    expect(mockSendAlertEmail).toHaveBeenCalledOnce()
  })

  it('filters by keyword — no match', async () => {
    mockDbQuery.select.mockResolvedValueOnce([makeSub({ keywords: ['hurricane', 'typhoon'] })])

    await alertDispatcher.dispatchDbSubscriptionAlerts([makeSignal({ title: 'Market crash hits Wall Street' })])

    expect(mockSendAlertEmail).not.toHaveBeenCalled()
  })

  it('deduplicates — second dispatch for same (user, subscription, signal) is skipped', async () => {
    const { redis } = await import('../db/redis')
    const mockRedis = redis as unknown as {
      exists: ReturnType<typeof vi.fn>
      setex:  ReturnType<typeof vi.fn>
    }

    // First call: not yet sent
    mockRedis.exists.mockResolvedValueOnce(0)
    mockDbQuery.select.mockResolvedValueOnce([makeSub()])
    await alertDispatcher.dispatchDbSubscriptionAlerts([makeSignal()])
    expect(mockSendAlertEmail).toHaveBeenCalledOnce()

    // Second call: already sent
    mockRedis.exists.mockResolvedValueOnce(1)
    mockDbQuery.select.mockResolvedValueOnce([makeSub()])
    await alertDispatcher.dispatchDbSubscriptionAlerts([makeSignal()])
    expect(mockSendAlertEmail).toHaveBeenCalledOnce() // still 1, not 2
  })

  it('sends to multiple users matching the same signal', async () => {
    const subs = [
      makeSub({ sub_id: 'sub-001', user_id: 'user-001', email: 'alice@example.com' }),
      makeSub({ sub_id: 'sub-002', user_id: 'user-002', email: 'bob@example.com' }),
    ]
    mockDbQuery.select.mockResolvedValueOnce(subs)

    await alertDispatcher.dispatchDbSubscriptionAlerts([makeSignal()])

    expect(mockSendAlertEmail).toHaveBeenCalledTimes(2)
    expect(mockSendAlertEmail).toHaveBeenCalledWith('alice@example.com', expect.anything())
    expect(mockSendAlertEmail).toHaveBeenCalledWith('bob@example.com', expect.anything())
  })

  it('handles DB query failure gracefully — no throw', async () => {
    mockDbQuery.select.mockRejectedValueOnce(new Error('DB connection lost'))

    // Should not throw
    await expect(
      alertDispatcher.dispatchDbSubscriptionAlerts([makeSignal()]),
    ).resolves.toBeUndefined()

    expect(mockSendAlertEmail).not.toHaveBeenCalled()
  })

  it('sends to multiple signals for a single subscription', async () => {
    mockDbQuery.select.mockResolvedValueOnce([makeSub()])

    const signals = [
      makeSignal({ id: 'sig-001', title: 'Earthquake in Japan' }),
      makeSignal({ id: 'sig-002', title: 'Flood in Australia' }),
    ]

    await alertDispatcher.dispatchDbSubscriptionAlerts(signals)

    expect(mockSendAlertEmail).toHaveBeenCalledTimes(2)
  })
})
