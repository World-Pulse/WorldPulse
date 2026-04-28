/**
 * Developer Outbound Webhooks
 *
 * When a signal.new (or other registered) event fires, WorldPulse delivers
 * an authenticated HTTP POST to every active developer webhook that matches.
 *
 * Security:
 *   - Each webhook has a secret (returned ONCE at creation, stored hashed)
 *   - Every delivery includes an X-WorldPulse-Signature header:
 *       HMAC-SHA256(secret, timestamp + '.' + JSON.stringify(payload))
 *   - Developers verify the signature to authenticate payloads
 *
 * Delivery:
 *   - Timeout: 10 s per delivery attempt
 *   - No automatic retries in v1 (use delivery logs to diagnose failures)
 *   - Non-blocking: errors are logged but never throw to callers
 *
 * @module webhooks
 */

import crypto  from 'crypto'
import { db }  from '../db/postgres'
import { logger } from './logger'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WebhookRow {
  id:       string
  url:      string
  secret:   string
  events:   string[]
  filters:  {
    category?:     string
    severity?:     string
    country_code?: string
  }
}

interface SignalPayload {
  id?:               string
  category?:         string
  severity?:         string
  country_code?:     string
  [key: string]:     unknown
}

// ─── HMAC Signature ───────────────────────────────────────────────────────────

/**
 * Generate the X-WorldPulse-Signature header value.
 * Format: `t={timestamp},v1={hmac_hex}`
 */
function sign(secret: string, timestamp: number, body: string): string {
  const sigPayload = `${timestamp}.${body}`
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(sigPayload, 'utf8')
    .digest('hex')
  return `t=${timestamp},v1=${hmac}`
}

// ─── Filter matching ─────────────────────────────────────────────────────────

/**
 * Returns true if the signal payload matches the webhook's configured filters.
 * An empty/missing filter means "match everything".
 */
function matchesFilters(filters: WebhookRow['filters'], payload: SignalPayload): boolean {
  if (!filters || Object.keys(filters).length === 0) return true

  if (filters.category && payload.category !== filters.category) return false
  if (filters.severity && payload.severity !== filters.severity) return false
  if (filters.country_code && payload.country_code !== filters.country_code) return false

  return true
}

// ─── Single delivery ──────────────────────────────────────────────────────────

async function deliver(
  webhook: WebhookRow,
  event: string,
  payload: SignalPayload,
): Promise<void> {
  const bodyStr   = JSON.stringify({ event, payload })
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = sign(webhook.secret, timestamp, bodyStr)
  const start     = Date.now()

  let statusCode: number | null   = null
  let success                      = false
  let errorMsg: string | null      = null

  try {
    const controller = new AbortController()
    const timeoutId  = setTimeout(() => controller.abort(), 10_000)

    const res = await fetch(webhook.url, {
      method:  'POST',
      headers: {
        'Content-Type':           'application/json',
        'User-Agent':             'WorldPulse-Webhooks/1.0',
        'X-WorldPulse-Event':     event,
        'X-WorldPulse-Signature': signature,
        'X-WorldPulse-Timestamp': String(timestamp),
      },
      body:   bodyStr,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    statusCode = res.status
    success    = res.ok
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err)
  }

  const durationMs = Date.now() - start

  // Record delivery (best-effort — don't fail the pipeline if this errors)
  try {
    await db('webhook_deliveries').insert({
      webhook_id:  webhook.id,
      event,
      payload:     JSON.stringify({ event, payload }),
      status_code: statusCode,
      success,
      error_msg:   errorMsg,
      duration_ms: durationMs,
    })

    await db('developer_webhooks')
      .where('id', webhook.id)
      .update({
        last_triggered_at: new Date(),
        total_deliveries:  db.raw('total_deliveries + 1'),
        ...(success ? {} : { failed_deliveries: db.raw('failed_deliveries + 1') }),
      })
  } catch (dbErr) {
    logger.warn({ webhookId: webhook.id, dbErr }, '[webhooks] Failed to record delivery')
  }

  if (!success) {
    logger.warn(
      { webhookId: webhook.id, url: webhook.url, statusCode, errorMsg, durationMs },
      '[webhooks] Delivery failed',
    )
  } else {
    logger.debug(
      { webhookId: webhook.id, url: webhook.url, statusCode, durationMs },
      '[webhooks] Delivered',
    )
  }
}

// ─── Public: fire all matching webhooks ──────────────────────────────────────

/**
 * Fire all active developer webhooks registered for the given event.
 * Non-blocking — called as a background side-effect (`.catch(() => {})` at call site).
 *
 * @param event   WSEventType string, e.g. 'signal.new'
 * @param payload The signal/post/alert payload to deliver
 */
export async function fireWebhooks(event: string, payload: SignalPayload): Promise<void> {
  let webhooks: WebhookRow[]

  try {
    webhooks = await db('developer_webhooks')
      .where('is_active', true)
      .whereRaw('? = ANY(events)', [event])
      .select<WebhookRow[]>(['id', 'url', 'secret', 'events', 'filters'])
  } catch (err) {
    logger.warn({ err, event }, '[webhooks] Failed to query webhooks')
    return
  }

  if (webhooks.length === 0) return

  const matching = webhooks.filter(wh => matchesFilters(wh.filters, payload))

  if (matching.length === 0) return

  logger.debug({ event, count: matching.length }, '[webhooks] Firing matching webhooks')

  // Fire in parallel — each delivery has its own 10s timeout
  await Promise.allSettled(matching.map(wh => deliver(wh, event, payload)))
}
