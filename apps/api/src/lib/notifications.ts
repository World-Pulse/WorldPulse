import type { Signal, AlertTier } from '@worldpulse/types'
import { logger } from './logger'

// ─── Types ─────────────────────────────────────────────────────────────────

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🔴',
  high:     '🟠',
  medium:   '🟡',
  low:      '🟢',
  info:     '⚪',
}

const ALERT_TIER_EMOJI: Record<AlertTier, string> = {
  FLASH:    '⚡',
  PRIORITY: '🔶',
  ROUTINE:  '📋',
}

const ALERT_TIER_LABEL: Record<AlertTier, string> = {
  FLASH:    'FLASH ALERT',
  PRIORITY: 'PRIORITY',
  ROUTINE:  'ROUTINE',
}

const ALERT_TIER_DISCORD_COLOR: Record<AlertTier, number> = {
  FLASH:    16711680,  // #ff0000 — red
  PRIORITY: 16744448,  // #ff6600 — orange
  ROUTINE:  8421504,   // #808080 — grey
}

const DISCORD_COLORS: Record<string, number> = {
  critical: 16711680, // #ff0000
  high:     16744448, // #ff6600
  medium:   16776960, // #ffff00
  low:      65280,    // #00ff00
  info:     8421504,  // #808080
}

// Slack Block Kit color bar (sidebar accent colour)
const SLACK_COLORS: Record<string, string> = {
  critical: '#FF0000',
  high:     '#FF6600',
  medium:   '#FFD700',
  low:      '#00CC44',
  info:     '#808080',
}

// MS Teams Adaptive Card theme colours
const TEAMS_COLORS: Record<string, string> = {
  critical: 'FF0000',
  high:     'FF6600',
  medium:   'FFD700',
  low:      '00CC44',
  info:     '808080',
}

function reliabilityDots(score: number): string {
  const filled = Math.round(score * 5)
  return '●'.repeat(filled) + '○'.repeat(5 - filled)
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ─── NotificationService ───────────────────────────────────────────────────

class NotificationService {
  /**
   * Format a signal as an HTML string suitable for Telegram (parse_mode: HTML).
   */
  formatSignalAlert(signal: Signal): string {
    const emoji     = SEVERITY_EMOJI[signal.severity] ?? '⚪'
    const dots      = reliabilityDots(signal.reliabilityScore)
    const category  = signal.category.charAt(0).toUpperCase() + signal.category.slice(1)
    const sourceUrl = signal.originalUrls[0] ?? signal.sources[0]?.url ?? ''

    const lines: string[] = [
      `${emoji} <b>${escapeHtml(signal.title)}</b>`,
      '',
      `📂 <b>Category:</b> ${escapeHtml(category)}`,
      `📊 <b>Reliability:</b> ${dots} (${Math.round(signal.reliabilityScore * 100)}%)`,
    ]

    if (signal.locationName) {
      lines.push(`📍 <b>Location:</b> ${escapeHtml(signal.locationName)}`)
    }

    if (signal.summary) {
      lines.push('', escapeHtml(signal.summary.slice(0, 280)))
    }

    if (sourceUrl) {
      lines.push('', `🔗 <a href="${escapeHtml(sourceUrl)}">View Source</a>`)
    }

    return lines.join('\n')
  }

  /**
   * Send a pre-formatted HTML message to a Telegram chat.
   * Use formatSignalAlert() to produce the text from a Signal.
   * Fire-and-forget: logs failures but never throws.
   */
  async sendTelegramMessage(
    chatId: string,
    text: string,
    token: string,
  ): Promise<void> {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id:                 chatId,
            text,
            parse_mode:              'HTML',
            disable_web_page_preview: false,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      )

      if (!res.ok) {
        const body = await res.text()
        logger.warn({ chatId, status: res.status, body }, 'Telegram sendMessage failed')
      }
    } catch (err) {
      logger.warn({ err, chatId }, 'Telegram sendMessage error')
    }
  }

  /**
   * Send a formatted signal alert as a Discord embed via webhook.
   * Fire-and-forget: logs failures but never throws.
   */
  async sendDiscordMessage(webhookUrl: string, signal: Signal): Promise<void> {
    const color     = DISCORD_COLORS[signal.severity] ?? 8421504
    const emoji     = SEVERITY_EMOJI[signal.severity] ?? '⚪'
    const category  = signal.category.charAt(0).toUpperCase() + signal.category.slice(1)
    const sourceUrl = signal.originalUrls[0] ?? signal.sources[0]?.url ?? ''

    const embed = {
      title:       `${emoji} ${signal.title}`,
      description: signal.summary?.slice(0, 350) ?? undefined,
      color,
      fields: [
        { name: 'Category',    value: category,                                                                           inline: true },
        { name: 'Severity',    value: signal.severity.toUpperCase(),                                                      inline: true },
        { name: 'Reliability', value: `${reliabilityDots(signal.reliabilityScore)} ${Math.round(signal.reliabilityScore * 100)}%`, inline: true },
        ...(signal.locationName
          ? [{ name: 'Location', value: signal.locationName, inline: true }]
          : []),
        ...(sourceUrl
          ? [{ name: 'Source', value: `[View](${sourceUrl})`, inline: true }]
          : []),
      ],
      timestamp: signal.createdAt,
      footer:    { text: 'WorldPulse Intelligence Network' },
    }

    try {
      const res = await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ embeds: [embed] }),
        signal:  AbortSignal.timeout(10_000),
      })

      if (!res.ok) {
        const body = await res.text()
        logger.warn({ status: res.status, body }, 'Discord webhook failed')
      }
    } catch (err) {
      logger.warn({ err }, 'Discord webhook error')
    }
  }

  // ─── Slack ────────────────────────────────────────────────────────────────

  /**
   * Send a formatted signal alert to a Slack channel via Incoming Webhook.
   * Uses Block Kit layout for rich formatting.
   * Fire-and-forget: logs failures but never throws.
   */
  async sendSlackMessage(webhookUrl: string, signal: Signal): Promise<void> {
    const emoji     = SEVERITY_EMOJI[signal.severity] ?? '⚪'
    const color     = SLACK_COLORS[signal.severity] ?? '#808080'
    const category  = signal.category.charAt(0).toUpperCase() + signal.category.slice(1)
    const sourceUrl = signal.originalUrls[0] ?? signal.sources[0]?.url ?? ''
    const dots      = reliabilityDots(signal.reliabilityScore)
    const pct       = Math.round(signal.reliabilityScore * 100)

    // Build Slack attachment (Block Kit attachments for coloured sidebar)
    const fields: Array<{ type: string; text: string }> = [
      { type: 'mrkdwn', text: `*Category:*\n${category}` },
      { type: 'mrkdwn', text: `*Severity:*\n${signal.severity.toUpperCase()}` },
      { type: 'mrkdwn', text: `*Reliability:*\n${dots} ${pct}%` },
    ]

    if (signal.locationName) {
      fields.push({ type: 'mrkdwn', text: `*Location:*\n${signal.locationName}` })
    }

    const blocks: unknown[] = [
      {
        type: 'header',
        text: {
          type:  'plain_text',
          text:  `${emoji} ${signal.title}`.slice(0, 150),
          emoji: true,
        },
      },
      {
        type:   'section',
        fields: fields.slice(0, 10), // Slack max 10 fields per section
      },
    ]

    if (signal.summary) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: signal.summary.slice(0, 3000),
        },
      })
    }

    if (sourceUrl) {
      blocks.push({
        type:     'actions',
        elements: [
          {
            type:  'button',
            text:  { type: 'plain_text', text: '🔗 View Source', emoji: true },
            url:   sourceUrl,
            style: 'primary',
          },
        ],
      })
    }

    blocks.push({ type: 'divider' })

    const payload = {
      // attachments wrapper gives us the coloured left border
      attachments: [
        {
          color,
          blocks,
          footer:     'WorldPulse Intelligence Network',
          footer_icon: 'https://worldpulse.io/favicon.ico',
          ts:         Math.floor(new Date(signal.createdAt).getTime() / 1000).toString(),
        },
      ],
    }

    try {
      const res = await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(10_000),
      })

      if (!res.ok) {
        const body = await res.text()
        logger.warn({ status: res.status, body }, 'Slack webhook failed')
      }
    } catch (err) {
      logger.warn({ err }, 'Slack webhook error')
    }
  }

  // ─── Microsoft Teams ──────────────────────────────────────────────────────

  /**
   * Send a formatted signal alert to a Microsoft Teams channel via Incoming Webhook.
   * Uses MessageCard format (compatible with all Teams versions).
   * Fire-and-forget: logs failures but never throws.
   */
  async sendTeamsMessage(webhookUrl: string, signal: Signal): Promise<void> {
    const emoji     = SEVERITY_EMOJI[signal.severity] ?? '⚪'
    const color     = TEAMS_COLORS[signal.severity] ?? '808080'
    const category  = signal.category.charAt(0).toUpperCase() + signal.category.slice(1)
    const sourceUrl = signal.originalUrls[0] ?? signal.sources[0]?.url ?? ''
    const pct       = Math.round(signal.reliabilityScore * 100)

    const facts: Array<{ name: string; value: string }> = [
      { name: 'Category',    value: category },
      { name: 'Severity',    value: signal.severity.toUpperCase() },
      { name: 'Reliability', value: `${reliabilityDots(signal.reliabilityScore)} ${pct}%` },
    ]

    if (signal.locationName) {
      facts.push({ name: 'Location', value: signal.locationName })
    }

    const potentialAction: unknown[] = []
    if (sourceUrl) {
      potentialAction.push({
        '@type': 'OpenUri',
        name:    'View Source',
        targets: [{ os: 'default', uri: sourceUrl }],
      })
    }

    const payload: Record<string, unknown> = {
      '@type':     'MessageCard',
      '@context':  'http://schema.org/extensions',
      themeColor:  color,
      summary:     `${emoji} ${signal.title}`,
      sections:    [
        {
          activityTitle:    `${emoji} **${signal.title}**`,
          activitySubtitle: `WorldPulse Intelligence Network • ${new Date(signal.createdAt).toUTCString()}`,
          activityText:     signal.summary?.slice(0, 500) ?? '',
          facts,
        },
      ],
    }

    if (potentialAction.length > 0) {
      payload['potentialAction'] = potentialAction
    }

    try {
      const res = await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(10_000),
      })

      if (!res.ok) {
        const body = await res.text()
        logger.warn({ status: res.status, body }, 'Teams webhook failed')
      }
    } catch (err) {
      logger.warn({ err }, 'Teams webhook error')
    }
  }

  // ─── Tier-Aware Formatting ──────────────────────────────────────────────

  /**
   * Build a tier-aware prefix string for alert messages.
   * FLASH → "⚡ FLASH ALERT", PRIORITY → "🔶 PRIORITY", ROUTINE → (none)
   */
  tierPrefix(tier: AlertTier): string {
    if (tier === 'ROUTINE') return ''
    return `${ALERT_TIER_EMOJI[tier]} ${ALERT_TIER_LABEL[tier]}`
  }

  /**
   * Format a signal as Telegram HTML with alert tier banner.
   * FLASH signals get a prominent ⚡ FLASH ALERT banner at the top.
   */
  formatTieredTelegramAlert(signal: Signal, tier: AlertTier): string {
    const prefix = this.tierPrefix(tier)
    const emoji     = SEVERITY_EMOJI[signal.severity] ?? '⚪'
    const dots      = reliabilityDots(signal.reliabilityScore)
    const category  = signal.category.charAt(0).toUpperCase() + signal.category.slice(1)
    const sourceUrl = signal.originalUrls[0] ?? signal.sources[0]?.url ?? ''

    const lines: string[] = []

    if (prefix) {
      lines.push(`<b>━━━ ${escapeHtml(prefix)} ━━━</b>`, '')
    }

    lines.push(
      `${emoji} <b>${escapeHtml(signal.title)}</b>`,
      '',
      `📂 <b>Category:</b> ${escapeHtml(category)}`,
      `📊 <b>Reliability:</b> ${dots} (${Math.round(signal.reliabilityScore * 100)}%)`,
      `🏷️ <b>Tier:</b> ${escapeHtml(tier)}`,
    )

    if (signal.locationName) {
      lines.push(`📍 <b>Location:</b> ${escapeHtml(signal.locationName)}`)
    }

    if (signal.summary) {
      lines.push('', escapeHtml(signal.summary.slice(0, 280)))
    }

    if (sourceUrl) {
      lines.push('', `🔗 <a href="${escapeHtml(sourceUrl)}">View Source</a>`)
    }

    return lines.join('\n')
  }

  /**
   * Send a tier-aware Discord embed with FLASH/PRIORITY banner styling.
   * FLASH embeds are red with bold "⚡ FLASH ALERT" in the author field.
   * PRIORITY embeds are orange with "🔶 PRIORITY" in the author field.
   */
  async sendTieredDiscordMessage(
    webhookUrl: string,
    signal: Signal,
    tier: AlertTier,
  ): Promise<void> {
    const color     = tier !== 'ROUTINE'
      ? ALERT_TIER_DISCORD_COLOR[tier]
      : (DISCORD_COLORS[signal.severity] ?? 8421504)
    const emoji     = SEVERITY_EMOJI[signal.severity] ?? '⚪'
    const category  = signal.category.charAt(0).toUpperCase() + signal.category.slice(1)
    const sourceUrl = signal.originalUrls[0] ?? signal.sources[0]?.url ?? ''
    const prefix    = this.tierPrefix(tier)

    const embed: Record<string, unknown> = {
      title:       `${emoji} ${signal.title}`,
      description: signal.summary?.slice(0, 350) ?? undefined,
      color,
      fields: [
        ...(prefix ? [{ name: 'Alert Tier', value: prefix, inline: true }] : []),
        { name: 'Category',    value: category,                                                                                  inline: true },
        { name: 'Severity',    value: signal.severity.toUpperCase(),                                                             inline: true },
        { name: 'Reliability', value: `${reliabilityDots(signal.reliabilityScore)} ${Math.round(signal.reliabilityScore * 100)}%`, inline: true },
        ...(signal.locationName ? [{ name: 'Location', value: signal.locationName, inline: true }] : []),
        ...(sourceUrl           ? [{ name: 'Source', value: `[View](${sourceUrl})`, inline: true }] : []),
      ],
      timestamp: signal.createdAt,
      footer:    { text: 'WorldPulse Intelligence Network' },
    }

    try {
      const res = await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ embeds: [embed] }),
        signal:  AbortSignal.timeout(10_000),
      })

      if (!res.ok) {
        const body = await res.text()
        logger.warn({ status: res.status, body, tier }, 'Discord tiered webhook failed')
      }
    } catch (err) {
      logger.warn({ err, tier }, 'Discord tiered webhook error')
    }
  }

  /**
   * Send a tier-aware Slack message with FLASH/PRIORITY banner.
   */
  async sendTieredSlackMessage(
    webhookUrl: string,
    signal: Signal,
    tier: AlertTier,
  ): Promise<void> {
    const emoji     = SEVERITY_EMOJI[signal.severity] ?? '⚪'
    const color     = tier === 'FLASH' ? '#FF0000' : tier === 'PRIORITY' ? '#FF6600' : (SLACK_COLORS[signal.severity] ?? '#808080')
    const category  = signal.category.charAt(0).toUpperCase() + signal.category.slice(1)
    const sourceUrl = signal.originalUrls[0] ?? signal.sources[0]?.url ?? ''
    const dots      = reliabilityDots(signal.reliabilityScore)
    const pct       = Math.round(signal.reliabilityScore * 100)
    const prefix    = this.tierPrefix(tier)

    const fields: Array<{ type: string; text: string }> = [
      ...(prefix ? [{ type: 'mrkdwn', text: `*Alert Tier:*\n${prefix}` }] : []),
      { type: 'mrkdwn', text: `*Category:*\n${category}` },
      { type: 'mrkdwn', text: `*Severity:*\n${signal.severity.toUpperCase()}` },
      { type: 'mrkdwn', text: `*Reliability:*\n${dots} ${pct}%` },
    ]

    if (signal.locationName) {
      fields.push({ type: 'mrkdwn', text: `*Location:*\n${signal.locationName}` })
    }

    const headerText = prefix
      ? `${prefix} — ${emoji} ${signal.title}`
      : `${emoji} ${signal.title}`

    const blocks: unknown[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: headerText.slice(0, 150), emoji: true },
      },
      { type: 'section', fields: fields.slice(0, 10) },
    ]

    if (signal.summary) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: signal.summary.slice(0, 3000) } })
    }

    if (sourceUrl) {
      blocks.push({
        type:     'actions',
        elements: [{ type: 'button', text: { type: 'plain_text', text: '🔗 View Source', emoji: true }, url: sourceUrl, style: 'primary' }],
      })
    }

    blocks.push({ type: 'divider' })

    try {
      const res = await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          attachments: [{ color, blocks, footer: 'WorldPulse Intelligence Network', ts: Math.floor(new Date(signal.createdAt).getTime() / 1000).toString() }],
        }),
        signal: AbortSignal.timeout(10_000),
      })

      if (!res.ok) {
        const body = await res.text()
        logger.warn({ status: res.status, body, tier }, 'Slack tiered webhook failed')
      }
    } catch (err) {
      logger.warn({ err, tier }, 'Slack tiered webhook error')
    }
  }

  /**
   * Send a tier-aware Microsoft Teams message.
   */
  async sendTieredTeamsMessage(
    webhookUrl: string,
    signal: Signal,
    tier: AlertTier,
  ): Promise<void> {
    const emoji     = SEVERITY_EMOJI[signal.severity] ?? '⚪'
    const color     = tier === 'FLASH' ? 'FF0000' : tier === 'PRIORITY' ? 'FF6600' : (TEAMS_COLORS[signal.severity] ?? '808080')
    const category  = signal.category.charAt(0).toUpperCase() + signal.category.slice(1)
    const sourceUrl = signal.originalUrls[0] ?? signal.sources[0]?.url ?? ''
    const pct       = Math.round(signal.reliabilityScore * 100)
    const prefix    = this.tierPrefix(tier)

    const facts: Array<{ name: string; value: string }> = [
      ...(prefix ? [{ name: 'Alert Tier', value: prefix }] : []),
      { name: 'Category',    value: category },
      { name: 'Severity',    value: signal.severity.toUpperCase() },
      { name: 'Reliability', value: `${reliabilityDots(signal.reliabilityScore)} ${pct}%` },
    ]

    if (signal.locationName) facts.push({ name: 'Location', value: signal.locationName })

    const title = prefix ? `${prefix} — ${emoji} ${signal.title}` : `${emoji} ${signal.title}`

    const payload: Record<string, unknown> = {
      '@type':    'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor: color,
      summary:    title,
      sections:   [{
        activityTitle:    `**${title}**`,
        activitySubtitle: `WorldPulse Intelligence Network • ${new Date(signal.createdAt).toUTCString()}`,
        activityText:     signal.summary?.slice(0, 500) ?? '',
        facts,
      }],
    }

    if (sourceUrl) {
      payload['potentialAction'] = [{ '@type': 'OpenUri', name: 'View Source', targets: [{ os: 'default', uri: sourceUrl }] }]
    }

    try {
      const res = await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(10_000),
      })

      if (!res.ok) {
        const body = await res.text()
        logger.warn({ status: res.status, body, tier }, 'Teams tiered webhook failed')
      }
    } catch (err) {
      logger.warn({ err, tier }, 'Teams tiered webhook error')
    }
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────

export const notificationService = new NotificationService()
export { NotificationService }
