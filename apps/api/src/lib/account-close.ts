/**
 * Closing an account (Settings → Danger Zone → Close account; Devon, Nov 11, 2026: "Don't fully delete accounts").
 *
 * Nothing is deleted. The account is marked closed with the columns users already has (suspended, suspended_at,
 * suspension_reason = CLOSED_REASON), so support can open it again by hand. Closing signs it out on every device and
 * stops everything that acts for it: its API keys, email alerts, alert rules, the email digest to its address, its
 * webhooks, its app's push alerts and its alert channels (Telegram, Discord, Slack, Teams). Its posts and profile stay.
 * Browser alerts are not part of an account (routes/push.ts), so they stay as the browser set them.
 *
 * To have the data erased, the owner emails support@world-pulse.io, as the privacy policy says (world-pulse.io/privacy).
 */
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { endSessions } from './sessions'

/** users.suspension_reason of an account its owner closed (an admin's suspension has its own reason) */
export const CLOSED_REASON = 'closed by its owner'

export const CLOSED_DONE_TEXT = 'Your account is closed.'
export const CLOSED_SIGN_IN_TEXT =
  'This account was closed. To open it again, or to have its data erased, email support@world-pulse.io from its address.'
export const CLOSED_EMAIL_TAKEN_TEXT =
  'That email belongs to a closed account. To open it again, email support@world-pulse.io from that address.'
export const CLOSE_PRO_FIRST_TEXT =
  "You're on Pro: cancel it first on world-pulse.io/pricing (Manage subscription), then close the account."

/** Statuses of a subscription still running (as billing.ts's RUNNING): closing then would leave it charging */
const PRO_RUNNING = new Set(['active', 'trialing', 'past_due', 'incomplete'])

/** An account its owner closed (not one an admin suspended) */
export function isClosed(user: { suspended?: unknown; suspension_reason?: unknown } | null | undefined): boolean {
  return !!user && user.suspended === true && user.suspension_reason === CLOSED_REASON
}

/** A Pro plan that would go on charging: running, and not already set to end */
export function proStillRunning(sub: { plan?: unknown; status?: unknown; cancel_at_period_end?: unknown } | null | undefined): boolean {
  return !!sub && sub.plan === 'pro' && PRO_RUNNING.has(String(sub.status)) && sub.cancel_at_period_end !== true
}

/** What closing stopped, counted (for the log) */
export interface CloseResult {
  apiKeys:    number
  alerts:     number
  alertRules: number
  digests:    number
  webhooks:   number
  pushTokens: number
  channels:   boolean
  sessions:   number
}

/** Tables that may be missing where a migration never ran: each is looked for before it is changed */
const STOPPABLE = ['api_keys', 'alert_subscriptions', 'alert_rules', 'digest_subscriptions', 'developer_webhooks', 'device_push_tokens'] as const
type Stoppable = typeof STOPPABLE[number]

async function tablesThere(): Promise<Record<Stoppable, boolean>> {
  const res = await db.raw(`SELECT ${STOPPABLE.map(t => `to_regclass('public.${t}') IS NOT NULL AS "${t}"`).join(', ')}`) as { rows?: Array<Record<string, unknown>> }
  const row = res.rows?.[0] ?? {}
  return Object.fromEntries(STOPPABLE.map(t => [t, row[t] === true])) as Record<Stoppable, boolean>
}

/** Turns off the account's alert channels (Telegram, Discord, Slack, Teams), keeping what was set */
async function stopChannels(userId: string): Promise<boolean> {
  const key = `notif:${userId}:settings`
  const raw = await redis.get(key)
  if (!raw) return false
  let settings: Record<string, unknown>
  try { settings = JSON.parse(raw) as Record<string, unknown> } catch { return false }
  if (settings.enabled !== true) return false
  await redis.set(key, JSON.stringify({ ...settings, enabled: false }))
  return true
}

/**
 * Closes the account: marks it closed and stops what acts for it in one transaction (all or nothing), then turns off
 * its alert channels and signs it out everywhere. `email` is the account's address: a digest to it stops too.
 */
export async function closeAccount(userId: string, email: string | null | undefined, now: Date = new Date()): Promise<CloseResult> {
  const has = await tablesThere()
  const result: CloseResult = { apiKeys: 0, alerts: 0, alertRules: 0, digests: 0, webhooks: 0, pushTokens: 0, channels: false, sessions: 0 }
  const address = typeof email === 'string' && email.trim() !== '' ? email.trim().toLowerCase() : null

  await db.transaction(async (trx) => {
    await trx('users').where('id', userId).update({ suspended: true, suspended_at: now, suspension_reason: CLOSED_REASON, updated_at: now })
    if (has.api_keys) result.apiKeys = await trx('api_keys').where({ user_id: userId, is_active: true }).update({ is_active: false })
    if (has.alert_subscriptions) result.alerts = await trx('alert_subscriptions').where({ user_id: userId, active: true }).update({ active: false })
    if (has.alert_rules) result.alertRules = await trx('alert_rules').where({ user_id: userId, enabled: true }).update({ enabled: false, updated_at: now })
    if (has.digest_subscriptions) {
      result.digests = await trx('digest_subscriptions')
        .where('is_active', true)
        .where((q) => {
          q.where('user_id', userId)
          if (address) q.orWhereRaw('lower(email) = ?', [address])
        })
        .update({ is_active: false, updated_at: now })
    }
    if (has.developer_webhooks) result.webhooks = await trx('developer_webhooks').where({ user_id: userId, is_active: true }).update({ is_active: false })
    if (has.device_push_tokens) result.pushTokens = await trx('device_push_tokens').where({ user_id: userId, active: true }).update({ active: false, updated_at: now })
  })

  // After the transaction: the account is closed whatever happens here, and its sign-in already stops
  result.channels = await stopChannels(userId).catch(() => false)
  result.sessions = await endSessions(userId).catch(() => 0)
  return result
}
