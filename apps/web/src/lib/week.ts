/**
 * ISO week names for "WorldPulse Week" (plan G11; the API's lib/week.ts has
 * the same rules): weeks run Monday to Monday, UTC, named like 2026-W43.
 */
const DAY_MS = 86_400_000
export const WEEK_RE = /^(\d{4})-W(\d{2})$/

export function isoWeekName(at: Date): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const week = Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY_MS + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** Monday 00:00 UTC of a named week, or null */
export function weekStart(name: string): Date | null {
  const m = WEEK_RE.exec(name)
  if (!m) return null
  const year = Number(m[1]), week = Number(m[2])
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const start = new Date(Date.UTC(year, 0, 4) - ((jan4.getUTCDay() || 7) - 1) * DAY_MS + (week - 1) * 7 * DAY_MS)
  return isoWeekName(start) === name ? start : null
}

/** The weeks before a named one, newest first */
export function weeksBefore(name: string, count: number): string[] {
  const start = weekStart(name)
  if (!start) return []
  return Array.from({ length: count }, (_, i) => isoWeekName(new Date(start.getTime() - (i + 1) * 7 * DAY_MS)))
}

/** "Oct 12–18, 2026" for a week's Monday */
export function weekSpan(start: Date): string {
  const sunday = new Date(start.getTime() + 6 * DAY_MS)
  const month = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  const same = month(start) === month(sunday)
  return `${month(start)} ${start.getUTCDate()}–${same ? '' : month(sunday) + ' '}${sunday.getUTCDate()}, ${sunday.getUTCFullYear()}`
}

/** The `count` weeks that ended before the week under way at `now`, newest first, with when each ended */
export function finishedWeeks(now: Date, count: number): Array<{ name: string; end: Date }> {
  return weeksBefore(isoWeekName(now), count).flatMap(name => {
    const start = weekStart(name)
    return start ? [{ name, end: new Date(start.getTime() + 7 * DAY_MS) }] : []
  })
}
