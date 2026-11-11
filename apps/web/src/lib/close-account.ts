/**
 * Closing the signed-in account (Settings, Danger Zone). Devon, Nov 11, 2026: "Don't fully delete accounts". Until then
 * the page offered to delete the account for good, and the server had no route for it. Now it closes it: nothing is
 * deleted, the account can't sign in, and its API keys, alerts and WorldPulse emails stop (the API's
 * lib/account-close.ts). It is done only when the server says so; otherwise the page shows the server's reason (a Pro
 * plan to cancel first) or says how else to close it.
 */

export const CLOSE_HELP = "Your account couldn't be closed just now. Please try again, or email support@world-pulse.io from your account's address."
export const CLOSED_DONE = 'Your account is closed.'

/** What closing means, as the dialog says it before the reader confirms */
export const CLOSE_POINTS = [
  "You'll be signed out, and you won't be able to sign in.",
  'Your API keys, email alerts and WorldPulse emails stop.',
  'Your posts and profile stay up.',
] as const
export const CLOSE_AFTER = 'Nothing is deleted. To open your account again, or to have your data erased, email support@world-pulse.io.'

export type CloseAnswer = { ok: true } | { ok: false; message: string }

/** Asks the server to close the signed-in account: ok only when it answered that it did */
export async function closeMyAccount(apiUrl: string, token: string, fetcher: typeof fetch = fetch): Promise<CloseAnswer> {
  try {
    const res = await fetcher(`${apiUrl}/api/v1/users/me/close`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) return { ok: true }
    // A reason the reader can act on (cancel Pro first) is shown as the server wrote it
    if (res.status === 409) {
      const body = await res.json().catch(() => null) as { error?: unknown } | null
      if (body && typeof body.error === 'string' && body.error.trim() !== '') return { ok: false, message: body.error }
    }
    return { ok: false, message: CLOSE_HELP }
  } catch {
    return { ok: false, message: CLOSE_HELP }
  }
}
