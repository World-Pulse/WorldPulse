/**
 * Entity links (Oct 15, 2026): connect stories by the people, places and
 * organisations they share, not by when they were published.
 *
 * The causal chains linked any two reports in "related" categories from the
 * same country within 48 hours (a new White House press secretary → Massport's
 * new port director at 0.9 confidence). Here two stories are linked when they
 * name the same specific entities: each shared entity counts by how rare it is
 * (an entity in 2 stories says a lot, one in 25+ says nothing), and a pair needs
 * two shared entities, or one that only these two stories name.
 *
 * `buildEntityLinks` is pure; `loadEntityHits` reads the entity graph.
 *
 * @module pipeline/entity-links
 */

import { db } from '../lib/postgres'

export interface EntityHit {
  eid: string
  name: string
  type: string
  sid: string
  story: string
  title: string
  category: string | null
  created_at: string | Date
  location_name: string | null
  country_code: string | null
  severity: string | null
  source_count: number | null
}

export interface LinkEnd {
  story: string
  signal_id: string
  title: string
  category: string | null
  at: string
  place: string | null
  country: string | null
  outlets: number
}

export interface EntityLink {
  a: LinkEnd
  b: LinkEnd
  shared_entities: string[]
  score: number
  hours_apart: number
}

export interface EntityChain {
  id: string
  cause: { signal_id: string; title: string; category: string; created_at: string }
  effect: { signal_id: string; title: string; category: string; created_at: string }
  confidence: number
  link_type: string
  delay_hours: number
  shared_entities: string[]
}

export interface LinkOptions {
  /** an entity named in more stories than this is too common to link two of them */
  maxStories?: number
  maxLinks?: number
  maxChains?: number
  chainWindowHours?: number
  causalPairs?: Array<[string, string, string]>
}

const NAMED_TYPES = new Set(['person', 'organisation', 'organization', 'org', 'group', 'company'])

const STOP = new Set(('about after again against amid among around because been before being below between both could does doing down during each from further have having here into itself just more most much near news once only other over said says same should since some such than that their them then there these they this those through under until upon very were what when where which while will with would your year years week today latest live update report reports first last make makes made take takes call calls called might told tell tells').split(/\s+/))

function headlineWords(t: string): Set<string> {
  const out = new Set<string>()
  for (const w of String(t || '').replace(/[‘’]/g, "'").match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]+/g) ?? []) {
    const lw = w.toLowerCase().replace(/'s$/, '').replace(/^['-]+|['-]+$/g, '')
    if (lw.length >= 4 && !STOP.has(lw)) out.add(lw)
  }
  return out
}

/**
 * Two outlets' headlines for one event ("Kabila's move towards M23 raises
 * questions" / "Kabila's move towards M23 rebels raises questions"): most of
 * the shorter headline's words are in the other. They share every entity, so
 * without this check they top the list as the strongest "link".
 */
export function sameEvent(a: string, b: string): boolean {
  const wa = headlineWords(a), wb = headlineWords(b)
  if (wa.size === 0 || wb.size === 0) return false
  let shared = 0
  for (const w of wa) if (wb.has(w)) shared++
  return shared / Math.min(wa.size, wb.size) >= 0.6
}

/** Link stories that share specific entities; and the subset that reads as cause → effect */
export function buildEntityLinks(hits: EntityHit[], opts: LinkOptions = {}): { links: EntityLink[]; chains: EntityChain[]; stories: number; entities: number; duplicates: number } {
  const maxStories = opts.maxStories ?? 25
  const maxLinks = opts.maxLinks ?? 20
  const maxChains = opts.maxChains ?? 50
  const windowH = opts.chainWindowHours ?? 48

  // one entry per story: its best-reported headline, earliest time, its entities
  const stories = new Map<string, { end: LinkEnd; ents: Set<string> }>()
  const entName = new Map<string, { name: string; type: string }>()
  for (const h of hits) {
    if (!h.story || !h.eid || !h.title) continue
    entName.set(h.eid, { name: h.name, type: String(h.type || '').toLowerCase() })
    const at = new Date(h.created_at).toISOString()
    const outlets = Number(h.source_count) || 1
    let s = stories.get(h.story)
    if (!s) {
      s = { end: { story: h.story, signal_id: h.sid, title: h.title, category: h.category, at, place: h.location_name, country: h.country_code, outlets }, ents: new Set() }
      stories.set(h.story, s)
    } else {
      if (outlets > s.end.outlets) Object.assign(s.end, { signal_id: h.sid, title: h.title, outlets, place: h.location_name ?? s.end.place, country: h.country_code ?? s.end.country })
      if (at < s.end.at) s.end.at = at
      if (!s.end.category && h.category) s.end.category = h.category
    }
    s.ents.add(h.eid)
  }

  // how many stories name each entity
  const df = new Map<string, number>()
  for (const s of stories.values()) for (const e of s.ents) df.set(e, (df.get(e) ?? 0) + 1)
  const n = Math.max(2, stories.size)

  // pairs of stories through each informative entity
  const byEntity = new Map<string, string[]>()
  for (const [key, s] of stories) {
    for (const e of s.ents) {
      const d = df.get(e) ?? 0
      if (d < 2 || d > maxStories) continue
      const list = byEntity.get(e) ?? []
      list.push(key)
      byEntity.set(e, list)
    }
  }
  const pairs = new Map<string, { a: string; b: string; ents: string[]; score: number }>()
  for (const [e, keys] of byEntity) {
    const idf = Math.log(n / (df.get(e) ?? n))
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const [a, b] = keys[i]! < keys[j]! ? [keys[i]!, keys[j]!] : [keys[j]!, keys[i]!]
        const k = `${a}\u0000${b}`
        const p = pairs.get(k) ?? { a, b, ents: [], score: 0 }
        p.ents.push(e)
        p.score += idf
        pairs.set(k, p)
      }
    }
  }

  const links: EntityLink[] = []
  let duplicates = 0
  for (const p of pairs.values()) {
    const solo = p.ents.length === 1 && (df.get(p.ents[0]!) ?? 0) === 2 && NAMED_TYPES.has(entName.get(p.ents[0]!)?.type ?? '')
    if (p.ents.length < 2 && !solo) continue
    const A = stories.get(p.a)!.end, B = stories.get(p.b)!.end
    if (sameEvent(A.title, B.title)) { duplicates++; continue }
    const [first, second] = A.at <= B.at ? [A, B] : [B, A]
    links.push({
      a: first, b: second,
      shared_entities: p.ents
        .sort((x, y) => (df.get(x) ?? 0) - (df.get(y) ?? 0))
        .map(e => entName.get(e)?.name ?? e)
        .slice(0, 6),
      score: Math.round(p.score * 100) / 100,
      hours_apart: Math.round(((new Date(second.at).getTime() - new Date(first.at).getTime()) / 3600000) * 10) / 10,
    })
  }
  links.sort((x, y) => y.score - x.score)

  // cause → effect: linked stories in a known causal pair of categories, in time order
  const pairType = new Map<string, string>()
  for (const [c, e, t] of opts.causalPairs ?? []) pairType.set(`${c}>${e}`, t)
  const chains: EntityChain[] = []
  for (const l of links) {
    if (!l.a.category || !l.b.category || l.a.category === l.b.category) continue
    if (l.hours_apart < 0.5 || l.hours_apart > windowH) continue
    const type = pairType.get(`${l.a.category}>${l.b.category}`)
    if (!type) continue
    chains.push({
      id: `${l.a.signal_id}_${l.b.signal_id}`,
      cause: { signal_id: l.a.signal_id, title: l.a.title, category: l.a.category, created_at: l.a.at },
      effect: { signal_id: l.b.signal_id, title: l.b.title, category: l.b.category, created_at: l.b.at },
      confidence: Math.round(Math.min(0.95, 0.25 + 0.15 * l.shared_entities.length + 0.05 * Math.min(4, l.score)) * 1000) / 1000,
      link_type: type,
      delay_hours: l.hours_apart,
      shared_entities: l.shared_entities,
    })
  }
  chains.sort((x, y) => y.confidence - x.confidence)

  return { links: links.slice(0, maxLinks), chains: chains.slice(0, maxChains), stories: stories.size, entities: df.size, duplicates }
}

/**
 * Read which entities name which of the last `hours` hours of reports, with
 * each report's story (signals.story_id, or the report itself).
 * `to_jsonb(s)->>'story_id'` reads the column without failing where it doesn't exist yet.
 */
export async function loadEntityHits(hours: number): Promise<EntityHit[]> {
  const h = Math.max(1, Math.min(24 * 14, Math.round(hours)))
  const res = await db.raw(`
    WITH recent AS (
      SELECT s.id::text AS sid,
             COALESCE(to_jsonb(s) ->> 'story_id', s.id::text) AS story,
             s.title, s.category, s.created_at, s.location_name, s.country_code, s.severity,
             COALESCE(s.source_count, 1) AS source_count
      FROM signals s
      WHERE s.created_at >= NOW() - INTERVAL '${h} hours'
        AND s.status IN ('verified', 'pending')
        AND s.title IS NOT NULL
    )
    SELECT en.id AS eid, en.canonical_name AS name, en.type, r.*
    FROM entity_nodes en
    CROSS JOIN LATERAL unnest(en.signal_ids) AS u(sid)
    JOIN recent r ON r.sid = lower(u.sid)
    WHERE en.last_seen >= NOW() - INTERVAL '${h + 24} hours'
  `)
  return (res.rows ?? []) as EntityHit[]
}
