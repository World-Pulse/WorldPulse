/**
 * The sign-up form's half of the bot trap (the API's lib/signup-guard.ts, Nov 3, 2026): a box people
 * never see, so they leave it empty while scripts fill in every box they find, and how long the form
 * was open, since a script sends it at once. Real people notice neither.
 */

/** The invisible box's name: one no browser or password manager fills in by itself */
export const TRAP_FIELD = 'wp_extra'

export interface SignupFields {
  handle: string
  displayName: string
  email: string
  password: string
}

/** What the form sends: its fields, the invisible box and how long the form was open */
export function signupBody(fields: SignupFields, extra: string, openedAt: number, now: number = Date.now()) {
  return { ...fields, extra, formMs: openedAt > 0 ? Math.max(0, Math.round(now - openedAt)) : undefined }
}
