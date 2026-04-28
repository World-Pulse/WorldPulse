import { redis } from '../db/redis'
import { db } from '../db/postgres'
import { logger } from './logger'
import { broadcast } from '../ws/handler'

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

export const BREAKING_ALERT_RATE_LIMIT = 8
export const BREAKING_ALERT_WINDOW_S = 3600

// ─── TYPES ──────────────────────────────────────────────────────────────────

export interface SignalInput {
  id: string
  title: string
  category: string
  severity: string
  reliability_score: number
  location_name?: string
  country_code?: string
  source_url?: string
  created_at: string
}

export interface BreakingAlert {
  alertId: string
  signalId: string
  title: string
  severity: string
  category: string
  locationName?: string
  countryCode?: string
  sourceUrl?: string
  timestamp: string
  expiresAt: string
}

// ─── REDIS KEYS ────────────────────────────────────────────────────────────

const DEDUP_KEY_PREFIX = 'breaking:alert:'
const RATE_LIMIT_KEY = 'breaking:rate'
const ACTIVE_LIST_KEY = 'breaking:active'

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const DEDUP_TTL_SECONDS = 7200 // 2 hours
const ACTIVE_LIST_TTL_SECONDS = 21600 // 6 hours
const ACTIVE_LIST_MAX_SIZE = 20

// ─── HELPERS ────────────────────────────────────────────────────────────────

/**
 * Check if severity is 'critical' or 'high'.
 */
function isSeverityQualifying(severity: string): boolean {
  return severity === 'critical' || severity === 'high'
}

/**
 * Check if reliability_score meets the threshold (>= 0.6).
 */
function meetsReliabilityThreshold(score: number): boolean {
  return score >= 0.6
}

/**
 * Generate a unique alert ID.
 */
function generateAlertId(): string {
  return crypto.randomUUID()
}

/**
 * Create the alert payload from signal input.
 */
function createAlertPayload(signal: SignalInput, alertId: string): BreakingAlert {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + ACTIVE_LIST_TTL_SECONDS * 1000)

  return {
    alertId,
    signalId: signal.id,
    title: signal.title,
    severity: signal.severity,
    category: signal.category,
    locationName: signal.location_name,
    countryCode: signal.country_code,
    sourceUrl: signal.source_url,
    timestamp: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  }
}

/**
 * Check if an alert for this signal has already been emitted (dedup check).
 */
async function isAlertDuplicate(signalId: string): Promise<boolean> {
  try {
    const key = `${DEDUP_KEY_PREFIX}${signalId}`
    const exists = await redis.exists(key)
    return exists === 1
  } catch (err) {
    logger.warn({ err, signalId }, 'Failed to check dedup key')
    return false
  }
}

/**
 * Mark a signal as already alerted (set dedup key).
 */
async function markAlertEmitted(signalId: string): Promise<void> {
  try {
    const key = `${DEDUP_KEY_PREFIX}${signalId}`
    await redis.setex(key, DEDUP_TTL_SECONDS, '1')
  } catch (err) {
    logger.warn({ err, signalId }, 'Failed to set dedup key')
  }
}

/**
 * Check if rate limit (max 8 alerts per hour) has been exceeded.
 * Uses a sorted set with timestamp scores.
 */
async function checkRateLimit(): Promise<boolean> {
  try {
    const now = Date.now() / 1000 // convert to seconds for consistency
    const windowStart = now - BREAKING_ALERT_WINDOW_S

    // Remove old entries outside the window
    await redis.zremrangebyscore(RATE_LIMIT_KEY, '-inf', windowStart)

    // Count remaining entries within the window
    const count = await redis.zcard(RATE_LIMIT_KEY)

    return count < BREAKING_ALERT_RATE_LIMIT
  } catch (err) {
    logger.warn({ err }, 'Failed to check rate limit')
    // On error, allow the alert to proceed (fail open)
    return true
  }
}

/**
 * Increment the rate limit counter.
 */
async function incrementRateLimit(): Promise<void> {
  try {
    const now = Date.now() / 1000
    await redis.zadd(RATE_LIMIT_KEY, now, `${now}:${crypto.randomUUID()}`)
    // Set expiry on the key itself
    await redis.expire(RATE_LIMIT_KEY, BREAKING_ALERT_WINDOW_S)
  } catch (err) {
    logger.warn({ err }, 'Failed to increment rate limit counter')
  }
}

/**
 * Add alert to the active list and enforce max size.
 */
async function addToActiveList(alert: BreakingAlert): Promise<void> {
  try {
    const listKey = ACTIVE_LIST_KEY
    const alertJson = JSON.stringify(alert)

    // Add to list
    await redis.lpush(listKey, alertJson)

    // Trim to max size
    await redis.ltrim(listKey, 0, ACTIVE_LIST_MAX_SIZE - 1)

    // Set expiry on the list
    await redis.expire(listKey, ACTIVE_LIST_TTL_SECONDS)
  } catch (err) {
    logger.warn({ err, alertId: alert.alertId }, 'Failed to add alert to active list')
  }
}

/**
 * Publish alert to Redis pub/sub for multi-instance support.
 */
async function publishAlertToRedis(alert: BreakingAlert): Promise<void> {
  try {
    const message = JSON.stringify({
      event: 'alert.breaking',
      payload: alert,
      filter: { severity: alert.severity },
    })

    await redis.publish('wp:alert.trigger', message)
  } catch (err) {
    logger.warn({ err, alertId: alert.alertId }, 'Failed to publish alert to Redis')
  }
}

// ─── PUBLIC API ─────────────────────────────────────────────────────────────

/**
 * Check if a signal qualifies for a breaking alert and emit if conditions are met.
 * Called after new signals are ingested.
 */
export async function checkAndEmitBreakingAlert(signal: SignalInput): Promise<void> {
  try {
    // 1. Severity and reliability check
    if (!isSeverityQualifying(signal.severity)) {
      logger.debug({ signalId: signal.id, severity: signal.severity }, 'Signal does not meet severity threshold')
      return
    }

    if (!meetsReliabilityThreshold(signal.reliability_score)) {
      logger.debug({ signalId: signal.id, score: signal.reliability_score }, 'Signal does not meet reliability threshold')
      return
    }

    // 2. Deduplication check
    if (await isAlertDuplicate(signal.id)) {
      logger.debug({ signalId: signal.id }, 'Alert already emitted for this signal (dedup)')
      return
    }

    // 3. Rate limit check
    const withinRateLimit = await checkRateLimit()
    if (!withinRateLimit) {
      logger.warn({ signalId: signal.id }, 'Breaking alert rate limit exceeded')
      return
    }

    // 4. Generate alert
    const alertId = generateAlertId()
    const alert = createAlertPayload(signal, alertId)

    // 5. Mark as emitted
    await markAlertEmitted(signal.id)

    // 6. Increment rate limit counter
    await incrementRateLimit()

    // 7. Store in Redis active list
    await addToActiveList(alert)

    // 8. Broadcast via WebSocket
    broadcast('alert.breaking', alert, { severity: signal.severity })

    // 9. Publish to Redis pub/sub for multi-instance support
    await publishAlertToRedis(alert)

    logger.info(
      {
        alertId: alert.alertId,
        signalId: signal.id,
        title: signal.title,
        severity: signal.severity,
      },
      'Breaking alert emitted',
    )
  } catch (err) {
    logger.error({ err, signalId: signal.id }, 'Error checking/emitting breaking alert')
  }
}

/**
 * Get all currently active breaking alerts from Redis.
 */
export async function getActiveBreakingAlerts(): Promise<BreakingAlert[]> {
  try {
    const listKey = ACTIVE_LIST_KEY
    const items = await redis.lrange(listKey, 0, -1)

    const alerts: BreakingAlert[] = []

    for (const item of items) {
      try {
        const alert = JSON.parse(item) as BreakingAlert
        alerts.push(alert)
      } catch {
        logger.warn({ item }, 'Failed to parse active alert from Redis')
      }
    }

    return alerts
  } catch (err) {
    logger.warn({ err }, 'Failed to retrieve active breaking alerts')
    return []
  }
}

/**
 * Remove an alert from the active list by ID.
 */
export async function dismissBreakingAlert(alertId: string): Promise<void> {
  try {
    const listKey = ACTIVE_LIST_KEY
    const items = await redis.lrange(listKey, 0, -1)

    // Rebuild list without the dismissed alert
    const filtered = items.filter((item) => {
      try {
        const alert = JSON.parse(item) as BreakingAlert
        return alert.alertId !== alertId
      } catch {
        return true // keep items that fail to parse
      }
    })

    // Replace the list
    if (filtered.length === 0) {
      await redis.del(listKey)
    } else {
      await redis.del(listKey)
      await redis.rpush(listKey, ...filtered)
      await redis.expire(listKey, ACTIVE_LIST_TTL_SECONDS)
    }

    logger.debug({ alertId }, 'Breaking alert dismissed')
  } catch (err) {
    logger.warn({ err, alertId }, 'Failed to dismiss breaking alert')
  }
}
