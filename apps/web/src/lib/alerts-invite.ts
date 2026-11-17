/**
 * The invitation to turn on breaking-news alerts (Nov 16, 2026), shown on the
 * home page and on story pages. Hidden for 30 days after "Not now", kept only
 * in this browser (no cookie, nothing sent).
 */

export const INVITE_KEY = 'wp-alerts-invite-hidden'
export const INVITE_QUIET_DAYS = 30

/** Whether the invitation stays hidden, given when "Not now" was pressed (an ISO time, or null) */
export function inviteHidden(stored: string | null, now: number = Date.now()): boolean {
  if (!stored) return false
  const at = Date.parse(stored)
  if (Number.isNaN(at)) return false
  return now - at < INVITE_QUIET_DAYS * 86_400_000
}
