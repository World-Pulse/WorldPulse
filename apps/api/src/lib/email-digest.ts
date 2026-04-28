import type { Signal, SignalSeverity } from '@worldpulse/types'
import { logger } from './logger'

// ─── Config ────────────────────────────────────────────────────────────────
//
// Same Resend API pattern as email.ts.
// Set RESEND_API_KEY in your .env to enable digest email dispatch.

const RESEND_API_KEY = process.env.RESEND_API_KEY    ?? ''
const FROM_ADDRESS   = process.env.EMAIL_FROM_ADDRESS ?? 'WorldPulse Digest <digest@world-pulse.io>'
const REPLY_TO       = process.env.EMAIL_REPLY_TO     ?? ''
const RESEND_API_URL = 'https://api.resend.com/emails'

export const DIGEST_EMAIL_CONFIGURED: boolean = RESEND_API_KEY !== ''

// ─── Severity maps ─────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<SignalSeverity, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#22c55e',
  info:     '#3b82f6',
}

const SEVERITY_LABELS: Record<SignalSeverity, string> = {
  critical: 'CRITICAL',
  high:     'HIGH',
  medium:   'MEDIUM',
  low:      'LOW',
  info:     'INFO',
}

// Ordered from most to least severe for filtering
const SEVERITY_RANK: Record<SignalSeverity, number> = {
  critical: 5,
  high:     4,
  medium:   3,
  low:      2,
  info:     1,
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function formatDateRange(from: Date, to: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
  return `${from.toLocaleDateString('en-US', opts)} – ${to.toLocaleDateString('en-US', opts)}`
}

function groupByCategory(signals: Signal[]): Map<string, Signal[]> {
  const map = new Map<string, Signal[]>()
  for (const s of signals) {
    const cat = s.category ?? 'other'
    const existing = map.get(cat)
    if (existing) {
      existing.push(s)
    } else {
      map.set(cat, [s])
    }
  }
  return map
}

// ─── Signal card HTML ──────────────────────────────────────────────────────

function signalCardHtml(signal: Signal): string {
  const severityColor  = SEVERITY_COLORS[signal.severity]
  const severityLabel  = SEVERITY_LABELS[signal.severity]
  const reliabilityPct = Math.round(signal.reliabilityScore * 100)
  const location       = signal.locationName ?? signal.countryCode ?? 'Unknown'
  const signalUrl      = `https://world-pulse.io/signals/${signal.id}`

  const reliabilityColor =
    reliabilityPct >= 80 ? '#22c55e' :
    reliabilityPct >= 50 ? '#eab308' :
                           '#ef4444'

  return `
        <tr>
          <td style="padding:0 0 12px 0;">
            <table width="100%" cellpadding="0" cellspacing="0"
                   style="background-color:#0f1117;border-radius:10px;border:1px solid #1f2937;padding:20px;">
              <tr>
                <td>
                  <!-- Severity + location row -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
                    <tr>
                      <td>
                        <span style="display:inline-block;background-color:${severityColor}20;border:1px solid ${severityColor}40;border-radius:5px;padding:3px 8px;font-size:10px;font-weight:700;color:${severityColor};letter-spacing:0.08em;">${severityLabel}</span>
                      </td>
                      <td align="right" style="font-size:11px;color:#6b7280;">
                        &#127758;&nbsp;${escapeHtml(location)}
                      </td>
                    </tr>
                  </table>
                  <!-- Title -->
                  <a href="${signalUrl}" style="text-decoration:none;">
                    <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#f3f4f6;line-height:1.4;">${escapeHtml(signal.title)}</p>
                  </a>
                  <!-- Reliability + category row -->
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:11px;color:#6b7280;">
                        Reliability:&nbsp;<span style="color:${reliabilityColor};font-weight:600;">${reliabilityPct}%</span>
                        &nbsp;&middot;&nbsp;
                        <span style="color:#4b5563;text-transform:capitalize;">${escapeHtml(signal.category ?? 'other')}</span>
                      </td>
                      <td align="right">
                        <a href="${signalUrl}" style="font-size:11px;color:#f59e0b;font-weight:600;text-decoration:none;">View &rarr;</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>`
}

// ─── HTML digest builder ───────────────────────────────────────────────────

export function buildDigestHtml(
  signals: Signal[],
  period: { from: Date; to: Date },
  unsubscribeEmail?: string,
): string {
  const top10      = signals.slice(0, 10)
  const dateRange  = formatDateRange(period.from, period.to)
  const grouped    = groupByCategory(top10)

  const unsubscribeUrl = unsubscribeEmail
    ? `https://world-pulse.io/api/v1/digest/unsubscribe?email=${encodeURIComponent(unsubscribeEmail)}`
    : 'https://world-pulse.io/settings/notifications'

  let categorySections = ''
  for (const [category, catSignals] of grouped) {
    const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1)
    categorySections += `
          <!-- Category: ${escapeHtml(categoryLabel)} -->
          <tr>
            <td style="padding:16px 0 8px 0;">
              <span style="font-size:10px;font-weight:700;color:#f59e0b;letter-spacing:0.12em;text-transform:uppercase;">${escapeHtml(categoryLabel)}</span>
            </td>
          </tr>
          ${catSignals.map(signalCardHtml).join('')}`
  }

  const signalCount = top10.length

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>WorldPulse Weekly Intelligence Briefing</title>
</head>
<body style="margin:0;padding:0;background-color:#06070d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#06070d;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="padding-bottom:8px;">
              <span style="font-size:24px;font-weight:700;color:#f59e0b;letter-spacing:-0.5px;">WorldPulse</span>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:4px;">
              <span style="font-size:16px;font-weight:600;color:#f3f4f6;">Weekly Intelligence Briefing</span>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:24px;border-bottom:1px solid #1f2937;">
              <span style="font-size:12px;color:#6b7280;">${escapeHtml(dateRange)}</span>
              <span style="font-size:12px;color:#4b5563;margin-left:12px;">${signalCount} signal${signalCount !== 1 ? 's' : ''} curated</span>
            </td>
          </tr>

          <!-- Intro -->
          <tr>
            <td style="padding:20px 0 4px 0;">
              <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">
                Your curated intelligence briefing for the past week — the top verified signals ranked by reliability and severity.
              </p>
            </td>
          </tr>

          <!-- Signal sections -->
          <table width="100%" cellpadding="0" cellspacing="0">
            ${categorySections}
          </table>

          <!-- CTA -->
          <tr>
            <td style="padding:20px 0;border-top:1px solid #1f2937;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color:#f59e0b;border-radius:8px;">
                    <a href="https://world-pulse.io/signals"
                       style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#000000;text-decoration:none;">
                      View All Signals &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:16px;border-top:1px solid #111827;text-align:center;">
              <p style="margin:0 0 6px;font-size:11px;color:#374151;">
                You're receiving this because you subscribed to WorldPulse digest emails.
              </p>
              <p style="margin:0;">
                <a href="${unsubscribeUrl}" style="font-size:11px;color:#6b7280;text-decoration:underline;">Unsubscribe</a>
                &nbsp;&middot;&nbsp;
                <a href="https://world-pulse.io/settings/notifications" style="font-size:11px;color:#6b7280;text-decoration:underline;">Manage preferences</a>
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

// ─── Plain text digest builder ─────────────────────────────────────────────

export function buildDigestText(
  signals: Signal[],
  period: { from: Date; to: Date },
  unsubscribeEmail?: string,
): string {
  const top10     = signals.slice(0, 10)
  const dateRange = formatDateRange(period.from, period.to)

  const unsubscribeUrl = unsubscribeEmail
    ? `https://world-pulse.io/api/v1/digest/unsubscribe?email=${encodeURIComponent(unsubscribeEmail)}`
    : 'https://world-pulse.io/settings/notifications'

  const lines: string[] = [
    'WorldPulse Weekly Intelligence Briefing',
    dateRange,
    '─'.repeat(50),
    '',
  ]

  const grouped = groupByCategory(top10)
  for (const [category, catSignals] of grouped) {
    lines.push(`[ ${category.toUpperCase()} ]`, '')
    for (const s of catSignals) {
      const reliabilityPct = Math.round(s.reliabilityScore * 100)
      const location       = s.locationName ?? s.countryCode ?? 'Unknown'
      lines.push(
        `${SEVERITY_LABELS[s.severity]} — ${s.title}`,
        `Location: ${location}  |  Reliability: ${reliabilityPct}%`,
        `https://world-pulse.io/signals/${s.id}`,
        '',
      )
    }
  }

  lines.push(
    '─'.repeat(50),
    'View all signals: https://world-pulse.io/signals',
    '',
    `Unsubscribe: ${unsubscribeUrl}`,
    'Manage preferences: https://world-pulse.io/settings/notifications',
  )

  return lines.join('\n')
}

// ─── Resend payload ─────────────────────────────────────────────────────────

interface ResendPayload {
  from:      string
  to:        string[]
  subject:   string
  html:      string
  text:      string
  reply_to?: string
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Send a weekly digest email via the Resend REST API.
 *
 * Fire-and-forget — errors are logged internally and never thrown.
 * Returns early (no-op) if RESEND_API_KEY is not configured.
 */
export async function sendDigestEmail(
  to: string,
  signals: Signal[],
  period: { from: Date; to: Date },
): Promise<void> {
  if (!DIGEST_EMAIL_CONFIGURED) {
    logger.debug('sendDigestEmail: RESEND_API_KEY not set — skipping digest dispatch')
    return
  }

  const dateRange = formatDateRange(period.from, period.to)
  const subject   = `WorldPulse Weekly Intelligence Briefing — ${dateRange}`

  const payload: ResendPayload = {
    from:    FROM_ADDRESS,
    to:      [to],
    subject,
    html:    buildDigestHtml(signals, period, to),
    text:    buildDigestText(signals, period, to),
  }

  if (REPLY_TO) {
    payload.reply_to = REPLY_TO
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body:   JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      logger.warn({ status: res.status, body, to }, 'sendDigestEmail: Resend API error')
      return
    }

    const data = await res.json() as { id?: string }
    logger.debug({ to, messageId: data.id }, 'Digest email sent via Resend')
  } catch (err) {
    logger.error({ err, to }, 'sendDigestEmail: request failed')
  }
}

// ─── Severity filter helper ─────────────────────────────────────────────────

/**
 * Filter signals to those meeting or exceeding the minimum severity level.
 */
export function filterBySeverity(signals: Signal[], minSeverity: SignalSeverity): Signal[] {
  const minRank = SEVERITY_RANK[minSeverity] ?? 1
  return signals.filter(s => (SEVERITY_RANK[s.severity] ?? 1) >= minRank)
}
