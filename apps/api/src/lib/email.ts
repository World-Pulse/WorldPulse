import type { Signal, SignalSeverity } from '@worldpulse/types'
import { logger } from './logger'

// ─── Config ────────────────────────────────────────────────────────────────
//
// WorldPulse email dispatch uses the Resend REST API (https://resend.com).
// Set RESEND_API_KEY in your .env to enable email alerts.
// Falls back gracefully — no email sent if the key is absent.
//
// Env vars:
//   RESEND_API_KEY      — Resend API key (required to send email)
//   EMAIL_FROM_ADDRESS  — From address (default: WorldPulse Alerts <alerts@world-pulse.io>)
//   EMAIL_REPLY_TO      — Reply-to address (optional)

const RESEND_API_KEY = process.env.RESEND_API_KEY    ?? ''
const FROM_ADDRESS   = process.env.EMAIL_FROM_ADDRESS ?? 'WorldPulse Alerts <alerts@world-pulse.io>'
const REPLY_TO       = process.env.EMAIL_REPLY_TO     ?? ''
const RESEND_API_URL = 'https://api.resend.com/emails'

/** True when RESEND_API_KEY is configured and email dispatch is enabled. */
export const EMAIL_CONFIGURED: boolean = RESEND_API_KEY !== ''

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

// ─── HTML builder ──────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function buildHtml(signal: Signal): string {
  const severityColor  = SEVERITY_COLORS[signal.severity]
  const severityLabel  = SEVERITY_LABELS[signal.severity]
  const reliabilityPct = Math.round(signal.reliabilityScore * 100)
  const location       = signal.locationName ?? signal.countryCode ?? 'Unknown'
  const summary        = signal.summary ?? signal.title
  const signalUrl      = `https://world-pulse.io/signals/${signal.id}`

  const reliabilityColor =
    reliabilityPct >= 80 ? '#22c55e' :
    reliabilityPct >= 50 ? '#eab308' :
                           '#ef4444'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>WorldPulse Alert</title>
</head>
<body style="margin:0;padding:0;background-color:#06070d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#06070d;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="padding-bottom:24px;">
              <span style="font-size:22px;font-weight:700;color:#f59e0b;letter-spacing:-0.5px;">WorldPulse</span>
              <span style="font-size:14px;color:#6b7280;margin-left:8px;">Intelligence Alert</span>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background-color:#0f1117;border-radius:12px;border:1px solid #1f2937;padding:28px;">
              <!-- Severity badge -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
                <tr>
                  <td style="background-color:${severityColor}20;border:1px solid ${severityColor}40;border-radius:6px;padding:4px 10px;">
                    <span style="font-size:11px;font-weight:700;color:${severityColor};letter-spacing:0.08em;">${severityLabel}</span>
                  </td>
                </tr>
              </table>
              <!-- Title -->
              <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#f3f4f6;line-height:1.3;">${escapeHtml(signal.title)}</h1>
              <!-- Summary -->
              <p style="margin:0 0 20px;font-size:14px;color:#9ca3af;line-height:1.6;">${escapeHtml(summary)}</p>
              <!-- Location -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                <tr>
                  <td style="font-size:13px;color:#6b7280;">
                    &#127758; &nbsp;${escapeHtml(location)}
                  </td>
                </tr>
              </table>
              <!-- Reliability score -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="padding-bottom:6px;">
                    <span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;">Reliability Score</span>
                    <span style="font-size:12px;color:${reliabilityColor};font-weight:600;margin-left:8px;">${reliabilityPct}%</span>
                  </td>
                </tr>
                <tr>
                  <td style="background-color:#1f2937;border-radius:4px;height:6px;overflow:hidden;">
                    <div style="background-color:${reliabilityColor};height:6px;width:${reliabilityPct}%;border-radius:4px;max-width:100%;"></div>
                  </td>
                </tr>
              </table>
              <!-- CTA -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color:#f59e0b;border-radius:8px;">
                    <a href="${signalUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#000000;text-decoration:none;">
                      View Signal &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding-top:20px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#374151;">
                You are receiving this because you enabled WorldPulse email alerts.
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

// ─── Plain text builder ────────────────────────────────────────────────────

function buildText(signal: Signal): string {
  const location       = signal.locationName ?? signal.countryCode ?? 'Unknown'
  const summary        = signal.summary ?? signal.title
  const reliabilityPct = Math.round(signal.reliabilityScore * 100)
  const signalUrl      = `https://world-pulse.io/signals/${signal.id}`

  return [
    `WorldPulse Alert — ${SEVERITY_LABELS[signal.severity]}`,
    '',
    signal.title,
    '',
    summary,
    '',
    `Location:          ${location}`,
    `Reliability Score: ${reliabilityPct}%`,
    `Category:          ${signal.category}`,
    '',
    `View Signal: ${signalUrl}`,
    '',
    '---',
    'Manage preferences: https://world-pulse.io/settings/notifications',
  ].join('\n')
}

// ─── Resend API payload type ───────────────────────────────────────────────

interface ResendPayload {
  from:       string
  to:         string[]
  subject:    string
  html:       string
  text:       string
  reply_to?:  string
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Send an alert email for a signal via the Resend REST API.
 *
 * Fire-and-forget — errors are logged internally and never thrown.
 * Returns early (no-op) if RESEND_API_KEY is not configured.
 */
export async function sendAlertEmail(to: string, signal: Signal): Promise<void> {
  if (!EMAIL_CONFIGURED) {
    logger.debug('sendAlertEmail: RESEND_API_KEY not set — skipping email dispatch')
    return
  }

  const subject = `[${SEVERITY_LABELS[signal.severity]}] ${signal.title}`

  const payload: ResendPayload = {
    from:    FROM_ADDRESS,
    to:      [to],
    subject,
    html:    buildHtml(signal),
    text:    buildText(signal),
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
      logger.warn({ status: res.status, body, to }, 'sendAlertEmail: Resend API error')
      return
    }

    const data = await res.json() as { id?: string }
    logger.debug({ to, messageId: data.id }, 'Alert email sent via Resend')
  } catch (err) {
    logger.error({ err, to }, 'sendAlertEmail: request failed')
  }
}
