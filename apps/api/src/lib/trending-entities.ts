/**
 * The side panel's "Trending entities" box (GET /analytics/trending-entities)
 * counts each entity's reports inside the chosen window (Oct 20, 2026). It
 * listed the entities seen in the window by their all-time count, so "24h"
 * showed UN with 7,212 while about 8,100 reports came in that day. The
 * window's counts come from GET /knowledge-graph/trending (kept in Redis);
 * these helpers turn its answer into the box's rows.
 */

/** One row of GET /knowledge-graph/trending?lean=1 */
export interface KgTrendingItem {
  entity?: { id?: string; type?: string; canonical_name?: string } | null
  recent_mentions?: number | string | null
}

/** The box's entity types → the knowledge graph's, when one type matches */
export const KG_TYPE_FOR_API: Record<string, string | undefined> = {
  actor: 'person',
  org: 'organisation',
  country: 'location',
}

/** The knowledge graph's types the box files under "topic" */
const TOPIC_TYPES = new Set(['event', 'weapon_system', 'legislation', 'commodity', 'technology'])

export interface TrendingEntityRow {
  id: string
  name: string
  kgType: string
  /** Reports naming it in the window */
  count: number
}

/**
 * The rows to show for a type filter: "topic" keeps the topic types; "all"
 * leaves out goods named by trade figures ("Petroleum products", "Wheat"),
 * as the left menu's "Trending now" does; at most `limit`, most named first.
 */
export function trendingEntityRows(items: KgTrendingItem[] | null | undefined, type: string, limit: number): TrendingEntityRow[] {
  const rows: TrendingEntityRow[] = []
  for (const t of items ?? []) {
    const id = t?.entity?.id; const name = t?.entity?.canonical_name?.trim(); const kgType = t?.entity?.type ?? 'other'
    const count = Number(t?.recent_mentions)
    if (!id || !name || !Number.isFinite(count) || count < 1) continue
    if (type === 'topic' ? !TOPIC_TYPES.has(kgType) : type === 'all' ? kgType === 'commodity' : false) continue
    rows.push({ id, name, kgType, count })
  }
  return rows.sort((a, b) => b.count - a.count).slice(0, limit)
}
