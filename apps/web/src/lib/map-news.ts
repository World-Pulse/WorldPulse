/**
 * What the World Map shows when no topic is chosen: news (plan M27, Oct 14,
 * 2026).
 *
 * The live map's "Latest in view" list opened with a newspaper's reader
 * survey about the school holidays, an October books list, a podcast page and
 * "This 1 Trick" clickbait. Of the 3,000 points the map loads for 24 hours,
 * about 330 are category "other" at low severity and about 140 are culture or
 * sports at low severity. With "All topics", those stay off the map, its
 * counts and its list; choosing their topic shows them all. An "other" story
 * at medium severity or above stays (a fatal fairground accident was filed
 * there).
 */

export interface MapNewsFields {
  category?: string | null
  severity?: string | null
}

const QUIET = new Set(['low', 'info', ''])

/** Whether a point belongs on the map under "All topics" */
export function isMapNews(sig: MapNewsFields): boolean {
  const category = String(sig.category ?? '').toLowerCase()
  const severity = String(sig.severity ?? '').toLowerCase()
  if (!QUIET.has(severity)) return true
  return category !== 'other' && category !== 'culture' && category !== 'sports'
}

/** The points the map shows for a topic filter: all of them for a chosen topic, news for "all" */
export function mapPointsFor<T extends MapNewsFields>(points: T[], category: string): T[] {
  return category === 'all' ? points.filter(isMapNews) : points
}
