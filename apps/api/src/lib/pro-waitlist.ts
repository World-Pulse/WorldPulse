/**
 * The Pro waitlist (plan 13; Devon, Oct 21, 2026: "Waitlist now, price
 * later"): a "Pro coming soon" sign-up on /pricing, to see who wants Pro
 * before anything is sold. An address is kept to tell its owner, once, when
 * Pro opens; nothing else is sent to it. Not the briefing's list
 * (lib/subscribers.ts): signing up here sends no briefing.
 *
 * The table is created when the API starts, if missing (only adding).
 */

import type Redis from 'ioredis'
import { db } from '../db/postgres'
import { logger } from './logger'

let ready = false

export async function ensureWaitlistTable(): Promise<boolean> {
  try {
    await db.raw(`
      CREATE TABLE IF NOT EXISTS pro_waitlist (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        email      TEXT        NOT NULL,
        source     TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`)
    await db.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_pro_waitlist_email ON pro_waitlist (lower(email))')
    ready = true
    return true
  } catch (err) {
    logger.warn({ err }, 'Pro waitlist table could not be created')
    return false
  }
}

export function waitlistReady(): boolean {
  return ready
}

/** A plain address check: something@something.tld, no spaces, at most 254 characters */
export function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (email.length < 6 || email.length > 254) return null
  return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i.test(email) ? email : null
}

/** Where on the site the sign-up was made: a short path or a word, nothing else */
export function cleanSource(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const s = value.trim().slice(0, 80)
  return /^[a-z0-9/_-]+$/i.test(s) ? s : null
}

/** Adds the address (once: a second sign-up changes nothing) */
export async function joinWaitlist(email: string, source: string | null): Promise<void> {
  await db.raw('INSERT INTO pro_waitlist (email, source) VALUES (?, ?) ON CONFLICT (lower(email)) DO NOTHING', [email, source])
}

// ─── The one email: "Pro is open" (plan 13a, Oct 21, 2026) ─────────────────
// Sent once per address, when Devon presses the button on /admin after Pro's
// checkout is live. Addresses already sent are kept in Redis (a set), so a
// second press, or a run that stopped halfway, never sends twice.

export const ANNOUNCED_SET = 'pro:waitlist:announced'
const ANNOUNCE_LOCK = 'pro:waitlist:announcing'

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]!))

/** The email: Pro is open, what it adds, where to upgrade; and that this was the one email */
export function proOpenEmail(siteUrl = 'https://world-pulse.io'): { subject: string; html: string; text: string } {
  const url = `${siteUrl.replace(/\/+$/, '')}/pricing?utm_source=waitlist&utm_medium=email`
  const subject = 'WorldPulse Pro is open'
  const lines = [
    'A Pro API key with its own budget: 600 requests a minute and 50,000 a day',
    'Commercial use of the API and data, with a link back',
    'Priority support by email',
  ]
  const text = [
    'You asked us to tell you when WorldPulse Pro opens: it is open now, at $12 a month.',
    '',
    'Pro adds:',
    ...lines.map(l => `- ${l}`),
    '',
    'Everything free stays free.',
    `Upgrade: ${url}`,
    '',
    'This is the one email we said we would send. Your address won\'t be used again.',
    'WorldPulse · world-pulse.io · support@world-pulse.io',
  ].join('\n')
  const html = `<!doctype html><html><body style="margin:0;background:#06070d;padding:24px">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#0d0f18;border-radius:12px;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
    <tr><td style="font:700 18px sans-serif;color:#f3f4f6;padding-bottom:8px">WorldPulse Pro is open</td></tr>
    <tr><td style="font:14px/1.5 sans-serif;color:#9ca3af;padding-bottom:12px">You asked us to tell you when Pro opens: it is open now, at $12 a month. Pro adds:</td></tr>
    ${lines.map(l => `<tr><td style="font:14px/1.5 sans-serif;color:#f3f4f6;padding:2px 0">✓ ${escapeHtml(l)}</td></tr>`).join('')}
    <tr><td style="font:14px/1.5 sans-serif;color:#9ca3af;padding:12px 0 20px">Everything free stays free.</td></tr>
    <tr><td style="padding-bottom:20px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#00d4ff;color:#06070d;font:700 14px sans-serif;text-decoration:none;padding:12px 20px;border-radius:8px">See Pro</a></td></tr>
    <tr><td style="font:12px/1.5 sans-serif;color:#6b7280">This is the one email we said we would send; your address won't be used again. WorldPulse · support@world-pulse.io</td></tr>
  </table></body></html>`
  return { subject, html, text }
}

type SetStore = Pick<Redis, 'sismember' | 'sadd' | 'scard' | 'set' | 'del'>

/** How many addresses wait, and how many have had the email */
export async function waitlistCounts(redis: Pick<SetStore, 'scard'>): Promise<{ waiting: number; announced: number }> {
  const r = await db.raw('SELECT count(*)::int AS n FROM pro_waitlist') as { rows: Array<{ n: number }> }
  return { waiting: r.rows[0]?.n ?? 0, announced: await redis.scard(ANNOUNCED_SET) }
}

/**
 * Send the one email to every address on the list that hasn't had it; one
 * run at a time. Answers how many were sent, skipped (sent before) and failed
 * (tried again on the next press).
 */
export async function announceProOpen(
  redis: SetStore,
  send: (to: string, msg: { subject: string; html: string; text: string }) => Promise<boolean>,
  siteUrl?: string,
): Promise<{ sent: number; skipped: number; failed: number; busy?: boolean }> {
  if ((await redis.set(ANNOUNCE_LOCK, '1', 'EX', 900, 'NX')) !== 'OK') return { sent: 0, skipped: 0, failed: 0, busy: true }
  try {
    const r = await db.raw('SELECT email FROM pro_waitlist ORDER BY created_at') as { rows: Array<{ email: string }> }
    const msg = proOpenEmail(siteUrl)
    let sent = 0, skipped = 0, failed = 0
    for (const { email } of r.rows) {
      const address = email.trim().toLowerCase()
      if (await redis.sismember(ANNOUNCED_SET, address)) { skipped += 1; continue }
      if (await send(address, msg)) {
        await redis.sadd(ANNOUNCED_SET, address)
        sent += 1
      } else {
        failed += 1
      }
    }
    return { sent, skipped, failed }
  } finally {
    await redis.del(ANNOUNCE_LOCK)
  }
}
