/**
 * The password reset link's token (plan G13): the emailed link is
 * world-pulse.io/auth/reset-password#token=…, in the #fragment so it never
 * reaches a server, a log or analytics.
 */

/** The token in "#token=…", or '' */
export function tokenFromHash(hash: string): string {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  return (params.get('token') || '').trim()
}
