/**
 * Alert Rule Matching Engine
 *
 * Checks new signals against user-defined alert rules and dispatches
 * notifications via email and in-app channels.
 *
 * Called from the flash brief publisher when new signals arrive.
 */

import { db } from '../db/postgres'
import { logger } from './logger'

const log = logger.child({ module: 'alert-matcher' })

const SEVERITY_RANK: Record<string, number> = {
  critical: 4, high: 3, medium: 2, low: 1, info: 0,
}

interface SignalForMatching {
  id: string
  title: string
  category: string
  severity: string
  country_code?: string
  region?: string
  tags?: string[]
  reliability_score?: number
}

interface AlertRule {
  id: string
  user_id: string
  name: string
  min_severity: string
  categories: string[]
  regions: string[]
  country_codes: string[]
  keywords: string[]
  notify_email: boolean
  notify_in_app: boolean
  notify_push: boolean
  cooldown_minutes: number
  last_triggered_at: Date | null
}

/**
 * Check a signal against all active alert rules and dispatch notifications.
 * Returns the number of alerts triggered.
 */
export async function matchSignalToAlertRules(signal: SignalForMatching): Promise<number> {
  // Fetch all enabled rules
  const rules: AlertRule[] = await db('alert_rules')
    .where('enabled', true)
    .select('*')

  if (rules.length === 0) return 0

  let triggered = 0

  for (const rule of rules) {
    if (!matchesRule(signal, rule)) continue
    if (isInCooldown(rule)) continue

    try {
      await dispatchAlert(rule, signal)
      triggered++

      // Update rule trigger tracking
      await db('alert_rules')
        .where('id', rule.id)
        .update({
          last_triggered_at: db.raw('NOW()'),
          trigger_count: db.raw('trigger_count + 1'),
        })
    } catch (err) {
      log.warn({ err, ruleId: rule.id, signalId: signal.id }, 'Alert dispatch failed')
    }
  }

  if (triggered > 0) {
    log.info({
      signalId: signal.id,
      title: signal.title.slice(0, 80),
      triggered,
    }, `Alert rules matched: ${triggered} notification(s) dispatched`)
  }

  return triggered
}

function matchesRule(signal: SignalForMatching, rule: AlertRule): boolean {
  // Severity check — signal must meet minimum severity
  const signalRank = SEVERITY_RANK[signal.severity] ?? 0
  const ruleMinRank = SEVERITY_RANK[rule.min_severity] ?? 4
  if (signalRank < ruleMinRank) return false

  // Category check — if rule has categories, signal must match one
  if (rule.categories && rule.categories.length > 0) {
    if (!rule.categories.includes(signal.category)) return false
  }

  // Country code check
  if (rule.country_codes && rule.country_codes.length > 0) {
    if (!signal.country_code || !rule.country_codes.includes(signal.country_code)) return false
  }

  // Region check (broader than country)
  if (rule.regions && rule.regions.length > 0) {
    if (!signal.region || !rule.regions.includes(signal.region)) return false
  }

  // Keyword check — any keyword must appear in title
  if (rule.keywords && rule.keywords.length > 0) {
    const titleLower = signal.title.toLowerCase()
    const matched = rule.keywords.some(kw => titleLower.includes(kw.toLowerCase()))
    if (!matched) return false
  }

  return true
}

function isInCooldown(rule: AlertRule): boolean {
  if (!rule.last_triggered_at) return false
  const cooldownMs = rule.cooldown_minutes * 60 * 1000
  const elapsed = Date.now() - new Date(rule.last_triggered_at).getTime()
  return elapsed < cooldownMs
}

async function dispatchAlert(rule: AlertRule, signal: SignalForMatching): Promise<void> {
  const channels: string[] = []

  // In-app notification
  if (rule.notify_in_app) {
    await db('notifications').insert({
      user_id: rule.user_id,
      type: 'alert_match',
      title: `Alert: ${signal.title.slice(0, 120)}`,
      body: `Matched rule "${rule.name}" — ${signal.severity.toUpperCase()} ${signal.category}`,
      link: `/signals/${signal.id}`,
      signal_id: signal.id,
      rule_id: rule.id,
    })
    channels.push('in_app')
  }

  // Email notification — reuse existing Resend infrastructure
  if (rule.notify_email) {
    try {
      const user = await db('users').where('id', rule.user_id).first('email')
      if (user?.email) {
        // Import dynamically to avoid circular deps
        const { sendAlertEmail } = await import('./pulse/alert-email')
        await sendAlertEmail({
          to: user.email,
          ruleName: rule.name,
          signal: {
            title: signal.title,
            category: signal.category,
            severity: signal.severity,
            id: signal.id,
          },
        })
        channels.push('email')
      }
    } catch (err) {
      log.warn({ err }, 'Alert email dispatch failed')
    }
  }

  // Record in alert history
  await db('alert_history').insert({
    rule_id: rule.id,
    user_id: rule.user_id,
    signal_id: signal.id,
    channels,
  })
}
