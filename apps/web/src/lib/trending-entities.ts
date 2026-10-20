/**
 * "Trending now" in the left menu (Oct 20, 2026). It used to read
 * /api/v1/feed/trending, whose items carry `tag`, not the `topic` the menu
 * read, so the mapping threw on every load and the menu always showed its
 * placeholder topics (#WorldPulse, #Breaking, #Climate, #GlobalEvents,
 * #OSINT, "— signals"), with "Surging" and "Rising" set by position and
 * bar charts drawn from made-up heights. That endpoint's tags are feed labels
 * ("rss", "news") anyway. Now: the people, places and organisations named in
 * the most reports in the last 24 hours (GET /knowledge-graph/trending, as
 * "In the news" on the home page), each with its real count and, when it is
 * rising, how many times the day before's, each opening its entity page.
 */
import { entityPath } from './entity-links'

export const TRENDING_SHOWN = 5

export interface TrendingAnswer {
  trending?: Array<{
    entity?: { id?: string; type?: string; canonical_name?: string } | null
    recent_mentions?: number | string | null
    spike_ratio?: number | string | null
    is_new?: boolean | null
  }>
}

export interface TrendingRow {
  href: string
  name: string
  type: string
  /** "597 reports in 24 h" */
  count: string
  /** "NEW", "↑3.4×" or "" */
  rise: string
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

export function trendingRows(data: TrendingAnswer | null | undefined): TrendingRow[] {
  const rows: TrendingRow[] = []
  for (const t of data?.trending ?? []) {
    const id = t?.entity?.id; const name = t?.entity?.canonical_name?.trim()
    const reports = num(t?.recent_mentions)
    if (!id || !name || reports === null || reports < 1) continue
    // trade figures name goods ("Petroleum products", "Wheat"): people, places and organisations only
    if (t?.entity?.type === 'commodity') continue
    const ratio = num(t?.spike_ratio)
    rows.push({
      href: entityPath(id, name),
      name,
      type: t?.entity?.type ?? 'other',
      count: `${reports.toLocaleString('en-US')} ${reports === 1 ? 'report' : 'reports'} in 24 h`,
      rise: t?.is_new ? 'NEW' : ratio !== null && ratio >= 1.5 ? `↑${ratio.toFixed(1)}×` : '',
    })
    if (rows.length === TRENDING_SHOWN) break
  }
  return rows
}
