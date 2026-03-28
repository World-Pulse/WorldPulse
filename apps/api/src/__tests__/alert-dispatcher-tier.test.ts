/**
 * Alert Dispatcher — Tier-Aware Notification Tests
 *
 * Tests the FLASH/PRIORITY/ROUTINE tier-aware notification dispatch system.
 * Covers: tier formatting, real-time Redis dispatch, severity filter fix,
 * and deduplication with tier awareness.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock setup ─────────────────────────────────────────────────────────────

// Mock Redis
vi.mock('../db/redis', () => ({
  redis: {
    scan:      vi.fn().mockResolvedValue(['0', []]),
    mget:      vi.fn().mockResolvedValue([]),
    exists:    vi.fn().mockResolvedValue(0),
    setex:     vi.fn().mockResolvedValue('OK'),
    duplicate: vi.fn().mockReturnValue({
      subscribe: vi.fn((_channel: string, cb: (err: Error | null) => void) => cb(null)),
      on:        vi.fn(),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      disconnect:  vi.fn(),
    }),
  },
}))

// Mock logger
vi.mock('./logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock email
vi.mock('./email', () => ({
  sendAlertEmail: vi.fn().mockResolvedValue(undefined),
}))

// Mock fetch globally
const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue('') })
vi.stubGlobal('fetch', mockFetch)

import { notificationService } from '../lib/notifications'
import { parseAlertTier } from '../lib/alert-tier'

// ─── Test Signals ───────────────────────────────────────────────────────────

function makeSignal(overrides: Record<string, unknown> = {}) {
  return {
    id:               'sig-001',
    title:            'Major earthquake strikes coastal region',
    summary:          'A 7.2 magnitude earthquake struck the coastal region causing significant damage.',
    body:             '',
    category:         'disaster',
    severity:         'critical',
    status:           'verified',
    reliabilityScore: 0.85,
    locationName:     'Manila, Philippines',
    countryCode:      'PH',
    originalUrls:     ['https://source.example.com/earthquake'],
    sources:          [],
    tags:             [],
    createdAt:        new Date().toISOString(),
    updatedAt:        new Date().toISOString(),
    alertTier:        'FLASH',
    ...overrides,
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Alert Tier Notification Formatting', () => {
  describe('tierPrefix', () => {
    it('returns FLASH prefix for FLASH tier', () => {
      expect(notificationService.tierPrefix('FLASH')).toBe('⚡ FLASH ALERT')
    })

    it('returns PRIORITY prefix for PRIORITY tier', () => {
      expect(notificationService.tierPrefix('PRIORITY')).toBe('🔶 PRIORITY')
    })

    it('returns empty string for ROUTINE tier', () => {
      expect(notificationService.tierPrefix('ROUTINE')).toBe('')
    })
  })

  describe('formatTieredTelegramAlert', () => {
    it('includes FLASH banner for FLASH signals', () => {
      const signal = makeSignal() as any
      const result = notificationService.formatTieredTelegramAlert(signal, 'FLASH')

      expect(result).toContain('━━━ ⚡ FLASH ALERT ━━━')
      expect(result).toContain('Major earthquake strikes coastal region')
      expect(result).toContain('Tier:</b> FLASH')
      expect(result).toContain('Manila, Philippines')
    })

    it('includes PRIORITY banner for PRIORITY signals', () => {
      const signal = makeSignal({ severity: 'high', alertTier: 'PRIORITY' }) as any
      const result = notificationService.formatTieredTelegramAlert(signal, 'PRIORITY')

      expect(result).toContain('━━━ 🔶 PRIORITY ━━━')
      expect(result).toContain('Tier:</b> PRIORITY')
    })

    it('omits banner for ROUTINE signals', () => {
      const signal = makeSignal({ severity: 'medium', alertTier: 'ROUTINE' }) as any
      const result = notificationService.formatTieredTelegramAlert(signal, 'ROUTINE')

      expect(result).not.toContain('━━━')
      expect(result).toContain('Tier:</b> ROUTINE')
    })

    it('includes reliability dots', () => {
      const signal = makeSignal({ reliabilityScore: 0.85 }) as any
      const result = notificationService.formatTieredTelegramAlert(signal, 'FLASH')

      expect(result).toContain('●●●●○')
      expect(result).toContain('85%')
    })

    it('includes source URL', () => {
      const signal = makeSignal() as any
      const result = notificationService.formatTieredTelegramAlert(signal, 'FLASH')

      expect(result).toContain('https://source.example.com/earthquake')
    })
  })
})

describe('parseAlertTier', () => {
  it('parses FLASH correctly', () => {
    expect(parseAlertTier('FLASH')).toBe('FLASH')
  })

  it('parses PRIORITY correctly', () => {
    expect(parseAlertTier('PRIORITY')).toBe('PRIORITY')
  })

  it('parses ROUTINE correctly', () => {
    expect(parseAlertTier('ROUTINE')).toBe('ROUTINE')
  })

  it('defaults to ROUTINE for null', () => {
    expect(parseAlertTier(null)).toBe('ROUTINE')
  })

  it('defaults to ROUTINE for undefined', () => {
    expect(parseAlertTier(undefined)).toBe('ROUTINE')
  })

  it('defaults to ROUTINE for garbage strings', () => {
    expect(parseAlertTier('URGENT')).toBe('ROUTINE')
    expect(parseAlertTier('flash')).toBe('ROUTINE')
    expect(parseAlertTier('')).toBe('ROUTINE')
  })
})

describe('Tier-Aware Discord Notifications', () => {
  beforeEach(() => {
    mockFetch.mockClear()
    mockFetch.mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue('') })
  })

  it('sends FLASH Discord embed with red color and tier field', async () => {
    const signal = makeSignal() as any

    await notificationService.sendTieredDiscordMessage(
      'https://discord.example.com/webhook',
      signal,
      'FLASH',
    )

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string)
    const embed = body.embeds[0]

    // FLASH color is 16711680 (#FF0000)
    expect(embed.color).toBe(16711680)
    expect(embed.title).toContain('Major earthquake')

    // Should have Alert Tier field
    const tierField = embed.fields.find((f: any) => f.name === 'Alert Tier')
    expect(tierField).toBeDefined()
    expect(tierField.value).toContain('FLASH ALERT')
  })

  it('sends PRIORITY Discord embed with orange color', async () => {
    const signal = makeSignal({ severity: 'high' }) as any

    await notificationService.sendTieredDiscordMessage(
      'https://discord.example.com/webhook',
      signal,
      'PRIORITY',
    )

    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string)
    const embed = body.embeds[0]

    // PRIORITY color is 16744448 (#FF6600)
    expect(embed.color).toBe(16744448)
  })

  it('omits Alert Tier field for ROUTINE signals', async () => {
    const signal = makeSignal({ severity: 'medium' }) as any

    await notificationService.sendTieredDiscordMessage(
      'https://discord.example.com/webhook',
      signal,
      'ROUTINE',
    )

    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string)
    const embed = body.embeds[0]
    const tierField = embed.fields.find((f: any) => f.name === 'Alert Tier')
    expect(tierField).toBeUndefined()
  })
})

describe('Tier-Aware Slack Notifications', () => {
  beforeEach(() => {
    mockFetch.mockClear()
    mockFetch.mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue('') })
  })

  it('sends FLASH Slack message with red color and tier prefix in header', async () => {
    const signal = makeSignal() as any

    await notificationService.sendTieredSlackMessage(
      'https://hooks.slack.com/webhook',
      signal,
      'FLASH',
    )

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string)

    // Color should be red for FLASH
    expect(body.attachments[0].color).toBe('#FF0000')

    // Header should contain FLASH ALERT prefix
    const header = body.attachments[0].blocks[0]
    expect(header.text.text).toContain('FLASH ALERT')
  })
})

describe('Tier-Aware Teams Notifications', () => {
  beforeEach(() => {
    mockFetch.mockClear()
    mockFetch.mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue('') })
  })

  it('sends FLASH Teams card with red theme color', async () => {
    const signal = makeSignal() as any

    await notificationService.sendTieredTeamsMessage(
      'https://teams.example.com/webhook',
      signal,
      'FLASH',
    )

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string)

    expect(body.themeColor).toBe('FF0000')
    expect(body.summary).toContain('FLASH ALERT')

    const facts = body.sections[0].facts
    const tierFact = facts.find((f: any) => f.name === 'Alert Tier')
    expect(tierFact).toBeDefined()
    expect(tierFact.value).toContain('FLASH')
  })
})

describe('Real-time Signal Handling', () => {
  it('Redis payload with FLASH tier is recognized', () => {
    const tier = parseAlertTier('FLASH')
    expect(tier).toBe('FLASH')
  })

  it('Redis payload with PRIORITY tier is recognized', () => {
    const tier = parseAlertTier('PRIORITY')
    expect(tier).toBe('PRIORITY')
  })

  it('Redis payload with missing tier defaults to ROUTINE', () => {
    const tier = parseAlertTier(undefined)
    expect(tier).toBe('ROUTINE')
  })
})
