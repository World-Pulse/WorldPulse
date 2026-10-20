// Sanctions search through OpenSanctions (plan P16, Oct 20, 2026).
//
// OpenSanctions answers 401 without an API key, and the server has none yet,
// so GET /api/v1/search/entities answers 503 and /sanctions/featured falls
// back to a fixed list (live: false). The pages then say searching is offline
// and hand the reader to OpenSanctions' own search, instead of an error, a
// "please try again" that can't succeed, or the fixed list shown as live data.

export const OPENSANCTIONS_SEARCH = 'https://www.opensanctions.org/search/'

/** OpenSanctions' own search page for a query (their site, a new tab) */
export function openSanctionsSearchUrl(q: string): string {
  const t = q.trim()
  return t ? `${OPENSANCTIONS_SEARCH}?q=${encodeURIComponent(t)}` : OPENSANCTIONS_SEARCH
}

/** The API answers 503 while OpenSanctions can't be searched (no key, or it refused ours) */
export function sanctionsSearchOffline(status: number): boolean {
  return status === 503
}

/** The entities in a /search/entities answer: { success, data: { entities } } */
export function entitiesOf<T>(json: unknown): T[] {
  if (!json || typeof json !== 'object') return []
  const j = json as { data?: { entities?: unknown }; entities?: unknown }
  const list = j.data?.entities ?? j.entities
  return Array.isArray(list) ? (list as T[]) : []
}

/** What the pages say while searching is offline */
export const SANCTIONS_OFFLINE_NOTE =
  'Searching the sanctions lists is offline for now: OpenSanctions, the service this page searches, needs an API key that isn’t set up yet.'
