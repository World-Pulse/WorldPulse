/**
 * Deleting the signed-in account (Settings, Danger Zone). Until Nov 11, 2026 the page took any answer for done: the
 * server has no delete route yet and answered 404, and the page signed the reader out as if the account were gone.
 * Now it is done only when the server says so; otherwise the page says how to have it deleted (support@).
 */

export const DELETE_HELP = "Your account couldn't be deleted here yet. Email support@world-pulse.io from your account's address and we'll delete it."

/** Asks the server to delete the signed-in account: true only when it answered that it did */
export async function deleteMyAccount(apiUrl: string, token: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetcher(`${apiUrl}/api/v1/users/me`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    return res.ok
  } catch {
    return false
  }
}
