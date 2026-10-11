/**
 * The Knowledge Graph API's answers in the shapes the explorer page uses.
 * The page was written against a different draft of the API: /trending
 * answers { trending: [{ entity, spike_ratio, recent_mentions }] } and
 * /stats answers { entities: { total, by_type }, edges: { total,
 * by_predicate } }, so reading them as flat lists crashed the page once the
 * API was switched on (Oct 11, 2026).
 */

export interface TrendingEntity {
  id: string
  type: string
  canonical_name: string
  mention_count: number
  /** Mentions in the window against the entity's usual rate (1 = normal) */
  spike_score: number
  recent_signal_count: number
}

export interface GraphStats {
  total_entities: number
  total_edges: number
  entities_by_type: Record<string, number>
  edges_by_predicate: Record<string, number>
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? v as Obj : {})
const num = (v: unknown): number => Number(v) || 0
const counts = (v: unknown): Record<string, number> =>
  Object.fromEntries(Object.entries(obj(v)).map(([k, n]) => [k, num(n)]))

/** /trending as a flat list (a bare list, an older shape, passes through) */
export function toTrendingEntities(json: unknown): TrendingEntity[] {
  const body = obj(json)
  const list: unknown[] = Array.isArray(json) ? json
    : Array.isArray(body.data) ? body.data
    : Array.isArray(body.trending) ? body.trending
    : []
  return list
    .map(raw => {
      const item = obj(raw)
      const e = item.entity ? obj(item.entity) : item
      return {
        id:                  String(e.id ?? ''),
        type:                String(e.type ?? ''),
        canonical_name:      String(e.canonical_name ?? ''),
        mention_count:       num(e.mention_count),
        spike_score:         num(item.spike_ratio ?? item.spike_score),
        recent_signal_count: num(item.recent_mentions ?? item.recent_signal_count),
      }
    })
    .filter(t => t.id !== '')
}

/** /stats as GraphStats (missing numbers are 0) */
export function toGraphStats(json: unknown): GraphStats {
  const s = obj(json)
  const entities = obj(s.entities)
  const edges = obj(s.edges)
  return {
    total_entities:     num(entities.total ?? s.total_entities),
    total_edges:        num(edges.total ?? s.total_edges),
    entities_by_type:   counts(entities.by_type ?? s.entities_by_type),
    edges_by_predicate: counts(edges.by_predicate ?? s.edges_by_predicate),
  }
}
