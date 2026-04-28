/**
 * alert-dispatcher.test.ts — Unit tests for AlertDispatcher
 *
 * Covers shouldNotify(), dispatchAlerts() channel routing,
 * dispatchDbSubscriptionAlerts() email dispatch, and deduplication.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Signal, SignalSeverity } from '@worldpulse/types'

// ─── Mock dependencies ────────────────────────────────────────────────────────

const redisMock = {
  exists:    vi.fn().mockResolvedValue(0),
  setex:     vi.fn().mockResolvedValue('OK'),
  scan:      vi.fn().mockResolvedValue(['0', []]),
  mget:      vi.fn().mockResolvedValue([]),
  duplicate: vi.fn().mockReturnValue({ subscribe: vi.fn(), on: vi.fn() }),
}

const dbMock = vi.fn().mockReturnValue({
  where:       vi.fn().mockReturnThis(),
  whereRaw:    vi.fn().mockReturnThis(),
  whereNotNull: vi.fn().mockReturnThis(),
  join:        vi.fn().mockReturnThis(),
  select:      vi.fn().mockResolvedValue([]),
})

const loggerMock = {
  debug: vi.fn(),
  info:  vi.fn(),
  warn:  vi.fn(),
  error: vi.fn(),
}

const sendAlertEmailMock = vi.fn().mockResolvedValue(undefined)

const notificationServiceMock = {
  formatSignalAlert:          vi.fn().mockReturnValue('text'),
  formatTieredTelegramAlert:  vi.fn().mockReturnValue('tiered-text'),
  sendTelegramMessage:        vi.fn().mockResolvedValue(undefined),
  sendDiscordMessage:         vi.fn().mockResolvedValue(undefined),
  sendTieredDiscordMessage:   vi.fn().mockResolvedValue(undefined),
  sendSlackMessage:           vi.fn().mockResolvedValue(undefined),
  sendTieredSlackMessage:     vi.fn().mockResolvedValue(undefined),
  sendTeamsMessage:           vi.fn().mockResolvedValue(undefined),
  sendTieredTeamsMessage:     vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../db/redis',           () => ({ redis: redisMock }))
vi.mock('../../db/postgres',        () => ({ db: dbMock }))
vi.mock('../logger',                () => ({ logger: loggerMock }))
vi.mock('../email',                 () => ({ sendAlertEmail: sendAlertEmailMock }))
vi.mock('../notifications',         () => ({ notificationService: notificationServiceMock }))
vi.mock('../alert-tier',            () => ({
  parseAlertTier: vi.fn().mockReturnValue('ROUTINE'),
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id:               'sig-001',
    title:            'Flooding in Jakarta',
    summary:          'Severe monsoon flooding.',
    body:             '',
    category:         'climate',
    severity:         'high',
    status:           'verified',
    reliabilityScore: 0.78,
    alertTier:        'ROUTINE',
    sourceCount:      2,
    location:         null,
    locationName:     'Jakarta, Indonesia',
    countryCode:      'ID',
    region:           null,
    tags:             [],
    sources:          [],
    originalUrls:     [],
    language:         'en',
    viewCount:        0,
    shareCount:       0,
    postCount:        0,
    eventTime:        null,
    firstReported:    '2026-03-30T08:00:00.000Z',
    verifiedAt:       null,
    lastUpdated:      '2026-03-30T08:00:00.000Z',
    lastCorroboratedAt: null,
    createdAt:          '2026-03-30T08:00:00.000Z',
    ...overrides,
  }
}

type AlertSettings = {
  telegram_chat_id?:      string
  telegram_bot_token?:    string
  discord_webhook_url?:   string
  slack_webhook_url?:     string
  ms_teams_webhook_url?:  string
  email_address?:         string
  min_severity:           SignalSeverity
  categories:             string[]
  enabled:                boolean
}

function makeSettings(overrides: Partial<AlertSettings> = {}): AlertSettings {
  return {
    min_severity: 'low',
    categories:   [],
    enabled:      true,
    ...overrides,
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AlertDispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisMock.exists.mockResolvedValue(0)
    redisMock.setex.mockResolvedValue('OK')
    redisMock.scan.mockResolvedValue(['0', []])
  })

  // ─── shouldNotify ─────────────────────────────────────────────────────────

  describe('shouldNotify', () => {
    it('returns false when signal severity is below settings.min_severity', async () => {
      const { alertDispatcher } = await import('../alert-dispatcher')
      const signal = makeSignal({ severity: 'low' })
      const settings = makeSettings({ min_severity: 'high' })
      const result = await alertDispatcher.shouldNotify(signal, settings, 'user-1')
      expect(result).toBe(false)
    })

    it('returns true when signal severity meets the minimum threshold', async () => {
      const { alertDispatcher } = await import('../alert-dispatcher')
      const signal = makeSignal({ severity: 'critical' })
      const settings = makeSettings({ min_severity: 'high' })
      const result = await alertDispatcher.shouldNotify(signal, settings, 'user-2')
      expect(result).toBe(true)
    })

    it('returns false when categories filter excludes signal category', async () => {
      const { alertDispatcher } = await import('../alert-dispatcher')
      const signal = makeSignal({ category: 'climate' })
      const settings = makeSettings({ categories: ['conflict', 'health'] })
      const result = await alertDispatcher.shouldNotify(signal, settings, 'user-3')
      expect(result).toBe(false)
    })

    it('returns true when categories is empty (all categories allowed)', async () => {
      const { alertDispatcher } = await import('../alert-dispatcher')
      const signal = makeSignal({ category: 'climate' })
      const settings = makeSettings({ categories: [] })
      const result = await alertDispatcher.shouldNotify(signal, settings, 'user-4')
      expect(result).toBe(true)
    })

    it('returns false when Redis dedup key already exists (already sent)', async () => {
      redisMock.exists.mockResolvedValue(1)
      const { alertDispatcher } = await import('../alert-dispatcher')
      const signal = makeSignal()
      const settings = makeSettings()
      const result = await alertDispatcher.shouldNotify(signal, settings, 'user-5')
      expect(result).toBe(false)
    })

    it('sets Redis dedup key with TTL on first notification', async () => {
      redisMock.exists.mockResolvedValue(0)
      const { alertDispatcher } = await import('../alert-dispatcher')
      const signal = makeSignal({ id: 'sig-dedup-test' })
      const settings = makeSettings()
      await alertDispatcher.shouldNotify(signal, settings, 'user-6')
      expect(redisMock.setex).toHaveBeenCalledWith(
        expect.stringContaining('user-6'),
        expect.any(Number),
        '1',
      )
    })
  })

  // ─── dispatchAlerts — channel routing ────────────────────────────────────

  describe('dispatchAlerts channel routing', () => {
    it('does nothing when signals array is empty', async () => {
      redisMock.scan.mockResolvedValue(['0', ['notif:user-1:settings']])
      redisMock.mget.mockResolvedValue([JSON.stringify({
        enabled: true, min_severity: 'low', categories: [],
        telegram_chat_id: 'chat-1', telegram_bot_token: 'bot-1',
      })])

      const { alertDispatcher } = await import('../alert-dispatcher')
      await alertDispatcher.dispatchAlerts([])

      expect(notificationServiceMock.sendTelegramMessage).not.toHaveBeenCalled()
    })

    it('sends Telegram message when telegram_chat_id and bot_token are set', async () => {
      redisMock.scan.mockResolvedValue(['0', ['notif:user-tg:settings']])
      redisMock.mget.mockResolvedValue([JSON.stringify({
        enabled:            true,
        min_severity:       'low',
        categories:         [],
        telegram_chat_id:   'chat-tg',
        telegram_bot_token: 'bot-tg',
      })])

      const { alertDispatcher } = await import('../alert-dispatcher')
      await alertDispatcher.dispatchAlerts([makeSignal()])

      expect(notificationServiceMock.sendTelegramMessage).toHaveBeenCalledWith(
        'chat-tg',
        expect.any(String),
        'bot-tg',
      )
    })

    it('sends Discord message when discord_webhook_url is set', async () => {
      redisMock.scan.mockResolvedValue(['0', ['notif:user-dc:settings']])
      redisMock.mget.mockResolvedValue([JSON.stringify({
        enabled:              true,
        min_severity:         'low',
        categories:           [],
        discord_webhook_url:  'https://discord.com/api/webhooks/test',
      })])

      const { alertDispatcher } = await import('../alert-dispatcher')
      await alertDispatcher.dispatchAlerts([makeSignal()])

      expect(notificationServiceMock.sendDiscordMessage).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/test',
        expect.objectContaining({ id: 'sig-001' }),
      )
    })

    it('sends Slack message when slack_webhook_url is set', async () => {
      redisMock.scan.mockResolvedValue(['0', ['notif:user-sl:settings']])
      redisMock.mget.mockResolvedValue([JSON.stringify({
        enabled:            true,
        min_severity:       'low',
        categories:         [],
        slack_webhook_url:  'https://hooks.slack.com/services/test',
      })])

      const { alertDispatcher } = await import('../alert-dispatcher')
      await alertDispatcher.dispatchAlerts([makeSignal()])

      expect(notificationServiceMock.sendSlackMessage).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/test',
        expect.objectContaining({ id: 'sig-001' }),
      )
    })

    it('sends email via sendAlertEmail when email_address is set', async () => {
      redisMock.scan.mockResolvedValue(['0', ['notif:user-em:settings']])
      redisMock.mget.mockResolvedValue([JSON.stringify({
        enabled:       true,
        min_severity:  'low',
        categories:    [],
        email_address: 'analyst@worldpulse.com',
      })])

      const { alertDispatcher } = await import('../alert-dispatcher')
      await alertDispatcher.dispatchAlerts([makeSignal()])

      expect(sendAlertEmailMock).toHaveBeenCalledWith(
        'analyst@worldpulse.com',
        expect.objectContaining({ id: 'sig-001' }),
      )
    })

    it('does NOT send email when email_address is absent in settings', async () => {
      redisMock.scan.mockResolvedValue(['0', ['notif:user-no-em:settings']])
      redisMock.mget.mockResolvedValue([JSON.stringify({
        enabled:      true,
        min_severity: 'low',
        categories:   [],
        // no email_address
      })])

      const { alertDispatcher } = await import('../alert-dispatcher')
      await alertDispatcher.dispatchAlerts([makeSignal()])

      expect(sendAlertEmailMock).not.toHaveBeenCalled()
    })

    it('skips signal dispatch when shouldNotify returns false (severity below threshold)', async () => {
      redisMock.scan.mockResolvedValue(['0', ['notif:user-skip:settings']])
      redisMock.mget.mockResolvedValue([JSON.stringify({
        enabled:            true,
        min_severity:       'critical',
        categories:         [],
        email_address:      'analyst@wp.com',
      })])

      const { alertDispatcher } = await import('../alert-dispatcher')
      // Signal is 'low' severity, threshold is 'critical'
      await alertDispatcher.dispatchAlerts([makeSignal({ severity: 'low' })])

      expect(sendAlertEmailMock).not.toHaveBeenCalled()
    })

    it('does nothing when no users have alert settings configured', async () => {
      redisMock.scan.mockResolvedValue(['0', []])
      redisMock.mget.mockResolvedValue([])

      const { alertDispatcher } = await import('../alert-dispatcher')
      await alertDispatcher.dispatchAlerts([makeSignal()])

      expect(sendAlertEmailMock).not.toHaveBeenCalled()
      expect(notificationServiceMock.sendTelegramMessage).not.toHaveBeenCalled()
    })
  })

  // ─── dispatchDbSubscriptionAlerts ────────────────────────────────────────

  describe('dispatchDbSubscriptionAlerts', () => {
    it('sends email to matching DB subscription with email channel enabled', async () => {
      const dbChain = {
        join:         vi.fn().mockReturnThis(),
        where:        vi.fn().mockReturnThis(),
        whereRaw:     vi.fn().mockReturnThis(),
        whereNotNull: vi.fn().mockReturnThis(),
        select:       vi.fn().mockResolvedValue([{
          sub_id:       'sub-001',
          user_id:      'user-001',
          keywords:     [],
          categories:   [],
          countries:    [],
          min_severity: 'low' as SignalSeverity,
          email:        'analyst@worldpulse.com',
          display_name: 'Test Analyst',
        }]),
      }
      dbMock.mockReturnValue(dbChain)

      const { alertDispatcher } = await import('../alert-dispatcher')
      await alertDispatcher.dispatchDbSubscriptionAlerts([makeSignal({ severity: 'high' })])

      expect(sendAlertEmailMock).toHaveBeenCalledWith(
        'analyst@worldpulse.com',
        expect.objectContaining({ id: 'sig-001' }),
      )
    })

    it('does not send email when severity is below subscription minimum', async () => {
      const dbChain = {
        join:         vi.fn().mockReturnThis(),
        where:        vi.fn().mockReturnThis(),
        whereRaw:     vi.fn().mockReturnThis(),
        whereNotNull: vi.fn().mockReturnThis(),
        select:       vi.fn().mockResolvedValue([{
          sub_id:       'sub-002',
          user_id:      'user-002',
          keywords:     [],
          categories:   [],
          countries:    [],
          min_severity: 'critical' as SignalSeverity,
          email:        'analyst@worldpulse.com',
          display_name: null,
        }]),
      }
      dbMock.mockReturnValue(dbChain)

      const { alertDispatcher } = await import('../alert-dispatcher')
      // Signal is 'low', threshold is 'critical' — should be filtered
      await alertDispatcher.dispatchDbSubscriptionAlerts([makeSignal({ severity: 'low' })])

      expect(sendAlertEmailMock).not.toHaveBeenCalled()
    })

    it('deduplicates: does not send email if Redis dedup key already set', async () => {
      redisMock.exists.mockResolvedValue(1) // already sent

      const dbChain = {
        join:         vi.fn().mockReturnThis(),
        where:        vi.fn().mockReturnThis(),
        whereRaw:     vi.fn().mockReturnThis(),
        whereNotNull: vi.fn().mockReturnThis(),
        select:       vi.fn().mockResolvedValue([{
          sub_id:       'sub-003',
          user_id:      'user-003',
          keywords:     [],
          categories:   [],
          countries:    [],
          min_severity: 'low' as SignalSeverity,
          email:        'analyst@worldpulse.com',
          display_name: null,
        }]),
      }
      dbMock.mockReturnValue(dbChain)

      const { alertDispatcher } = await import('../alert-dispatcher')
      await alertDispatcher.dispatchDbSubscriptionAlerts([makeSignal()])

      expect(sendAlertEmailMock).not.toHaveBeenCalled()
    })

    it('no-ops when signals array is empty', async () => {
      const { alertDispatcher } = await import('../alert-dispatcher')
      await alertDispatcher.dispatchDbSubscriptionAlerts([])

      expect(dbMock).not.toHaveBeenCalled()
      expect(sendAlertEmailMock).not.toHaveBeenCalled()
    })
  })
})
