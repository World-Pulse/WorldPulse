/**
 * The sign-up bot trap (Devon, Nov 3, 2026: "Proceed"). On Nov 1 and 2, 20 accounts were made and none
 * was ever used, while visits that touched only the sign-in pages doubled (about 3,900 on Nov 2, against
 * 41 people reading the site over the two days). Three checks that real people never notice:
 * - an invisible box on the sign-up form (`extra`): people never see it, so they leave it empty, while
 *   scripts fill in every box they find;
 * - how long the form was open (`formMs`): a person takes a few seconds, a script submits at once;
 * - at most so many sign-ups from one address in a clock hour.
 * The first two apply to the website's forms, which send both fields. A direct call to the API that
 * sends neither (the documented POST /api/v1/auth/register) meets the hourly limit alone.
 *
 * Nov 4, 2026: the email briefing's sign-up too (POST /api/v1/digest/subscribe). Its unconfirmed
 * sign-ups went from 19 to 40 in two days, very likely the same scripts, and since the briefing is
 * switched on each one makes WorldPulse send a confirmation email to an address it was handed.
 *
 * Nothing here ever blocks a sign-up because Redis is down: the limit then lets it through.
 */
import { redis } from '../db/redis'

/** A form sent sooner than this after it opened was sent by a script */
export const SIGNUP_MIN_FORM_MS = 2_000

/** What is being signed up for: an account, or the email briefing */
export type SignupKind = 'account' | 'briefing'

/**
 * Sign-ups one address may make in a clock hour: accounts (a classroom signs up at a few a minute,
 * not dozens), and briefing sign-ups (a person signs up once; each sends a confirmation email)
 */
export const SIGNUPS_PER_HOUR: Record<SignupKind, number> = { account: 10, briefing: 5 }

export type SignupTrap = 'filled-hidden-box' | 'too-fast'

/** Whether the form's own signals say a script filled it in */
export function signupTrap(body: unknown): SignupTrap | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (typeof b.extra === 'string' && b.extra.trim() !== '') return 'filled-hidden-box'
  if (typeof b.formMs === 'number' && Number.isFinite(b.formMs) && b.formMs < SIGNUP_MIN_FORM_MS) return 'too-fast'
  return null
}

/** The Redis names, by kind: accounts keep the names they had (signup:...) */
const PREFIX: Record<SignupKind, string> = { account: 'signup', briefing: 'briefing' }
const hourKey = (kind: SignupKind, ip: string, now: number) =>
  `${PREFIX[kind]}:ip:${ip}:${new Date(now).toISOString().slice(0, 13)}`

/** How long the hourly count may take to read before the sign-up goes ahead without it */
const READ_WAIT_MS = 500

/** Whether this address may sign up again this hour */
export async function signupAllowed(ip: string, kind: SignupKind = 'account', now: number = Date.now()): Promise<boolean> {
  try {
    const read = redis.get(hourKey(kind, ip, now)).catch(() => null)
    const late = new Promise<null>(resolve => { setTimeout(() => resolve(null), READ_WAIT_MS).unref?.() })
    const made = Number((await Promise.race([read, late])) ?? 0)
    return !(made >= SIGNUPS_PER_HOUR[kind])
  } catch {
    return true
  }
}

/** Count a sign-up made from this address */
export async function countSignup(ip: string, kind: SignupKind = 'account', now: number = Date.now()): Promise<void> {
  try {
    const key = hourKey(kind, ip, now)
    const made = await redis.incr(key)
    if (made === 1) await redis.expire(key, 2 * 3_600)
  } catch {
    // never stands in the way of a sign-up
  }
}

/**
 * Count a sign-up the trap stopped, by day and reason (signup:trapped:YYYY-MM-DD for accounts,
 * briefing:trapped:YYYY-MM-DD for the email briefing; kept 8 days; /ops-status.json shows them)
 */
export async function noteTrapped(trap: SignupTrap, kind: SignupKind = 'account', now: number = Date.now()): Promise<void> {
  try {
    const key = `${PREFIX[kind]}:trapped:${new Date(now).toISOString().slice(0, 10)}`
    await redis.hincrby(key, trap, 1)
    await redis.expire(key, 8 * 86_400)
  } catch {
    // a count, nothing more
  }
}
