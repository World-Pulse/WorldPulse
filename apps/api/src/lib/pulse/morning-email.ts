/**
 * Morning Briefing Email Dispatch
 *
 * Sends the morning briefing email to subscribed users at their preferred time.
 * Also dispatches FLASH-tier alerts immediately via email.
 *
 * Uses the existing Resend email infrastructure.
 *
 * @module pulse/morning-email
 */

import { db } from '../../db/postgres'
import { redis } from '../../db/redis'
import { logger } from '../logger'
import { EMAIL_CONFIGURED } from '../email'

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? ''
const FROM_ADDRESS   = process.env.EMAIL_FROM_ADDRESS ?? 'PULSE <pulse@world-pulse.io>'
const RESEND_API_URL = 'https://api.resend.com/emails'

// ─── Types ──────────────────────────────────────────────────────────────────

interface DigestSubscriber {
  id: string
  email: string
  timezone: string
  preferredHour: number // UTC hour for delivery
  categories: string[] | null
  minSeverity: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#22c55e',
  info:     '#3b82f6',
}

// ─── Morning Briefing Email HTML ────────────────────────────────────────────

function buildMorningBriefingHtml(
  executiveSummary: string,
  events: Array<{
    title: string
    category: string
    severity: string
    locationName: string | null
    reliabilityScore: number
    isEscalating: boolean
  }>,
  escalatingStories: Array<{ category: string; reason: string | null }>,
  date: string,
): string {
  const eventsHtml = events.map(e => {
    const sevColor = SEVERITY_COLORS[e.severity] ?? '#6b7280'
    const escalatingBadge = e.isEscalating
      ? '<span style="display:inline-block;background-color:#ef444420;border:1px solid #ef444440;border-radius:4px;padding:2px 6px;font-size:9px;font-weight:700;color:#ef4444;letter-spacing:0.06em;margin-left:6px;">ESCALATING</span>'
      : ''
    return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #1f2937;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <span style="display:inline-block;background-color:${sevColor}20;border:1px solid ${sevColor}40;border-radius:4px;padding:2px 6px;font-size:9px;font-weight:700;color:${sevColor};letter-spacing:0.06em;">${e.severity.toUpperCase()}</span>
                <span style="font-size:10px;color:#6b7280;margin-left:8px;">${escapeHtml(e.category)}</span>
                ${escalatingBadge}
              </td>
              <td align="right" style="font-size:10px;color:#6b7280;">${escapeHtml(e.locationName ?? 'Global')}</td>
            </tr>
            <tr>
              <td colspan="2" style="padding-top:4px;">
                <span style="font-size:14px;font-weight:600;color:#f3f4f6;">${escapeHtml(e.title)}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
  }).join('')

  const escalatingSection = escalatingStories.length > 0
    ? `<tr>
        <td style="padding:16px 0 8px 0;">
          <span style="font-size:10px;font-weight:700;color:#ef4444;letter-spacing:0.12em;text-transform:uppercase;">ESCALATING STORIES</span>
        </td>
      </tr>
      ${escalatingStories.map(e => `
      <tr>
        <td style="padding:4px 0;font-size:12px;color:#f87171;">
          ${escapeHtml(e.category)} — ${escapeHtml(e.reason ?? 'Multiple signals detected')}
        </td>
      </tr>`).join('')}`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PULSE Morning Briefing</title>
</head>
<body style="margin:0;padding:0;background-color:#06070d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#06070d;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <tr>
            <td style="padding-bottom:8px;">
              <span style="font-size:22px;font-weight:700;color:#f59e0b;letter-spacing:-0.5px;">WorldPulse</span>
              <span style="font-size:14px;color:#6b7280;margin-left:8px;">Morning Briefing</span>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:20px;border-bottom:1px solid #1f2937;">
              <span style="font-size:12px;color:#6b7280;">${escapeHtml(date)} &middot; ${events.length} overnight events</span>
            </td>
          </tr>

          <!-- Executive Summary -->
          <tr>
            <td style="padding:20px 0;background-color:#0f1117;border-radius:10px;border:1px solid #1f2937;margin:16px 0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:0 20px 8px;">
                    <span style="font-size:10px;font-weight:700;color:#f59e0b;letter-spacing:0.12em;text-transform:uppercase;">EXECUTIVE SUMMARY</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 20px;">
                    <p style="margin:0;font-size:14px;color:#d1d5db;line-height:1.6;">${escapeHtml(executiveSummary)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${escalatingSection}

          <!-- Events -->
          <tr>
            <td style="padding:16px 0 8px 0;">
              <span style="font-size:10px;font-weight:700;color:#f59e0b;letter-spacing:0.12em;text-transform:uppercase;">OVERNIGHT EVENTS</span>
            </td>
          </tr>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${eventsHtml}
          </table>

          <!-- CTA -->
          <tr>
            <td style="padding:24px 0;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color:#f59e0b;border-radius:8px;">
                    <a href="https://world-pulse.io/briefing" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#000000;text-decoration:none;">
                      Full Briefing &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:16px;border-top:1px solid #111827;text-align:center;">
              <p style="margin:0;font-size:11px;color:#374151;">
                PULSE &middot; WorldPulse AI Bureau
                <br/>
                <a href="https://world-pulse.io/settings/notifications" style="color:#6b7280;">Manage preferences</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Send morning briefing email to a specific user.
 */
export async function sendMorningBriefingEmail(
  to: string,
  executiveSummary: string,
  events: Array<{
    title: string
    category: string
    severity: string
    locationName: string | null
    reliabilityScore: number
    isEscalating: boolean
  }>,
  escalatingStories: Array<{ category: string; reason: string | null }>,
): Promise<void> {
  if (!EMAIL_CONFIGURED) return

  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  const subject = `PULSE Morning Briefing — ${date}`
  const html = buildMorningBriefingHtml(executiveSummary, events, escalatingStories, date)

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [to],
        subject,
        html,
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      logger.warn({ status: res.status, body, to }, 'Morning briefing email: Resend error')
    } else {
      logger.debug({ to }, 'Morning briefing email sent')
    }
  } catch (err) {
    logger.error({ err, to }, 'Morning briefing email: request failed')
  }
}

/**
 * Dispatch morning briefings to all subscribed users whose delivery hour matches now.
 * Called by the PULSE scheduler every minute.
 */
export async function dispatchMorningBriefings(): Promise<number> {
  if (!EMAIL_CONFIGURED) return 0

  const currentHourUTC = new Date().getUTCHours()

  // Check if we already dispatched this hour
  const dispatchKey = `pulse:briefing-dispatch:${new Date().toISOString().slice(0, 13)}`
  const alreadyDispatched = await redis.get(dispatchKey).catch(() => null)
  if (alreadyDispatched) return 0

  // Find users who want briefing at this hour
  // Uses digest_subscriptions table or users with briefing preferences
  let subscribers: DigestSubscriber[] = []
  try {
    subscribers = await db('digest_subscriptions')
      .where('active', true)
      .where('preferred_hour_utc', currentHourUTC)
      .select(['id', 'email', 'timezone', 'preferred_hour_utc as preferredHour', 'categories', 'min_severity as minSeverity'])
      .limit(100) as any
  } catch {
    // Table may not exist yet — that's fine
    return 0
  }

  if (subscribers.length === 0) return 0

  // Mark as dispatched for this hour
  await redis.setex(dispatchKey, 3600, '1').catch(() => {})

  // Fetch briefing data once, share across all subscribers
  const since = new Date(Date.now() - 9 * 3600_000) // last 9 hours

  const signals = await db('signals')
    .whereIn('status', ['verified', 'pending'])
    .where('created_at', '>', since)
    .whereNotIn('category', ['culture', 'sports', 'other'])
    .where('reliability_score', '>=', 0.5)
    .orderByRaw(`
      CASE severity
        WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4
      END, reliability_score DESC
    `)
    .limit(15)
    .select(['title', 'category', 'severity', 'location_name', 'reliability_score'])

  if (signals.length === 0) return 0

  const events = signals.map((s: any) => ({
    title: s.title,
    category: s.category,
    severity: s.severity,
    locationName: s.location_name,
    reliabilityScore: s.reliability_score,
    isEscalating: false, // simplified for email
  }))

  const executiveSummary = `${signals.length} notable signals detected overnight. The most significant: ${(signals[0] as any).title} (${(signals[0] as any).location_name ?? 'Global'}).`

  let sent = 0
  for (const sub of subscribers) {
    try {
      await sendMorningBriefingEmail(sub.email, executiveSummary, events.slice(0, 10), [])
      sent++
    } catch (err) {
      logger.warn({ err, email: sub.email }, 'Failed to send morning briefing email')
    }
  }

  logger.info({ sent, total: subscribers.length }, 'Morning briefing emails dispatched')
  return sent
}

/**
 * Send immediate FLASH alert email to users who opted into push for FLASH-tier.
 */
export async function dispatchFlashAlertEmail(signal: {
  title: string
  summary: string | null
  category: string
  severity: string
  locationName: string | null
  reliabilityScore: number
  id: string
}): Promise<number> {
  if (!EMAIL_CONFIGURED) return 0
  if (signal.severity !== 'critical') return 0

  // Find users who want FLASH push alerts
  let emails: string[] = []
  try {
    const rows = await db('users')
      .where('flash_alerts_email', true)
      .whereNotNull('email')
      .select('email')
      .limit(200)
    emails = rows.map((r: any) => r.email).filter(Boolean)
  } catch {
    // Column may not exist yet
    return 0
  }

  if (emails.length === 0) return 0

  const sevColor = SEVERITY_COLORS[signal.severity] ?? '#ef4444'
  const reliabilityPct = Math.round(signal.reliabilityScore * 100)
  const signalUrl = `https://world-pulse.io/signals/${signal.id}`

  const subject = `[FLASH] ${signal.title}`
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background-color:#06070d;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#06070d;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="padding-bottom:16px;"><span style="font-size:22px;font-weight:700;color:#f59e0b;">WorldPulse</span> <span style="font-size:14px;color:#ef4444;font-weight:700;">FLASH ALERT</span></td></tr>
<tr><td style="background-color:#0f1117;border-radius:12px;border:1px solid #ef444440;padding:24px;">
<span style="display:inline-block;background-color:${sevColor}20;border:1px solid ${sevColor}40;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;color:${sevColor};letter-spacing:0.08em;margin-bottom:12px;">${signal.severity.toUpperCase()}</span>
<h1 style="margin:12px 0;font-size:18px;font-weight:700;color:#f3f4f6;line-height:1.3;">${escapeHtml(signal.title)}</h1>
${signal.summary ? `<p style="margin:0 0 16px;font-size:13px;color:#9ca3af;line-height:1.5;">${escapeHtml(signal.summary)}</p>` : ''}
<p style="margin:0 0 16px;font-size:11px;color:#6b7280;">${escapeHtml(signal.locationName ?? 'Global')} &middot; Reliability: ${reliabilityPct}%</p>
<a href="${signalUrl}" style="display:inline-block;background-color:#f59e0b;border-radius:8px;padding:10px 20px;font-size:13px;font-weight:600;color:#000;text-decoration:none;">View Signal &rarr;</a>
</td></tr>
<tr><td style="padding-top:16px;text-align:center;font-size:11px;color:#374151;">PULSE &middot; WorldPulse AI Bureau &middot; <a href="https://world-pulse.io/settings/notifications" style="color:#6b7280;">Manage alerts</a></td></tr>
</table>
</td></tr></table></body></html>`

  let sent = 0
  // Batch send — Resend supports multiple recipients
  const batchSize = 50
  for (let i = 0; i < emails.length; i += batchSize) {
    const batch = emails.slice(i, i + batchSize)
    try {
      const res = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_ADDRESS,
          to: batch,
          subject,
          html,
        }),
        signal: AbortSignal.timeout(15_000),
      })
      if (res.ok) sent += batch.length
    } catch {
      // Non-fatal
    }
  }

  logger.info({ sent, signalId: signal.id, title: signal.title }, 'FLASH alert emails dispatched')
  return sent
}
