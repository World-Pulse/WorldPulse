/**
 * Whether a profile address names an account (Oct 13, 2026). The profile
 * pages load the account in the browser, so every address answered 200: a
 * typo like world-pulse.io/not-a-real-page was a "page" for search engines.
 * Their layouts ask here first and answer a real 404 when there's no such
 * account. If the API can't say (down, slow), the page still renders.
 */

import { cachedFetch } from './server-fetch'

const API_BASE = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

/** Handles as sign-up allows them (apps/api/src/routes/auth.ts) */
const HANDLE = /^[A-Za-z0-9_]{3,50}$/

export function handleOf(segment: string): string | null {
  let h = segment
  try { h = decodeURIComponent(segment) } catch { /* keep as is */ }
  h = h.replace(/^@/, '')
  return HANDLE.test(h) ? h : null
}

export async function profileStatus(segment: string): Promise<'exists' | 'missing' | 'unknown'> {
  const handle = handleOf(segment)
  if (!handle) return 'missing'
  try {
    const res = await cachedFetch(`${API_BASE}/api/v1/users/${encodeURIComponent(handle.toLowerCase())}`, 60_000, 5_000)
    if (res.status === 404) return 'missing'
    return res.ok ? 'exists' : 'unknown'
  } catch {
    return 'unknown'
  }
}
