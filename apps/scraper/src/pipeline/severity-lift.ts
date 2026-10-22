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
 *
 * Except after a second read (plan 11a, Oct 22, 2026): a report the second
 * read lowered (pipeline/second-read.ts) isn't lifted back by its words while
 * fewer than 3 outlets carry it, since the second read judged those words.
 * With 3 or more, the rules apply again: the second read is for the big
 * stories few outlets carry.
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
  /** The second read lowered it (readLoweredSql) */
  read_lowered?: boolean | null
}

/** Fewer outlets than this, a report the second read lowered stays lowered */
export const READ_HOLDS_BELOW = 3

/** A select column: whether the second read lowered the report (`table`: the signals table's name or alias in the query) */
export function readLoweredSql(table = 'signals'): string {
  return `EXISTS (SELECT 1 FROM verification_log rl WHERE rl.signal_id = ${table}.id AND rl.check_type = 'second_read' AND rl.result = 'lowered')`
}

/** Whether the second read's lowering holds: it lowered the report and fewer than 3 outlets carry it */
export function heldBySecondRead(row: { read_lowered?: boolean | null }, outlets: number): boolean {
  return row.read_lowered === true && outlets < READ_HOLDS_BELOW
}

/** The severity a report earns with this many outlets, or null when that's no higher than it has */
export function liftedSeverity(row: SeverityRow, outlets: number): SignalSeverity | null {
  if (heldBySecondRead(row, outlets)) return null
  const cap = maxSeverityForSourceCount(outlets, row.category)
  const earned = rateSeverity(row.title, row.summary, row.category)
  const target = (RANK[earned] ?? 0) < (RANK[cap] ?? 0) ? earned : cap
  return (RANK[target] ?? 0) > (RANK[row.severity] ?? 0) ? target : null
}
