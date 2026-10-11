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

interface FocusNode { id: string; mention_count: number }
interface FocusEdge { source: string; target: string; weight: number }

/**
 * The explorer's first view: the trending entities, each with its few
 * strongest links, and the links among them. Merging every trending
 * entity's whole neighbourhood drew some 1,500 unlabelled dots (Oct 11, 2026).
 */
export function focusGraph<N extends FocusNode, E extends FocusEdge>(
  coreIds: string[],
  nodes: N[],
  edges: E[],
  perEntity = 3,
): { nodes: N[]; edges: E[] } {
  const core = new Set(coreIds)
  const keep = new Set(coreIds)
  for (const id of coreIds) {
    edges
      .filter(e => e.source === id || e.target === id)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, perEntity)
      .forEach(e => keep.add(e.source === id ? e.target : e.source))
  }
  const byId = new Map(nodes.map(n => [n.id, n]))
  const keptNodes = [...keep].map(id => byId.get(id)).filter((n): n is N => n !== undefined)
  const keptEdges = edges.filter(e => keep.has(e.source) && keep.has(e.target) && (core.has(e.source) || core.has(e.target)))
  return { nodes: keptNodes, edges: keptEdges }
}

/** Continents and world regions: real places, but nearly every story touches one, so they crowd the picture */
const BROAD_PLACES = new Set([
  'africa', 'asia', 'europe', 'oceania', 'americas', 'the americas', 'middle east', 'north america', 'south america',
  'latin america', 'central america', 'caribbean', 'west africa', 'east africa', 'southern africa', 'north africa',
  'sub-saharan africa', 'south asia', 'southeast asia', 'east asia', 'central asia', 'eastern europe',
  'western europe', 'west asia', 'asia pacific', 'asia-pacific', 'indo-pacific', 'world', 'global',
])

/** A continent or world region (see BROAD_PLACES) */
export function isBroadPlace(e: { type: string; canonical_name: string }): boolean {
  return e.type === 'location' && BROAD_PLACES.has(e.canonical_name.trim().toLowerCase())
}

/**
 * The explorer's first trending entities: in trending order, without
 * duplicates or continents, and at most `places` places. The graph holds far
 * more places than anything else, so its 50 most-mentioned entities were
 * three quarters places and the picture was a map of cities (Oct 11, 2026).
 */
export function balanceTrending<T extends { id: string; type: string; canonical_name: string }>(
  entities: T[], max = 45, places = 12,
): T[] {
  const out: T[] = []
  const seen = new Set<string>()
  let placeCount = 0
  for (const e of entities) {
    if (out.length >= max) break
    if (seen.has(e.id)) continue
    if (e.type === 'location') {
      if (isBroadPlace(e) || placeCount >= places) continue
      placeCount++
    }
    seen.add(e.id)
    out.push(e)
  }
  return out
}
