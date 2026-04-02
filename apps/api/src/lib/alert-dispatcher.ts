import type { Signal, SignalSeverity, AlertTier } from '@worldpulse/types'
import { redis } from '../db/redis'
import { db } from '../db/postgres'
import { logger } from './logger'
import { notificationService } from './notifications'
import { sendAlertEmail } from './email'
import { parseAlertTier } from './alert-tier'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface AlertSettings {
  telegram_chat_id?:       string
  telegram_bot_token?:     string
  discord_webhook_url?:    string
  slack_webhook_url?:      string
  ms_teams_webhook_url?:   string
  email_address?:          string
  min_severity:            SignalSeverity
  categories:              string[]
  enabled:                 boolean
}

const SEVERITY_ORDER: Record<SignalSeverity, number> = {
  critical: 5,
  high:     4,
  medium:   3,
  low:      2,
  info:     1,
}

const DEDUP_TTL_SECONDS = 86_400 // 24 hours
const POLL_INTERVAL_MS  = 60_000 // 60 seconds
const LOOKBACK_MINUTES  = 2

// Redis channel published by the scraper pipeline when a new signal is inserted
const SIGNAL_NEW_CHANNEL = 'wp:signal.new'

// ─── AlertDispatcher ───────────────────────────────────────────────────────

class AlertDispatcher {
  private timer: ReturnType<typeof setInterval> | null = null
  private subscriber: typeof redis | null = null

  /** Load all users with enabled alert settings from Redis via SCAN. */
  async loadUserAlertSettings(): Promise<Map<string, AlertSettings>> {
    const result = new Map<string, AlertSettings>()
    let cursor = '0'

    try {
      do {
        const [next, keys] = await redis.scan(
          cursor,
          'MATCH', 'notif:*:settings',
          'COUNT', 100,
        )
        cursor = next

        if (keys.length > 0) {
          const values = await redis.mget(...keys)
          for (let i = 0; i < keys.length; i++) {
            const raw = values[i]
            if (!raw) continue

            // Extract userId from key pattern notif:{userId}:settings
            const key = keys[i]
            if (!key) continue
            const match = key.match(/^notif:(.+):settings$/)
            if (!match) continue
            const userId = match[1]
            if (!userId) continue

            try {
              const settings = JSON.parse(raw) as AlertSettings
              if (settings.enabled) {
                result.set(userId, settings)
              }
            } catch {
              // malformed entry — skip
            }
          }
        }
      } while (cursor !== '0')
    } catch (err) {
      logger.warn({ err }, 'AlertDispatcher: failed to load user alert settings')
    }

    return result
  }

  /** Check whether a signal should trigger a notification for these settings. */
  async shouldNotify(
    signal: Signal,
    settings: AlertSettings,
    userId: string,
  ): Promise<boolean> {
    // Severity threshold check
    if (SEVERITY_ORDER[signal.severity] < SEVERITY_ORDER[settings.min_severity]) {
      return false
    }

    // Category filter (empty array = all categories)
    if (
      settings.categories.length > 0 &&
      !settings.categories.includes(signal.category)
    ) {
      return false
    }

    // Deduplication check
    const dedupKey = `notif:sent:${userId}:${signal.id}`
    const alreadySent = await redis.exists(dedupKey).catch(() => 0)
    if (alreadySent) return false

    // Mark as sent (fire-and-forget, TTL 24h)
    redis.setex(dedupKey, DEDUP_TTL_SECONDS, '1').catch(() => {})

    return true
  }

  /**
   * Dispatch tier-aware alerts for a batch of signals to all matching users.
   * FLASH and PRIORITY signals get prominent formatting with tier banners.
   */
  async dispatchAlerts(signals: Signal[]): Promise<void> {
    if (signals.length === 0) return

    const userSettings = await this.loadUserAlertSettings()
    if (userSettings.size === 0) return

    for (const [userId, settings] of userSettings) {
      for (const signal of signals) {
        const notify = await this.shouldNotify(signal, settings, userId).catch(() => false)
        if (!notify) continue

        const tier = parseAlertTier((signal as unknown as Record<string, unknown>)['alertTier'] as string | undefined)

        // Send to Telegram — tier-aware formatting
        if (settings.telegram_chat_id && settings.telegram_bot_token) {
          const text = tier !== 'ROUTINE'
            ? notificationService.formatTieredTelegramAlert(signal, tier)
            : notificationService.formatSignalAlert(signal)
          notificationService
            .sendTelegramMessage(settings.telegram_chat_id, text, settings.telegram_bot_token)
            .catch(() => {})
        }

        // Send to Discord — tier-aware embeds
        if (settings.discord_webhook_url) {
          if (tier !== 'ROUTINE') {
            notificationService
              .sendTieredDiscordMessage(settings.discord_webhook_url, signal, tier)
              .catch(() => {})
          } else {
            notificationService
              .sendDiscordMessage(settings.discord_webhook_url, signal)
              .catch(() => {})
          }
        }

        // Send to Slack — tier-aware blocks
        if (settings.slack_webhook_url) {
          if (tier !== 'ROUTINE') {
            notificationService
              .sendTieredSlackMessage(settings.slack_webhook_url, signal, tier)
              .catch(() => {})
          } else {
            notificationService
              .sendSlackMessage(settings.slack_webhook_url, signal)
              .catch(() => {})
          }
        }

        // Send to Microsoft Teams — tier-aware cards
        if (settings.ms_teams_webhook_url) {
          if (tier !== 'ROUTINE') {
            notificationService
              .sendTieredTeamsMessage(settings.ms_teams_webhook_url, signal, tier)
              .catch(() => {})
          } else {
            notificationService
              .sendTeamsMessage(settings.ms_teams_webhook_url, signal)
              .catch(() => {})
          }
        }

        // Send to email if configured
        if (settings.email_address) {
          sendAlertEmail(settings.email_address, signal).catch(() => {})
        }
      }
    }

    // ── DB-based alert subscriptions (keyword / category / country filters + email channel) ──
    await this.dispatchDbSubscriptionAlerts(signals)
  }

  /**
   * Check all active DB-based alert subscriptions (alert_subscriptions table)
   * against a batch of signals. Sends email to matching users who have
   * channels.email = true and a verified email address.
   *
   * This complements the Redis-settings system with the richer per-subscription
   * filtering that supports keyword, category, country and severity thresholds.
   */
  async dispatchDbSubscriptionAlerts(signals: Signal[]): Promise<void> {
    if (signals.length === 0) return

    try {
      // Load all active subscriptions with email channel enabled + user email
      const subscriptions = await db('alert_subscriptions as a')
        .join('users as u', 'u.id', 'a.user_id')
        .where('a.active', true)
        .whereRaw(`(a.channels->>'email')::boolean = true`)
        .whereNotNull('u.email')
        .select<Array<{
          sub_id:       string
          user_id:      string
          keywords:     string[]
          categories:   string[]
          countries:    string[]
          min_severity: SignalSeverity
          email:        string
          display_name: string | null
        }>>(
          'a.id as sub_id',
          'a.user_id',
          'a.keywords',
          'a.categories',
          'a.countries',
          'a.min_severity',
          'u.email',
          'u.display_name',
        )

      if (subscriptions.length === 0) return

      for (const signal of signals) {
        for (const sub of subscriptions) {
          // ── Severity threshold ──────────────────────────────────────────
          if (SEVERITY_ORDER[signal.severity] < SEVERITY_ORDER[sub.min_severity]) continue

          // ── Category filter (empty array = all categories) ──────────────
          const cats = Array.isArray(sub.categories) ? sub.categories : []
          if (cats.length > 0 && !cats.includes(signal.category)) continue

          // ── Country filter (empty array = all countries) ────────────────
          const countries = Array.isArray(sub.countries) ? sub.countries : []
          if (
            countries.length > 0 &&
            signal.countryCode &&
            !countries.includes(signal.countryCode)
          ) continue

          // ── Keyword filter (any keyword must appear in title or summary) ─
          const keywords = Array.isArray(sub.keywords) ? sub.keywords : []
          if (keywords.length > 0) {
            const haystack = `${signal.title} ${signal.summary ?? ''}`.toLowerCase()
            const anyMatch = keywords.some(kw => haystack.includes(kw.toLowerCase()))
            if (!anyMatch) continue
          }

          // ── Deduplication — one email per (subscription, signal) pair ───
          const dedupKey = `notif:email:${sub.user_id}:${sub.sub_id}:${signal.id}`
          const alreadySent = await redis.exists(dedupKey).catch(() => 0)
          if (alreadySent) continue
          redis.setex(dedupKey, DEDUP_TTL_SECONDS, '1').catch(() => {})

          // ── Dispatch email ───────────────────────────────────────────────
          logger.debug(
            { to: sub.email, signalId: signal.id, subId: sub.sub_id },
            'AlertDispatcher: sending DB subscription alert email',
          )
          sendAlertEmail(sub.email, signal).catch((err: unknown) => {
            logger.warn({ err, to: sub.email }, 'AlertDispatcher: DB subscription email failed')
          })
        }
      }
    } catch (err) {
      logger.warn({ err }, 'AlertDispatcher: dispatchDbSubscriptionAlerts failed')
    }
  }

  /**
   * Handle an incoming Redis PUBLISH message from the scraper pipeline.
   * FLASH signals are dispatched immediately (zero-delay).
   * PRIORITY signals are dispatched immediately if reliability >= 0.6.
   * ROUTINE signals are left for the 60s polling loop.
   */
  private async handleRealtimeSignal(message: string): Promise<void> {
    try {
      const payload = JSON.parse(message) as Record<string, unknown>

      const tier = parseAlertTier(payload['alert_tier'] as string | undefined)

      // Only process FLASH and qualifying PRIORITY signals in real-time
      if (tier === 'ROUTINE') return
      if (tier === 'PRIORITY') {
        const reliability = typeof payload['reliability_score'] === 'number'
          ? payload['reliability_score']
          : 0
        if (reliability < 0.6) return
      }

      logger.info(
        { signalId: payload['id'], tier, title: payload['title'] },
        `AlertDispatcher: real-time ${tier} signal — dispatching immediately`,
      )

      // Build a minimal Signal-like object from the Redis payload
      const signal: Signal = {
        id:               String(payload['id'] ?? ''),
        title:            String(payload['title'] ?? ''),
        summary:          typeof payload['summary'] === 'string' ? payload['summary'] : '',
        body:             '',
        category:         String(payload['category'] ?? 'general') as Signal['category'],
        severity:         (payload['severity'] as SignalSeverity) ?? 'medium',
        status:           'verified',
        reliabilityScore: typeof payload['reliability_score'] === 'number' ? payload['reliability_score'] : 0,
        alertTier:        tier,
        sourceCount:      0,
        location:         null,
        locationName:     typeof payload['location_name'] === 'string' ? payload['location_name'] : null,
        countryCode:      typeof payload['country_code'] === 'string' ? payload['country_code'] : null,
        region:           null,
        tags:             [],
        sources:          [],
        originalUrls:     typeof payload['source_url'] === 'string' ? [payload['source_url']] : [],
        language:         'en',
        viewCount:        0,
        shareCount:       0,
        postCount:        0,
        eventTime:        null,
        firstReported:    typeof payload['created_at'] === 'string' ? payload['created_at'] : new Date().toISOString(),
        verifiedAt:       null,
        lastUpdated:      new Date().toISOString(),
        createdAt:        typeof payload['created_at'] === 'string' ? payload['created_at'] : new Date().toISOString(),
      }

      await this.dispatchAlerts([signal])
    } catch (err) {
      logger.warn({ err }, 'AlertDispatcher: failed to handle real-time signal')
    }
  }

  /**
   * Fetch recent critical + high severity signals from the internal API.
   * FIX: Previously only fetched severity=high, missing critical-severity signals
   * which include all FLASH-tier events. Now fetches both.
   */
  private async fetchRecentSignals(): Promise<Signal[]> {
    const apiBase = `http://localhost:${process.env.PORT ?? 3001}`
    const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString()

    const results: Signal[] = []

    // Fetch both critical and high severity signals
    for (const severity of ['critical', 'high'] as const) {
      try {
        const res = await fetch(
          `${apiBase}/api/v1/signals?severity=${severity}&limit=50&since=${since}&status=verified`,
          {
            headers: { 'x-internal-dispatch': '1' },
            signal: AbortSignal.timeout(15_000),
          },
        )

        if (!res.ok) continue

        const data = await res.json() as { success?: boolean; data?: { items?: Signal[] } }
        const items = data?.data?.items ?? []
        results.push(...items)
      } catch {
        // continue to next severity
      }
    }

    return results
  }

  /**
   * Start the alert dispatcher with two mechanisms:
   * 1. Redis PUB/SUB for instant FLASH/PRIORITY signal dispatch
   * 2. 60-second polling loop as a safety net for any missed signals
   *
   * Idempotent — safe to call multiple times.
   */
  start(): void {
    if (this.timer) return

    // ── Real-time Redis subscriber for FLASH/PRIORITY signals ──
    this.startRealtimeSubscriber()

    // ── 60-second polling fallback ──
    logger.info('AlertDispatcher: started (60s poll + real-time Redis subscriber)')

    this.timer = setInterval(async () => {
      try {
        const signals = await this.fetchRecentSignals()
        await this.dispatchAlerts(signals)
      } catch (err) {
        logger.warn({ err }, 'AlertDispatcher: poll cycle error')
      }
    }, POLL_INTERVAL_MS)

    // Allow Node to exit even if timer is still running
    this.timer.unref()
  }

  /**
   * Subscribe to the wp:signal.new Redis channel for instant FLASH dispatch.
   * Uses a dedicated Redis connection (subscriber mode).
   */
  private startRealtimeSubscriber(): void {
    if (this.subscriber) return

    try {
      // ioredis .duplicate() creates a new connection suitable for subscriber mode
      this.subscriber = redis.duplicate()

      this.subscriber.subscribe(SIGNAL_NEW_CHANNEL, (err) => {
        if (err) {
          logger.warn({ err }, 'AlertDispatcher: failed to subscribe to signal channel')
          return
        }
        logger.info({ channel: SIGNAL_NEW_CHANNEL }, 'AlertDispatcher: subscribed to real-time signal channel')
      })

      this.subscriber.on('message', (_channel: string, message: string) => {
        this.handleRealtimeSignal(message).catch(() => {})
      })

      this.subscriber.on('error', (err: Error) => {
        logger.warn({ err }, 'AlertDispatcher: Redis subscriber error')
      })
    } catch (err) {
      logger.warn({ err }, 'AlertDispatcher: failed to create Redis subscriber')
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }

    if (this.subscriber) {
      this.subscriber.unsubscribe(SIGNAL_NEW_CHANNEL).catch(() => {})
      this.subscriber.disconnect()
      this.subscriber = null
    }

    logger.info('AlertDispatcher: stopped')
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const alertDispatcher = new AlertDispatcher()

/** Start the alert dispatcher (idempotent). Called from apps/api/src/index.ts. */
export function startDispatcher(): void {
  alertDispatcher.start()
}

/** Stop the alert dispatcher cleanly. Called on SIGTERM/SIGINT. */
export function stopDispatcher(): void {
  alertDispatcher.stop()
}