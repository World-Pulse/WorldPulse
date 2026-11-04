/**
 * The sign-up bot trap (Devon, Nov 3, 2026: "Proceed"). On Nov 1 and 2, 20 accounts were made and none
 * was ever used, while visits that touched only the sign-in pages doubled (about 3,900 on Nov 2, against
 * 41 people reading the site over the two days). Three checks that real people never notice:
 * - an invisible box on the sign-up form (`extra`): people never see it, so they leave it empty, while
 *   scripts fill in every box they find;
 * - how long the form was open (`formMs`): a person takes a few seconds, a script submits at once;
 * - at most SIGNUPS_PER_HOUR new accounts from one address in a clock hour.
 * The first two apply to the website's form, which sends both fields. A direct call to the API that
 * sends neither (the documented POST /api/v1/auth/register) meets the hourly limit alone.
 * Nothing here ever blocks a sign-up because Redis is down: the limit then lets it through.
 */
import { redis } from '../db/redis'

/** A form sent sooner than this after it opened was sent by a script */
export const SIGNUP_MIN_FORM_MS = 2_000
/** New accounts one address may make in a clock hour (a classroom signs up at a few a minute, not dozens) */
export const SIGNUPS_PER_HOUR = 10

export type SignupTrap = 'filled-hidden-box' | 'too-fast'

/** Whether the form's own signals say a script filled it in */
export function signupTrap(body: unknown): SignupTrap | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (typeof b.extra === 'string' && b.extra.trim() !== '') return 'filled-hidden-box'
  if (typeof b.formMs === 'number' && Number.isFinite(b.formMs) && b.formMs < SIGNUP_MIN_FORM_MS) return 'too-fast'
  return null
}

const hourKey = (ip: string, now: number) => `signup:ip:${ip}:${new Date(now).toISOString().slice(0, 13)}`

/** Whether this address may make another account this hour */
export async function signupAllowed(ip: string, now: number = Date.now()): Promise<boolean> {
  try {
    const made = Number((await redis.get(hourKey(ip, now))) ?? 0)
    return !(made >= SIGNUPS_PER_HOUR)
  } catch {
    return true
  }
}

/** Count an account made from this address */
export async function countSignup(ip: string, now: number = Date.now()): Promise<void> {
  try {
    const key = hourKey(ip, now)
    const made = await redis.incr(key)
    if (made === 1) await redis.expire(key, 2 * 3_600)
  } catch {
    // never stands in the way of an account
  }
}

/** Count a sign-up the trap stopped, by day and reason (signup:trapped:YYYY-MM-DD, kept 8 days) */
export async function noteTrapped(trap: SignupTrap, now: number = Date.now()): Promise<void> {
  try {
    const key = `signup:trapped:${new Date(now).toISOString().slice(0, 10)}`
    await redis.hincrby(key, trap, 1)
    await redis.expire(key, 8 * 86_400)
  } catch {
    // a count, nothing more
  }
}
