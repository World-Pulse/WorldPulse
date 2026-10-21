/**
 * Follow a story (plan 8; Devon, Oct 21, 2026: "Yes, add it") and readers'
 * flags (plan C5; "Show it + review list"): the words the signal page shows.
 */

import { awayLabel } from './last-visit'

export interface StoryChanges { reports: number; outlets: number }

/** "Since your last visit (3h ago): 4 new reports, 2 new outlets", or null when nothing is new */
export function sinceLine(since: StoryChanges | null | undefined, lastSeenAt: string | null | undefined, now = Date.now()): string | null {
  if (!since || !lastSeenAt || !(since.reports > 0)) return null
  const at = Date.parse(lastSeenAt)
  if (!Number.isFinite(at)) return null
  const reports = `${since.reports} new report${since.reports === 1 ? '' : 's'}`
  const outlets = since.outlets > 0 ? `, ${since.outlets} new outlet${since.outlets === 1 ? '' : 's'}` : ''
  return `Since your last visit (${awayLabel(at, now)}): ${reports}${outlets}`
}

export const FLAG_LABEL: Record<string, string> = {
  inaccurate: 'inaccurate',
  outdated: 'outdated',
  duplicate: 'a duplicate',
  misinformation: 'misinformation',
}

/** "Flagged by 2 readers as inaccurate (2)", the most given reason first; null when nobody flagged it */
export function flagLine(count: number, reasons: Record<string, number> | null | undefined): string | null {
  if (!(count > 0)) return null
  const why = Object.entries(reasons ?? {})
    .filter(([k, n]) => FLAG_LABEL[k] && n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, n]) => `${FLAG_LABEL[k]} (${n})`)
  const who = `Flagged by ${count} reader${count === 1 ? '' : 's'}`
  return why.length ? `${who} as ${why.join(', ')}` : who
}

/** The sign-in token's header, when the reader is signed in (null otherwise) */
export function authHeaders(storage: { getItem(k: string): string | null } | null | undefined): Record<string, string> | null {
  try {
    const token = storage?.getItem('wp_access_token')
    return token ? { Authorization: `Bearer ${token}` } : null
  } catch {
    return null
  }
}
