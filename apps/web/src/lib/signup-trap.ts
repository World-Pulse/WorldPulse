/**
 * The sign-up forms' half of the bot trap (the API's lib/signup-guard.ts, Nov 3, 2026): a box people
 * never see, so they leave it empty while scripts fill in every box they find, and how long the form
 * was open, since a script sends it at once. Real people notice neither. Used by the account sign-up
 * (app/auth/register) and, from Nov 4, the email briefing's sign-up (components/briefing/BriefingSignup).
 */

/** The invisible box's name: one no browser or password manager fills in by itself */
export const TRAP_FIELD = 'wp_extra'

/** The trap's two fields: the invisible box, and how long the form was open (left out if unknown) */
export function trapFields(extra: string, openedAt: number, now: number = Date.now()) {
  return { extra, formMs: openedAt > 0 ? Math.max(0, Math.round(now - openedAt)) : undefined }
}

export interface SignupFields {
  handle: string
  displayName: string
  email: string
  password: string
}

/** What the account form sends: its fields and the trap's */
export function signupBody(fields: SignupFields, extra: string, openedAt: number, now: number = Date.now()) {
  return { ...fields, ...trapFields(extra, openedAt, now) }
}
