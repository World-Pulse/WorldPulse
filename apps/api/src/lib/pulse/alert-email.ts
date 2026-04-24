/**
 * Alert Rule Email Notifications
 *
 * Sends formatted email when a user's alert rule matches a new signal.
 * Uses Resend (same as morning briefing emails).
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
const FROM_EMAIL = process.env.FROM_EMAIL || 'alerts@world-pulse.io'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://world-pulse.io'

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#3b82f6',
  info: '#6b7280',
}

export async function sendAlertEmail(params: {
  to: string
  ruleName: string
  signal: {
    title: string
    category: string
    severity: string
    id: string
  }
}): Promise<void> {
  if (!RESEND_API_KEY) return

  const sevColor = SEVERITY_COLORS[params.signal.severity] || '#6b7280'
  const signalUrl = `${SITE_URL}/signals/${params.signal.id}`

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0f1a; color: #e2e8f0; padding: 24px; border-radius: 8px;">
      <div style="border-left: 4px solid ${sevColor}; padding-left: 16px; margin-bottom: 20px;">
        <div style="font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">
          ${params.signal.severity.toUpperCase()} ALERT
        </div>
        <h2 style="margin: 0; font-size: 18px; color: #f1f5f9;">${params.signal.title}</h2>
      </div>
      <div style="background: #1e293b; padding: 12px 16px; border-radius: 6px; margin-bottom: 20px;">
        <span style="color: #94a3b8;">Rule:</span> <strong>${params.ruleName}</strong><br/>
        <span style="color: #94a3b8;">Category:</span> ${params.signal.category}<br/>
        <span style="color: #94a3b8;">Severity:</span>
        <span style="color: ${sevColor}; font-weight: bold;">${params.signal.severity.toUpperCase()}</span>
      </div>
      <a href="${signalUrl}" style="display: inline-block; background: #d97706; color: #0a0f1a; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold;">
        View Signal
      </a>
      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #1e293b; font-size: 12px; color: #64748b;">
        WorldPulse Alert — <a href="${SITE_URL}/settings/alerts" style="color: #d97706;">Manage your alert rules</a>
      </div>
    </div>
  `

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `WorldPulse Alerts <${FROM_EMAIL}>`,
      to: params.to,
      subject: `[${params.signal.severity.toUpperCase()}] ${params.signal.title.slice(0, 100)}`,
      html,
    }),
  })
}
