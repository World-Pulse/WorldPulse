/**
 * ISO weeks for "WorldPulse Week" (plan G11 slice 1, Oct 20, 2026): a week
 * runs Monday 00:00 to the next Monday 00:00, UTC, and is named like
 * 2026-W43 (ISO 8601: week 1 holds the year's first Thursday).
 */

const DAY_MS = 86_400_000
export const WEEK_RE = /^(\d{4})-W(\d{2})$/

export interface IsoWeek { year: number; week: number }

/** The ISO week a moment falls in (UTC) */
export function isoWeekOf(at: Date): IsoWeek {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  const day = d.getUTCDay() || 7                // Monday 1 … Sunday 7
  d.setUTCDate(d.getUTCDate() + 4 - day)        // the Thursday of this week decides the year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  return { year: d.getUTCFullYear(), week: Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7) }
}

/** "2026-W43" */
export const weekName = (w: IsoWeek): string => `${w.year}-W${String(w.week).padStart(2, '0')}`

/** The week named, or null when the name isn't a real ISO week */
export function parseWeek(name: string): IsoWeek | null {
  const m = WEEK_RE.exec(String(name || '').trim())
  if (!m) return null
  const w = { year: Number(m[1]), week: Number(m[2]) }
  if (w.week < 1 || w.week > 53) return null
  // week 53 exists only in some years: it must name itself back
  return weekName(isoWeekOf(weekBounds(w).start)) === weekName(w) ? w : null
}

/** Monday 00:00 UTC of the week, and the next Monday */
export function weekBounds(w: IsoWeek): { start: Date; end: Date } {
  const jan4 = new Date(Date.UTC(w.year, 0, 4))
  const mondayWeek1 = Date.UTC(w.year, 0, 4) - ((jan4.getUTCDay() || 7) - 1) * DAY_MS
  const start = new Date(mondayWeek1 + (w.week - 1) * 7 * DAY_MS)
  return { start, end: new Date(start.getTime() + 7 * DAY_MS) }
}

/** The week before */
export function previousWeek(w: IsoWeek): IsoWeek {
  return isoWeekOf(new Date(weekBounds(w).start.getTime() - DAY_MS))
}
