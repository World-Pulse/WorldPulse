/**
 * The sign-in page's ?error=, in words (Nov 11, 2026). The API's GitHub sign-in sends the reader back to
 * /auth/login?error=… when it can't sign them in; until now the page showed nothing for it.
 */

export const CLOSED_SIGN_IN = 'This account was closed. To open it again, or to have its data erased, email support@world-pulse.io from its address.'

/** What to show for ?error=; null for none or one it doesn't know */
export function signInErrorText(code: string | null | undefined): string | null {
  switch (code) {
    case 'account_closed':    return CLOSED_SIGN_IN
    case 'account_suspended': return 'This account is suspended.'
    case 'oauth_failed':      return "Signing in with GitHub didn't work. Please try again."
    default:                  return null
  }
}
