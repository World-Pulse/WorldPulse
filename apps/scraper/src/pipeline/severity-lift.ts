/**
 * Severity once a story has more than one outlet (Oct 11, 2026).
 *
 * A signal is inserted with its severity capped by its outlet count
 * (reliability-score.ts maxSeverityForSourceCount): one outlet, at most
 * medium (high for disaster, health and security). The cap was never lifted
 * when other outlets reported the same story, so the day's biggest story,
 * "12 killed, 309 injured in Riyadh Airport attack", reported by 25 outlets,
 * was still marked medium. (The delayed rescore only raised medium to high,
 * for any "strategic" story, whatever it said, and only once.)
 *
 * When corroboration counts the outlets, each report gets the severity its
 * own headline and summary earn (severity.ts rateSeverity), up to what the
 * count allows. Severity only goes up here.
 */

import type { SignalSeverity } from '@worldpulse/types'
import { maxSeverityForSourceCount } from './reliability-score'
import { rateSeverity } from './severity'

const RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 }

export interface SeverityRow {
  id: string
  title: string
  summary: string | null
  category: string
  severity: string
}

/** The severity a report earns with this many outlets, or null when that's no higher than it has */
export function liftedSeverity(row: SeverityRow, outlets: number): SignalSeverity | null {
  const cap = maxSeverityForSourceCount(outlets, row.category)
  const earned = rateSeverity(row.title, row.summary, row.category)
  const target = (RANK[earned] ?? 0) < (RANK[cap] ?? 0) ? earned : cap
  return (RANK[target] ?? 0) > (RANK[row.severity] ?? 0) ? target : null
}
