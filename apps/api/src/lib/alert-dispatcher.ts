import type { Signal, SignalSeverity } from '@worldpulse/types'
import { redis } from '../db/redis'
import { logger } from './logger'
import { notificationService } from './notifications'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface AlertSettings {
  telegram_chat_id?:    string
  telegram_bot_token?:  string
  discord_webhook_url?: string
  min_severity:         SignalSeverity
  categories:           string[]
  enabled:              boolean
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

// ─── AlertDispatcher ───────────────────────────────────────────────────────

class AlertDispatcher {
  private timer: ReturnType<typeof setInterval> | null = null

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
            const match = keys[i].match(/^notif:(.+):settings$/)
            if (!match) continue
            const userId = match[1]

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

  /** Dispatch alerts for a batch of signals to all matching users. */
  async dispatchAlerts(signals: Signal[]): Promise<void> {
    if (signals.length === 0) return

    const userSettings = await this.loadUserAlertSettings()
    if (userSettings.size === 0) return

    for (const [userId, settings] of userSettings) {
      for (const signal of signals) {
        const notify = await this.shouldNotify(signal, settings, userId).catch(() => false)
        if (!notify) continue

        // Send to Telegram if configured
        if (settings.telegram_chat_id && settings.telegram_bot_token) {
          notificationService
            .sendTelegramMessage(
              settings.telegram_chat_id,
              notificationService.formatSignalAlert(signal),
              settings.telegram_bot_token,
            )
            .catch(() => {})
        }

        // Send to Discord if configured
        if (settings.discord_webhook_url) {
          notificationService
            .sendDiscordMessage(settings.discord_webhook_url, signal)
            .catch(() => {})
        }
      }
    }
  }

  /** Fetch recent high-severity signals from the internal API. */
  private async fetchRecentSignals(): Promise<Signal[]> {
    const apiBase = `http://localhost:${process.env.PORT ?? 3001}`
    const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString()

    try {
      const res = await fetch(
        `${apiBase}/api/v1/signals?severity=high&limit=50&since=${since}&status=verified`,
        {
          headers: { 'x-internal-dispatch': '1' },
          signal: AbortSignal.timeout(15_000),
        },
      )

      if (!res.ok) return []

      const data = await res.json() as { success?: boolean; data?: { items?: Signal[] } }
      return data?.data?.items ?? []
    } catch {
      return []
    }
  }

  /** Start the 60-second polling loop. Idempotent — safe to call multiple times. */
  start(): void {
    if (this.timer) return

    logger.info('AlertDispatcher: started (60s poll interval)')

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

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      logger.info('AlertDispatcher: stopped')
    }
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────

const dispatcher = new AlertDispatcher()

export function startDispatcher(): void {
  dispatcher.start()
}

export function stopDispatcher(): void {
  dispatcher.stop()
}

export { dispatcher, AlertDispatcher }
export type { Signal }
