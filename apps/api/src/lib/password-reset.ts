/**
 * Forgot password (plan G13, Oct 21, 2026): a link by email that lets the
 * account's owner choose a new password.
 *
 * The link carries a token signed on the server, so nothing new is stored:
 * the account's id, when the link ends (1 hour), and a signature over both
 * and the account's current password hash. Once the password changes, the
 * hash changes and the link stops working: it works once. A link for another
 * account, a changed date or a guessed signature fails the check.
 *
 * The token travels in the address's #fragment
 * (world-pulse.io/auth/reset-password#token=…), which browsers never send to
 * a server or in a Referer, so it stays out of logs and analytics; the page
 * reads it and takes it out of the address bar.
 *
 * Emails go out only when the server has an email key (Resend, G4); until
 * then the API says password reset isn't available and to write to support.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/** How long a link works */
export const RESET_SECONDS = 60 * 60
/** Links one address can be sent in an hour */
export const RESETS_PER_HOUR = 3

const SITE_URL = (process.env.SITE_URL || 'https://world-pulse.io').replace(/\/+$/, '')

export const RESET_SENT_TEXT =
  "If an account uses that email address, we've sent it a link to choose a new password. The link works once, for 1 hour. Check your spam folder if it isn't there in a few minutes."
export const RESET_OFFLINE_TEXT =
  "Password reset by email isn't available yet. Write to support@world-pulse.io from your account's email address and we'll help you get back in."
export const RESET_DONE_TEXT = 'Your password is changed. Sign in with the new one.'
export const RESET_EXPIRED_TEXT = 'This link has expired (links work for 1 hour). Ask for a new one.'
export const RESET_INVALID_TEXT = 'This link has already been used or is not complete. Ask for a new one.'

function secret(): string {
  return process.env.PASSWORD_RESET_SECRET || process.env.JWT_SECRET || ''
}

/** True when the server can sign reset links */
export function resetConfigured(): boolean {
  return secret() !== ''
}

function sign(userId: string, exp: number, passwordHash: string): string {
  return createHmac('sha256', secret()).update(`worldpulse-reset:${userId}:${exp}:${passwordHash}`).digest('base64url')
}

/** A reset token for an account: id, end time (seconds), signature */
export function resetToken(userId: string, passwordHash: string, now = Date.now()): string {
  if (!resetConfigured()) throw new Error('No secret to sign reset links (PASSWORD_RESET_SECRET or JWT_SECRET)')
  const exp = Math.floor(now / 1000) + RESET_SECONDS
  return `${userId}.${exp}.${sign(userId, exp, passwordHash)}`
}

export interface ParsedResetToken { userId: string; exp: number; sig: string }

const TOKEN_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{9,11})\.([A-Za-z0-9_-]{43})$/i

/** The token's parts, or null when it isn't one */
export function parseResetToken(token: unknown): ParsedResetToken | null {
  if (typeof token !== 'string' || token.length > 200) return null
  const m = token.trim().match(TOKEN_RE)
  if (!m) return null
  return { userId: m[1]!.toLowerCase(), exp: Number(m[2]), sig: m[3]! }
}

/** Whether a token still opens its account: 'ok', 'expired', or 'invalid' (used, changed or forged) */
export function checkResetToken(t: ParsedResetToken, passwordHash: string, now = Date.now()): 'ok' | 'expired' | 'invalid' {
  if (!resetConfigured()) return 'invalid'
  const expected = Buffer.from(sign(t.userId, t.exp, passwordHash))
  const given = Buffer.from(t.sig)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'invalid'
  // checked after the signature, so a changed date is "invalid", not "expired"
  return t.exp * 1000 < now ? 'expired' : 'ok'
}

/** The page that takes the token, which it finds in the #fragment */
export function resetLink(token: string): string {
  return `${SITE_URL}/auth/reset-password#token=${token}`
}

/** The Redis key counting one address's links this hour: a hash, so no address is stored */
export function resetCountKey(email: string): string {
  return `pwreset:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32)}`
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]!))

/** The email: the link, how long it works, and what to do if it wasn't you */
export function resetEmail(link: string, handle: string): { subject: string; html: string; text: string } {
  const subject = 'Choose a new WorldPulse password'
  const who = handle ? `@${handle}` : 'your account'
  const text = [
    `Someone (we hope you) asked to choose a new password for ${who} on WorldPulse.`,
    '',
    'Choose a new password here (the link works once, for 1 hour):',
    link,
    '',
    "If it wasn't you, ignore this email: your password stays the same.",
    '',
    'WorldPulse · world-pulse.io · support@world-pulse.io',
  ].join('\n')
  const html = `<!doctype html><html><body style="margin:0;background:#06070d;padding:24px">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#0d0f18;border-radius:12px;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
    <tr><td style="font:700 18px sans-serif;color:#f3f4f6;padding-bottom:8px">Choose a new password</td></tr>
    <tr><td style="font:14px/1.5 sans-serif;color:#9ca3af;padding-bottom:20px">Someone (we hope you) asked to choose a new password for ${escapeHtml(who)} on WorldPulse.</td></tr>
    <tr><td style="padding-bottom:20px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#f5a623;color:#000;font:700 14px sans-serif;text-decoration:none;padding:12px 20px;border-radius:8px">Choose a new password</a></td></tr>
    <tr><td style="font:13px/1.5 sans-serif;color:#9ca3af;padding-bottom:16px">The link works once, for 1 hour. If it wasn't you, ignore this email: your password stays the same.</td></tr>
    <tr><td style="font:12px sans-serif;color:#6b7280">WorldPulse · <a href="https://world-pulse.io" style="color:#f5a623">world-pulse.io</a> · support@world-pulse.io</td></tr>
  </table></body></html>`
  return { subject, html, text }
}
