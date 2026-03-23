import type { Signal } from '@worldpulse/types'
import { logger } from './logger'

// ─── Types ─────────────────────────────────────────────────────────────────

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🔴',
  high:     '🟠',
  medium:   '🟡',
  low:      '🟢',
  info:     '⚪',
}

const DISCORD_COLORS: Record<string, number> = {
  critical: 16711680, // #ff0000
  high:     16744448, // #ff6600
  medium:   16776960, // #ffff00
  low:      65280,    // #00ff00
  info:     8421504,  // #808080
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
}

// ─── Singleton ─────────────────────────────────────────────────────────────

export const notificationService = new NotificationService()
export { NotificationService }
