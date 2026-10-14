/**
 * Cross-Source Event Correlation Engine
 *
 * Detects when multiple OSINT feeds report on the same underlying real-world
 * event and links them into an "event cluster". For example:
 *   - USGS earthquake → NOAA tsunami warning → UNHCR displacement
 *   - ACLED conflict → ReliefWeb humanitarian crisis → UNHCR refugees
 *   - CISA KEV vulnerability → OTX threat pulse → power grid outage
 *
 * Correlation factors:
 *   1. Temporal proximity (signals within configurable time window)
 *   2. Geographic proximity (signals near same location)
 *   3. Category chain rules (known causal relationships)
 *   4. Keyword overlap (shared entity/topic references)
 *
 * When signals are correlated:
 *   - They are grouped into an event_cluster with a shared cluster_id
 *   - The highest-severity signal becomes the "primary" signal
 *   - Reports of the same story from independent outlets gain reliability
 *     (each new outlet closes part of the gap to 0.98, see RELIABILITY_CEILING)
 *   - A correlated_signals array is stored in Redis for fast retrieval
 *
 * @module pipeline/correlate
 */

import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import { sourceKey, hostOf } from './signal-columns'
import { findGazetteerPlace, splitPlaces } from './geo'
import { isEventTemplateTitle } from './event-titles'
import { countIndependentOutlets, isCopyOf } from './independence'
import { joinStory } from './stories'
import { liftedSeverity, type SeverityRow } from './severity-lift'
import { crossCheckLater } from './crosscheck'
import { createHash } from 'crypto'

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface CorrelationCandidate {
  id: string
  title: string
  category: string
  severity: string
  source_id: string
  location_name: string | null
  lat: number | null
  lng: number | null
  published_at: string | Date
  reliability_score: number
  tags: string[]
  /** The signal's first article URL, when known (shared with same-story matches) */
  url?: string | null
}

export interface EventCluster {
  cluster_id: string
  primary_signal_id: string
  signal_ids: string[]
  categories: string[]
  sources: string[]
  severity: string
  correlation_type: CorrelationType
  correlation_score: number
  created_at: string
}

export type CorrelationType =
  | 'geo_temporal'       // Same place + same time
  | 'causal_chain'       // Known cause-effect relationship
  | 'keyword_overlap'    // Shared entities or topics
  | 'multi_factor'       // Multiple correlation factors

// ─── CONFIGURATION ────────────────────────────────────────────────────────────

/** Maximum time window (hours) for temporal correlation */
const TEMPORAL_WINDOW_HOURS = Number(process.env.CORRELATION_WINDOW_HOURS ?? 24)

/** Maximum distance (km) for geographic correlation */
const GEO_RADIUS_KM = Number(process.env.CORRELATION_GEO_RADIUS_KM ?? 200)

/** Minimum correlation score to form a cluster (0-1) */
const MIN_CORRELATION_SCORE = 0.45

/**
 * Reliability as independent outlets confirm a story (Oct 11, 2026). Each new
 * outlet closes part of the gap to a ceiling below certainty: from n to m
 * outlets, r' = C − (C − r) × K^(m − n), so the score is the same whatever
 * order the outlets come in, each outlet adds less than the one before, and
 * no story shows 100%. It used to add 0.07 per outlet (more for high and
 * critical stories) up to 1.0: 252 of 574 verified stories showed a flat 100%.
 */
export const RELIABILITY_CEILING = 0.98
const OUTLET_GAP_KEPT = 0.6

/** A score after `added` more independent outlets (never lowered: one already at the ceiling stays) */
export function corroboratedReliability(score: number, added: number): number {
  if (added <= 0 || score >= RELIABILITY_CEILING) return score
  return RELIABILITY_CEILING - (RELIABILITY_CEILING - score) * OUTLET_GAP_KEPT ** added
}

/** corroboratedReliability as an update of reliability_score; `added` is SQL for the outlets added */
function corroboratedReliabilitySql(added: string, bindings: unknown[] = []) {
  return db.raw(
    `CASE WHEN reliability_score >= ? THEN reliability_score
          ELSE ? - (? - reliability_score) * POWER(?, GREATEST(${added}, 0)) END`,
    [RELIABILITY_CEILING, RELIABILITY_CEILING, RELIABILITY_CEILING, OUTLET_GAP_KEPT, ...bindings],
  )
}

/** Redis TTL for correlation data */
const CORRELATION_TTL = 7 * 24 * 60 * 60 // 7 days

/** Maximum cluster size to prevent runaway merges */
const MAX_CLUSTER_SIZE = 12

/**
 * "Same story" test used for corroboration (the only thing that verifies a
 * signal). Clusters above group *related* signals (same place, same hour,
 * linked categories); that is fine for "related signals" but it is not
 * evidence. On Oct 10, 2026 the loose cluster rule verified unrelated
 * single-source stories within minutes of going live, so verification now
 * needs two different outlets whose headlines describe the same thing.
 */
const SAME_STORY_MIN_WORDS = 4      // headlines need enough content words to compare (a place counts once, as its country)
const SAME_STORY_MIN_SHARED = 3     // content words both headlines use
const SAME_STORY_MIN_JACCARD = 0.4  // shared words / all words of both headlines
const SAME_STORY_RADIUS_KM = 300    // when both are on the map, they must be near each other

// ─── CAUSAL CHAIN RULES ──────────────────────────────────────────────────────
// Maps category pairs that have known causal relationships.
// { trigger → [possible effects] }
/**
 * Causal chain rules using ACTUAL DB category enum values:
 *   breaking, conflict, geopolitics, climate, health, economy,
 *   technology, science, elections, culture, disaster, security,
 *   sports, space, other
 *
 * Maps { trigger_category → [effect_categories] }.
 * When signal A's category is a trigger and signal B's category is
 * one of the effects (or vice-versa), the causal score = 1.0.
 */
const CAUSAL_CHAINS: Record<string, string[]> = {
  // Natural disaster cascades
  disaster:    ['health', 'climate', 'economy', 'security', 'breaking'],
  climate:     ['disaster', 'health', 'economy'],
  science:     ['disaster', 'climate', 'health', 'space'],

  // Conflict / geopolitical cascades
  conflict:    ['security', 'geopolitics', 'economy', 'disaster', 'breaking'],
  geopolitics: ['conflict', 'security', 'economy', 'elections'],
  security:    ['conflict', 'geopolitics', 'technology', 'economy'],

  // Cyber / technology cascades
  technology:  ['security', 'economy'],

  // Health cascades
  health:      ['disaster', 'economy', 'science'],

  // Economic cascades
  economy:     ['geopolitics', 'elections', 'security'],

  // Elections → political instability
  elections:   ['geopolitics', 'conflict', 'security'],

  // Space → science, security (satellite jamming, re-entry hazards)
  space:       ['science', 'security', 'technology'],
}

// ─── SEVERITY ORDERING ───────────────────────────────────────────────────────
const SEVERITY_ORDER: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

// ─── MAIN CORRELATION FUNCTION ───────────────────────────────────────────────

/**
 * Correlate a newly ingested signal against recent signals.
 *
 * Called after a signal is inserted into the DB. Looks for nearby signals
 * in the temporal/geographic/category space and forms or extends clusters.
 */
export async function correlateSignal(signal: CorrelationCandidate): Promise<EventCluster | null> {
  const span = { start: Date.now() }

  try {
    // 1. Fetch recent signals in the temporal window
    const candidates = await fetchRecentSignals(signal)

    // 2. Independent reports of the same story: the only corroboration that
    //    raises reliability or verifies anything (see isSameStory). Looked for
    //    among the newest signals and, by headline words, the whole window.
    const wider = await fetchSameStoryCandidates(signal).catch(err => {
      logger.warn({ err, signal_id: signal.id }, 'Same-story search failed (non-fatal)')
      return [] as CorrelationCandidate[]
    })
    const pool = new Map<string, CorrelationCandidate>()
    for (const c of [...candidates, ...wider]) pool.set(c.id, c)
    const sameStory = [...pool.values()].filter(c => isSameStory(signal, c))
    if (sameStory.length > 0) {
      await applyCorroborationBoost(signal, sameStory)
    }

    if (candidates.length === 0) return null

    // 3. Score each candidate for correlation (related signals, for display)
    const scored = candidates.map(candidate => ({
      candidate,
      score: computeCorrelationScore(signal, candidate),
      type: determineCorrelationType(signal, candidate),
    })).filter(s => s.score >= MIN_CORRELATION_SCORE)

    if (scored.length === 0) return null

    // 3. Sort by score descending, take strongest correlations
    scored.sort((a, b) => b.score - a.score)
    const topCorrelations = scored.slice(0, MAX_CLUSTER_SIZE - 1)

    // 4. Check if any candidate already belongs to a cluster
    const existingClusterId = await findExistingCluster(
      topCorrelations.map(s => s.candidate.id)
    )

    // 5. Form or extend cluster (related signals; this never changes reliability
    //    or status, which only same-story corroboration does, in step 2)
    let cluster: EventCluster
    if (existingClusterId) {
      cluster = await extendCluster(existingClusterId, signal, topCorrelations)
    } else {
      cluster = await createCluster(signal, topCorrelations)
    }

    const durationMs = Date.now() - span.start
    logger.info({
      cluster_id: cluster.cluster_id,
      signal_count: cluster.signal_ids.length,
      categories: cluster.categories,
      correlation_type: cluster.correlation_type,
      correlation_score: cluster.correlation_score,
      duration_ms: durationMs,
    }, 'Event cluster formed/extended')

    return cluster
  } catch (err) {
    logger.error({ err, signal_id: signal.id }, 'Correlation engine error')
    return null
  }
}

// ─── CANDIDATE FETCHING ──────────────────────────────────────────────────────

async function fetchRecentSignals(signal: CorrelationCandidate): Promise<CorrelationCandidate[]> {
  const since = new Date(Date.now() - TEMPORAL_WINDOW_HOURS * 60 * 60 * 1000)

  // Window on created_at (always set, indexed). Until Oct 2026 this filtered on
  // published_at, which no new row had, so no signal ever found a match and
  // nothing was corroborated or promoted to verified.
  const query = db('signals')
    .select(
      'id', 'title', 'category', 'severity',
      db.raw('source_ids[1]::text as source_id'),
      db.raw('original_urls[1] as first_url'),
      'location_name', 'reliability_score', 'tags',
      db.raw('COALESCE(event_time, created_at) as published_at'),
      // Extract lat/lng from PostGIS geometry so geo scoring actually works
      db.raw('ST_Y(location::geometry) as lat'),
      db.raw('ST_X(location::geometry) as lng'),
    )
    .where('created_at', '>=', since.toISOString())
    .whereNot('id', signal.id)
    .orderBy('created_at', 'desc')
    .limit(200)

  const rows = await query
  return rows.map(toCandidate)
}

/**
 * Signals from the whole window whose headlines share words with this one,
 * best matches first. fetchRecentSignals only returns the 200 newest signals
 * (about 45 minutes of intake), so most reports of the same story were never
 * compared. Only used for same-story corroboration, not for clusters.
 */
async function fetchSameStoryCandidates(signal: CorrelationCandidate): Promise<CorrelationCandidate[]> {
  // Each word by its stem, as a prefix ("attack:*" finds "attacks" and "attacked"; isSameStory compares stems)
  const words = [...new Set((signal.title ?? '').toLowerCase().split(/[^a-z0-9]+/)
    .filter(w => w.length >= 4 && !STOP_WORDS.has(w) && !HEADLINE_FILLER.has(w))
    .map(w => stemWord(w))
    .filter(w => w.length >= 4))]
    .slice(0, 12)
  if (words.length < SAME_STORY_MIN_SHARED) return []
  const tsquery = words.map(w => `${w}:*`).join(' | ')
  const since = new Date(Date.now() - TEMPORAL_WINDOW_HOURS * 60 * 60 * 1000)

  const rows = await db('signals')
    .select(
      'id', 'title', 'category', 'severity',
      db.raw('source_ids[1]::text as source_id'),
      db.raw('original_urls[1] as first_url'),
      'location_name', 'reliability_score', 'tags',
      db.raw('COALESCE(event_time, created_at) as published_at'),
      db.raw('ST_Y(location::geometry) as lat'),
      db.raw('ST_X(location::geometry) as lng'),
    )
    .where('created_at', '>=', since.toISOString())
    .whereNot('id', signal.id)
    .whereRaw(`to_tsvector('simple', title) @@ to_tsquery('simple', ?)`, [tsquery])
    .orderByRaw(`ts_rank(to_tsvector('simple', title), to_tsquery('simple', ?)) DESC`, [tsquery])
    .limit(50)
  return rows.map(toCandidate)
}

function toCandidate(r: Record<string, unknown>): CorrelationCandidate {
  return {
    id: r.id as string,
    title: r.title as string,
    category: r.category as string,
    severity: r.severity as string,
    source_id: sourceKey(r.source_id, r.first_url),
    location_name: r.location_name as string | null,
    lat: typeof r.lat === 'number' ? r.lat : null,
    lng: typeof r.lng === 'number' ? r.lng : null,
    published_at: r.published_at as string,
    reliability_score: r.reliability_score as number,
    tags: Array.isArray(r.tags) ? r.tags as string[] : [],
    url: typeof r.first_url === 'string' ? r.first_url : null,
  }
}

// ─── CORRELATION SCORING ─────────────────────────────────────────────────────

/**
 * Compute a 0-1 correlation score between two signals.
 *
 * Weighted factors:
 *   - Temporal proximity:  0.25 weight
 *   - Geographic proximity: 0.30 weight
 *   - Causal chain match:  0.25 weight
 *   - Keyword overlap:     0.20 weight
 */
export function computeCorrelationScore(
  a: CorrelationCandidate,
  b: CorrelationCandidate,
): number {
  const temporal = temporalScore(a, b)
  const geo      = geoScore(a, b)
  const causal   = causalScore(a, b)
  const keyword  = keywordScore(a, b)

  // Same hour and linked categories alone are not a connection: a boat wreck
  // in Djibouti and a climate march in Brussels would pass (0.7). Two signals
  // need a nearby place or a shared particular headline word.
  if (geo === 0 && !sharesSubject(a, b)) return 0

  // If no geographic data, redistribute weight
  if (a.lat == null || b.lat == null) {
    // No geo: temporal 0.35, causal 0.35, keyword 0.30
    return temporal * 0.35 + causal * 0.35 + keyword * 0.30
  }

  return temporal * 0.25 + geo * 0.30 + causal * 0.25 + keyword * 0.20
}

/**
 * Temporal proximity score.
 * 1.0 if signals are within 1 hour, decays linearly to 0 at TEMPORAL_WINDOW_HOURS.
 */
export function temporalScore(a: CorrelationCandidate, b: CorrelationCandidate): number {
  const ta = new Date(a.published_at).getTime()
  const tb = new Date(b.published_at).getTime()
  const diffHours = Math.abs(ta - tb) / (60 * 60 * 1000)

  if (diffHours <= 1) return 1.0
  if (diffHours >= TEMPORAL_WINDOW_HOURS) return 0.0
  return 1.0 - (diffHours - 1) / (TEMPORAL_WINDOW_HOURS - 1)
}

/**
 * Geographic proximity score using Haversine distance.
 * 1.0 if within 10km, decays to 0 at GEO_RADIUS_KM.
 */
export function geoScore(a: CorrelationCandidate, b: CorrelationCandidate): number {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return 0

  const dist = haversineKm(a.lat, a.lng, b.lat, b.lng)
  if (dist <= 10) return 1.0
  if (dist >= GEO_RADIUS_KM) return 0.0
  return 1.0 - (dist - 10) / (GEO_RADIUS_KM - 10)
}

/**
 * Causal chain score.
 * 1.0 if there's a known causal chain between categories, 0.0 otherwise.
 * Partial score (0.5) if categories are in the same domain.
 */
export function causalScore(a: CorrelationCandidate, b: CorrelationCandidate): number {
  // Direct causal chain: A's category triggers B's category (or vice-versa)
  const effectsOfA = CAUSAL_CHAINS[a.category]
  if (effectsOfA && effectsOfA.includes(b.category)) return 1.0

  const effectsOfB = CAUSAL_CHAINS[b.category]
  if (effectsOfB && effectsOfB.includes(a.category)) return 1.0

  // Same category from different sources = strong correlation signal
  if (a.category === b.category && a.source_id !== b.source_id) return 0.7

  // Same domain family = moderate correlation
  const familyA = getCategoryFamily(a.category)
  const familyB = getCategoryFamily(b.category)
  if (familyA && familyA === familyB) return 0.35

  return 0
}

/**
 * Keyword/entity overlap score.
 * Uses tags + title word overlap to detect shared entities.
 */
export function keywordScore(a: CorrelationCandidate, b: CorrelationCandidate): number {
  // Tag overlap
  const tagsA = new Set(a.tags.map(t => t.toLowerCase()))
  const tagsB = new Set(b.tags.map(t => t.toLowerCase()))
  const tagOverlap = intersection(tagsA, tagsB).size
  const tagUnion = union(tagsA, tagsB).size
  const tagJaccard = tagUnion > 0 ? tagOverlap / tagUnion : 0

  // Title significant word overlap (exclude stop words)
  const wordsA = extractSignificantWords(a.title)
  const wordsB = extractSignificantWords(b.title)
  const wordOverlap = intersection(wordsA, wordsB).size
  const wordUnion = union(wordsA, wordsB).size
  const wordJaccard = wordUnion > 0 ? wordOverlap / wordUnion : 0

  // Location name match
  const locMatch = (a.location_name && b.location_name &&
    a.location_name.toLowerCase() === b.location_name.toLowerCase()) ? 0.3 : 0

  return Math.min(1.0, tagJaccard * 0.5 + wordJaccard * 0.3 + locMatch)
}

/** A shared headline word that singles out the story (a name, a thing, a count of 3 or more); tags are too generic ("conflict") */
function sharesSubject(a: CorrelationCandidate, b: CorrelationCandidate): boolean {
  const wordsB = storyWords(b.title)
  for (const w of storyWords(a.title)) {
    if (wordsB.has(w) && isParticular(w)) return true
  }
  return false
}

/** Counts in words: "a dozen killed" and "12 killed" say the same */
const COUNT_WORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', dozen: '12', thirteen: '13', fifteen: '15', twenty: '20', thirty: '30', forty: '40',
  fifty: '50', hundred: '100',
}

/**
 * Headline words that say nothing about which story it is: everyday verbs
 * ("Trump gets..."), "Watch:" and "latest", who said it ("..., governor
 * says", "officials say") and prepositions ("against", "among"). Without
 * these, "Russian attack on Ukraine's Zaporizhzhia kills seven, governor
 * says" and "Ukrainian attack on Bryansk Region kills one civilian — governor"
 * passed for one story.
 */
const HEADLINE_FILLER = new Set([
  'get', 'gets', 'got', 'getting', 'make', 'makes', 'made', 'take', 'takes', 'took', 'call', 'calls', 'called',
  'amid', 'latest', 'live', 'news', 'watch', 'video', 'videos', 'photos', 'how', 'why', 'what', 'who', 'where',
  'here', 'now', 'today', 'yesterday', 'week', 'day', 'year', 'years', 'say', 'tell', 'tells', 'told',
  'governor', 'official', 'officials', 'authorities', 'spokesman', 'spokeswoman', 'spokesperson', 'media',
  'source', 'sources', 'report', 'claims', 'claim',
  'against', 'about', 'across', 'around', 'toward', 'towards', 'despite', 'among', 'between', 'within',
  'under', 'off', 'onto', 'upon', 'via', 'per', 'near', 'behind', 'beyond', 'until', 'since',
])

/**
 * Kinds of events and their usual actors, as stemWord leaves them: two
 * headlines that share only these and a country may be two events of one war.
 */
const EVENT_WORDS = new Set([
  'attack', 'kill', 'strik', 'struck', 'protes', 'dead', 'death', 'die', 'died', 'injur', 'wound', 'war', 'clash',
  'fight', 'bomb', 'missil', 'dron', 'shoot', 'shot', 'shell', 'raid', 'explos', 'blast', 'crash', 'fir', 'flood',
  'storm', 'earthq', 'quak', 'arrest', 'detain', 'detent', 'polic', 'milita', 'troop', 'forc', 'soldi', 'civili',
  'lead', 'govern', 'presid', 'minist', 'peopl', 'russia', 'countr', 'nation', 'state',
])

/** A shared word that singles out a story: a name, a thing, a count of 3 or more; not a country or kind of event */
function isParticular(word: string): boolean {
  if (word.startsWith('@')) return false
  if (word.startsWith('#')) return Number(word.slice(1)) >= 3
  return !EVENT_WORDS.has(word)
}

/** Endings dropped so a word's forms compare equal, tried in order (one per word) */
const ENDINGS = ['ings', 'ing', 'ied', 'ies', 'ers', 'ed', 'es', 'er', 's', 'e', 'y']

/** One form for a word's variants: "attacks"/"attacked" → "attack", "injuries"/"injured" → "injur" */
export function stemWord(word: string): string {
  let w = word
  for (const end of ENDINGS) {
    if (w.endsWith(end) && w.length - end.length >= 3) { w = w.slice(0, -end.length); break }
  }
  // "Arabian"/"Arabia", "Ukrainian"/"Ukraine": the first six letters carry the word
  return w.slice(0, 6)
}

const storyWordCache = new Map<string, Set<string>>()

/**
 * What a headline says, for telling whether two are the same story: its
 * content words in one form each, its numbers marked "#12" (in digits or
 * words, years too) and the countries it is about, marked "@SA", in
 * place of the place names (a city counts for its country, once).
 * Rewordings of one event then share most of these: "12 killed, 309 injured
 * in Riyadh Airport attack" and "A dozen killed in Saudi Arabian airport
 * attack" share #12, kill, airport, attack and @SA, where their plain words
 * shared 3 of 9.
 */
export function storyWords(title: string): Set<string> {
  const known = storyWordCache.get(title)
  if (known) return known
  const words = new Set<string>()
  // Places count once each, as their country: "Riyadh" and "Saudi Arabian" both become @SA
  const { countries, rest } = splitPlaces(title)
  const text = rest.toLowerCase().replace(/(\d),(?=\d{3}\b)/g, '$1')
  for (const raw of text.replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/)) {
    if (!raw) continue
    if (/^\d+$/.test(raw)) { words.add(`#${Number(raw)}`); continue }
    if (COUNT_WORDS[raw]) { words.add(`#${COUNT_WORDS[raw]}`); continue }
    if (raw.length < 3 || STOP_WORDS.has(raw) || HEADLINE_FILLER.has(raw)) continue
    words.add(stemWord(raw))
  }
  for (const code of countries) words.add(`@${code}`)
  if (storyWordCache.size >= 5000) storyWordCache.clear()
  storyWordCache.set(title, words)
  return words
}

/**
 * Whether two signals are independent reports of the same story: two different
 * known outlets, within the time window, near each other when both are on the
 * map, and headlines that share most of their content words. Short or
 * templated headlines ("Protest in Jaipur, Rajasthan, India") never qualify:
 * they don't carry enough of the story to compare.
 */
export function isSameStory(a: CorrelationCandidate, b: CorrelationCandidate): boolean {
  if (!a.source_id || !b.source_id || a.source_id === b.source_id) return false
  // GDELT's "<event label> in <place>" titles name an event type and a place,
  // not a story ("Armed conflict in Washington, District of Columbia, ...")
  if (isEventTemplateTitle(a.title) || isEventTemplateTitle(b.title)) return false
  if (temporalScore(a, b) <= 0) return false
  if (a.lat != null && a.lng != null && b.lat != null && b.lng != null &&
      haversineKm(a.lat, a.lng, b.lat, b.lng) > SAME_STORY_RADIUS_KM) return false

  const wordsA = storyWords(a.title ?? '')
  const wordsB = storyWords(b.title ?? '')
  if (wordsA.size < SAME_STORY_MIN_WORDS || wordsB.size < SAME_STORY_MIN_WORDS) return false

  // A count both give is shared evidence; a count only one gives says nothing
  // against (early and later tolls, "Hurricane Simon strengthens" / "... into Category 4")
  let shared = 0
  let all = 0
  for (const w of wordsA) {
    const both = wordsB.has(w)
    if (both) shared++
    if (both || !w.startsWith('#')) all++
  }
  for (const w of wordsB) if (!wordsA.has(w) && !w.startsWith('#')) all++
  const jaccard = shared / Math.max(1, all)
  if (shared < SAME_STORY_MIN_SHARED || jaccard < SAME_STORY_MIN_JACCARD) return false
  // ...and something particular in common: a name, a thing or a count, not just
  // the kind of event and the country ("Russian attack kills seven in Ukraine's
  // Zaporizhzhia" and "Russian attacks kill 24 across Ukraine" share only that)
  if (![...wordsA].some(w => wordsB.has(w) && isParticular(w))) return false

  // Headlines that name different known places are different events, however
  // alike the rest is ("Explosion hits Kherson" / "Explosion hits Kyiv")
  const placeA = findGazetteerPlace(a.title ?? '')
  const placeB = findGazetteerPlace(b.title ?? '')
  if (placeA && placeB && placeA.place !== placeB.place) return false
  return true
}

/**
 * Whether each headline names someone or somewhere the other doesn't: a
 * capitalised word (not the first word) missing from the other headline.
 * Two stories that share a headline template but differ in that name
 * ("Russia launches drone attack on Kyiv" / "... on Odesa") collide on the
 * scraper's topic hash, so merged articles must pass this too.
 */
export function namesDiffer(a: string, b: string): boolean {
  const tidy = (t: string) => t.replace(/[\u2018\u2019]/g, "'")
  const names = (t: string) => new Set(
    tidy(t).split(/\s+/).slice(1)
      .flatMap(w => w.replace(/'s\b/g, '').split(/[^\p{L}\p{N}]+/u))
      .filter(w => /^\p{Lu}/u.test(w) && w.length > 1)
      .map(w => w.toLowerCase()),
  )
  const words = (t: string) => new Set(tidy(t).toLowerCase().replace(/'s\b/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean))
  const [na, nb] = [names(a), names(b)]
  const [wa, wb] = [words(a), words(b)]
  const onlyA = [...na].some(n => !wb.has(n))
  const onlyB = [...nb].some(n => !wa.has(n))
  return onlyA && onlyB
}

// ─── CORRELATION TYPE DETERMINATION ──────────────────────────────────────────

function determineCorrelationType(
  a: CorrelationCandidate,
  b: CorrelationCandidate,
): CorrelationType {
  const geo = geoScore(a, b)
  const causal = causalScore(a, b)
  const temporal = temporalScore(a, b)
  const keyword = keywordScore(a, b)

  const factors = [
    geo > 0.5 ? 1 : 0,
    causal > 0.5 ? 1 : 0,
    temporal > 0.5 ? 1 : 0,
    keyword > 0.3 ? 1 : 0,
  ].reduce((sum, v) => sum + v, 0)

  if (factors >= 3) return 'multi_factor'
  if (causal >= 0.8) return 'causal_chain'
  if (geo >= 0.7 && temporal >= 0.5) return 'geo_temporal'
  return 'keyword_overlap'
}

// ─── CLUSTER MANAGEMENT ──────────────────────────────────────────────────────

function generateClusterId(): string {
  const ts = Date.now().toString(36)
  const rand = createHash('md5').update(Math.random().toString()).digest('hex').slice(0, 8)
  return `evt_${ts}_${rand}`
}

async function findExistingCluster(signalIds: string[]): Promise<string | null> {
  for (const id of signalIds) {
    const clusterId = await redis.get(`correlation:signal:${id}`)
    if (clusterId) return clusterId
  }
  return null
}

async function createCluster(
  primary: CorrelationCandidate,
  correlations: Array<{ candidate: CorrelationCandidate; score: number; type: CorrelationType }>,
): Promise<EventCluster> {
  const clusterId = generateClusterId()
  const allSignals = [primary, ...correlations.map(c => c.candidate)]

  // Determine primary signal (highest severity, then highest reliability)
  const sorted = [...allSignals].sort((a, b) => {
    const sevDiff = (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0)
    if (sevDiff !== 0) return sevDiff
    return b.reliability_score - a.reliability_score
  })

  const primarySignal = sorted[0] ?? primary
  const avgScore = correlations.reduce((sum, c) => sum + c.score, 0) / correlations.length

  // Determine overall correlation type
  const typeCounts: Record<string, number> = {}
  for (const c of correlations) {
    typeCounts[c.type] = (typeCounts[c.type] ?? 0) + 1
  }
  const dominantType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as CorrelationType ?? 'keyword_overlap'

  const cluster: EventCluster = {
    cluster_id: clusterId,
    primary_signal_id: primarySignal.id,
    signal_ids: allSignals.map(s => s.id),
    categories: [...new Set(allSignals.map(s => s.category))],
    // Only real source keys count: an unknown source is not an independent one
    sources: [...new Set(allSignals.map(s => s.source_id).filter(Boolean))],
    severity: primarySignal.severity,
    correlation_type: dominantType,
    correlation_score: avgScore,
    created_at: new Date().toISOString(),
  }

  await persistCluster(cluster)
  return cluster
}

async function extendCluster(
  existingClusterId: string,
  newSignal: CorrelationCandidate,
  correlations: Array<{ candidate: CorrelationCandidate; score: number; type: CorrelationType }>,
): Promise<EventCluster> {
  const raw = await redis.get(`correlation:cluster:${existingClusterId}`)
  if (!raw) {
    // Cluster expired, create new one
    return createCluster(newSignal, correlations)
  }

  const existing = JSON.parse(raw) as EventCluster

  // Don't exceed max cluster size
  if (existing.signal_ids.length >= MAX_CLUSTER_SIZE) {
    return existing
  }

  // Add new signal
  if (!existing.signal_ids.includes(newSignal.id)) {
    existing.signal_ids.push(newSignal.id)
  }

  // Update categories and sources
  existing.categories = [...new Set([...existing.categories, newSignal.category])]
  existing.sources = [...new Set([...existing.sources, newSignal.source_id].filter(Boolean))]

  // Update severity if new signal is higher
  if ((SEVERITY_ORDER[newSignal.severity] ?? 0) > (SEVERITY_ORDER[existing.severity] ?? 0)) {
    existing.severity = newSignal.severity
    existing.primary_signal_id = newSignal.id
  }

  // Update correlation score (rolling average)
  const avgNew = correlations.reduce((sum, c) => sum + c.score, 0) / correlations.length
  existing.correlation_score = (existing.correlation_score + avgNew) / 2

  // Upgrade type to multi_factor if categories > 2
  if (existing.categories.length >= 3) {
    existing.correlation_type = 'multi_factor'
  }

  await persistCluster(existing)
  return existing
}

async function persistCluster(cluster: EventCluster): Promise<void> {
  const pipeline = redis.pipeline()

  // Store cluster data
  pipeline.setex(
    `correlation:cluster:${cluster.cluster_id}`,
    CORRELATION_TTL,
    JSON.stringify(cluster)
  )

  // Map each signal to its cluster
  for (const signalId of cluster.signal_ids) {
    pipeline.setex(`correlation:signal:${signalId}`, CORRELATION_TTL, cluster.cluster_id)
  }

  // Store in sorted set for recent cluster lookups
  pipeline.zadd('correlation:recent', Date.now().toString(), cluster.cluster_id)

  // Trim old entries from recent set (keep last 1000)
  pipeline.zremrangebyrank('correlation:recent', 0, -1001)

  await pipeline.exec()
}

// ─── RELIABILITY BOOST ───────────────────────────────────────────────────────

/**
 * Corroboration: a signal and the other outlets' reports of the same story
 * (see isSameStory) gain reliability and, at 0.65 or above, move from pending
 * to verified. Only that group is touched, never a whole cluster of related
 * signals. A signal is boosted only when the number of independent outlets
 * reporting it grows (tracked in source_count), so repeat matches can't
 * ratchet its reliability up.
 */
async function applyCorroborationBoost(
  signal: CorrelationCandidate,
  sameStory: CorrelationCandidate[],
): Promise<void> {
  const group = [signal, ...sameStory]
  // Copies of one article on sister sites, or a wire headline reprinted word
  // for word, are one outlet (pipeline/independence.ts)
  const uniqueSources = countIndependentOutlets(group)
  if (uniqueSources < 2) return // Need 2+ independent outlets

  const ids = group.map(s => s.id)
  try {
    // Boost only signals whose count of independent outlets just went up
    const boosted = await db('signals')
      .whereIn('id', ids)
      .where(function () {
        this.whereNull('source_count').orWhere('source_count', '<', uniqueSources)
      })
      .update({
        // The outlets it gained: from its stored count (old value) to uniqueSources
        reliability_score:    corroboratedReliabilitySql('? - COALESCE(source_count, 1)', [uniqueSources]),
        source_count:         uniqueSources,
        last_corroborated_at: db.raw('NOW()'),
      })

    // Promote pending → verified when corroboration pushes the score above the
    // threshold: independent outlets reporting the same story is what verifies
    // a signal that started as pending (single source).
    const promoted = await db('signals')
      .whereIn('id', ids)
      .where('status', 'pending')
      .where('source_count', '>=', 2)
      .where('reliability_score', '>=', 0.65) // lower threshold for corroborated signals
      .update({
        status:      'verified',
        verified_at: db.raw('NOW()'),
      })

    // Ledger's cross-check: Claude reads the reports of a story that just
    // turned verified and records whether they're one event (pipeline/crosscheck.ts)
    if (promoted > 0) crossCheckLater(ids)

    // With the outlets counted, the single-source severity cap lifts: each
    // report gets the severity its own words earn, up to what the count allows
    const rows = await db('signals').whereIn('id', ids)
      .select('id', 'title', 'summary', 'category', 'severity') as SeverityRow[]
    let raised = 0
    for (const row of rows) {
      const severity = liftedSeverity(row, uniqueSources)
      if (!severity) continue
      await db('signals').where('id', row.id).update({ severity })
      raised++
    }

    // Every member gets the group's article links, so each signal page can
    // show all the outlets that reported the story ("Reported by N outlets"),
    // not only its own link
    const urls = [...new Set(group.map(s => s.url).filter((u): u is string => typeof u === 'string' && u.length > 0))]
    if (urls.length >= 2) {
      await db('signals')
        .whereIn('id', ids)
        .update({
          original_urls: db.raw(
            'original_urls || ARRAY(SELECT u FROM unnest(?::text[]) AS u WHERE u <> ALL(original_urls))',
            [urls.slice(0, MAX_CLUSTER_SIZE)],
          ),
        })
    }

    // One story id for the group, so the feed can show it as one story
    const joined = await joinStory(ids).catch(err => {
      logger.warn({ err, signal_id: signal.id }, 'Failed to join signals into one story')
      return 0
    })

    logger.info({
      signal_id:      signal.id,
      matches:        sameStory.map(s => s.id).slice(0, 10),
      unique_sources: uniqueSources,
      boosted_count:  boosted,
      promoted_count: promoted,
      severity_raised: raised,
      joined_story:   joined,
    }, 'Same story from %d outlets', uniqueSources)
  } catch (err) {
    logger.warn({ err, signal_id: signal.id }, 'Failed to apply corroboration boost')
  }
}

/**
 * A report that was dropped as a duplicate (near-identical headline within 6
 * hours, see dedup.claimCrossSource) is still evidence when another outlet
 * published it. If it describes the same story (isSameStory) and its outlet
 * hasn't been counted yet, credit the existing signal with it: one more
 * source, a reliability boost, and verified once it qualifies. Returns
 * whether the signal was credited.
 */
export async function corroborateWithDuplicate(
  existingId: string,
  incoming: Pick<CorrelationCandidate, 'title' | 'category' | 'severity' | 'source_id' | 'lat' | 'lng' | 'published_at'> & { url: string | null },
): Promise<boolean> {
  const row = await db('signals').where('id', existingId).first(
    'id', 'title', 'category', 'severity', 'source_ids', 'original_urls',
    db.raw('COALESCE(event_time, created_at) as published_at'),
    db.raw('ST_Y(location::geometry) as lat'),
    db.raw('ST_X(location::geometry) as lng'),
  ) as Record<string, unknown> | undefined
  if (!row) return false

  // Already counted? Compare with every source id and every website stored on the signal
  const storedIds = Array.isArray(row.source_ids) ? row.source_ids.map(String) : []
  const storedUrls = Array.isArray(row.original_urls) ? row.original_urls.map(String) : []
  const counted = new Set([...storedIds, ...storedUrls.map(hostOf)].filter(Boolean))
  const incomingHost = hostOf(incoming.url)
  if (!incoming.source_id || counted.has(incoming.source_id) || (incomingHost && counted.has(incomingHost))) return false
  // A copy of the held report (same article slug, or the same headline word for
  // word) is the same reporting on another website, not independent evidence
  if (isCopyOf({ url: incoming.url, title: incoming.title }, { urls: storedUrls, title: typeof row.title === 'string' ? row.title : null })) return false

  const existing = toCandidate({ ...row, source_id: storedIds[0] ?? null, first_url: storedUrls[0] ?? null, location_name: null, reliability_score: 0, tags: [] })
  if (!isSameStory(existing, { ...existing, ...incoming, id: 'incoming' })) return false

  const update: Record<string, unknown> = {
    source_count:         db.raw('GREATEST(COALESCE(source_count, 1), 1) + 1'),
    reliability_score:    corroboratedReliabilitySql('1'),
    last_corroborated_at: db.raw('NOW()'),
  }
  if (incoming.url) update.original_urls = db.raw('array_append(COALESCE(original_urls, ARRAY[]::text[]), ?)', [incoming.url])
  await db('signals').where('id', existingId).update(update)

  const promoted = await db('signals')
    .where('id', existingId)
    .where('status', 'pending')
    .where('source_count', '>=', 2)
    .where('reliability_score', '>=', 0.65)
    .update({ status: 'verified', verified_at: db.raw('NOW()') })

  if (promoted > 0) crossCheckLater([existingId], [{ title: incoming.title }])

  logger.info({
    signal_id: existingId,
    outlet:    incoming.source_id,
    promoted,
  }, 'Duplicate report from another outlet corroborated a signal')
  return true
}

/**
 * A later article from a new outlet joined a story through the scraper's
 * topic hash (processArticleGroup) and was already counted as a source. The
 * topic hash only compares the first five long words, so this checks the
 * article really is the same story (isSameStory, and no name only one of the
 * headlines has) before the story gains reliability and, once it qualifies,
 * verified. Returns whether it confirmed the story.
 */
export async function confirmMergedArticle(
  signalId: string,
  incoming: Pick<CorrelationCandidate, 'title' | 'source_id' | 'published_at'>,
): Promise<boolean> {
  const row = await db('signals').where('id', signalId).first(
    'id', 'title', 'category', 'severity', 'source_ids', 'original_urls',
    db.raw('COALESCE(event_time, created_at) as published_at'),
    db.raw('ST_Y(location::geometry) as lat'),
    db.raw('ST_X(location::geometry) as lng'),
  ) as Record<string, unknown> | undefined
  if (!row) return false

  const storedIds = Array.isArray(row.source_ids) ? row.source_ids.map(String) : []
  const storedUrls = Array.isArray(row.original_urls) ? row.original_urls.map(String) : []
  const held = toCandidate({ ...row, source_id: storedIds[0] ?? null, first_url: storedUrls[0] ?? null, location_name: null, reliability_score: 0, tags: [] })
  const article: CorrelationCandidate = { ...held, ...incoming, id: 'incoming', lat: null, lng: null }
  if (!isSameStory(held, article) || namesDiffer(held.title, article.title)) return false

  await db('signals').where('id', signalId).update({
    reliability_score:    corroboratedReliabilitySql('1'),
    last_corroborated_at: db.raw('NOW()'),
  })
  const promoted = await db('signals')
    .where('id', signalId)
    .where('status', 'pending')
    .where('source_count', '>=', 2)
    .where('reliability_score', '>=', 0.65)
    .update({ status: 'verified', verified_at: db.raw('NOW()') })

  if (promoted > 0) crossCheckLater([signalId], [{ title: incoming.title }])

  logger.info({ signal_id: signalId, outlet: incoming.source_id, promoted },
    'Merged article from another outlet confirmed a story')
  return true
}

// ─── API: GET CORRELATED SIGNALS ─────────────────────────────────────────────

/**
 * Get the event cluster for a given signal (if any).
 * Used by the API to show "Related signals" on detail pages.
 */
export async function getClusterForSignal(signalId: string): Promise<EventCluster | null> {
  const clusterId = await redis.get(`correlation:signal:${signalId}`)
  if (!clusterId) return null

  const raw = await redis.get(`correlation:cluster:${clusterId}`)
  if (!raw) return null

  return JSON.parse(raw) as EventCluster
}

/**
 * Get recent event clusters, ordered by creation time.
 */
export async function getRecentClusters(limit: number = 20): Promise<EventCluster[]> {
  const clusterIds = await redis.zrevrange('correlation:recent', 0, limit - 1)
  if (clusterIds.length === 0) return []

  const pipeline = redis.pipeline()
  for (const id of clusterIds) {
    pipeline.get(`correlation:cluster:${id}`)
  }
  const results = await pipeline.exec()
  if (!results) return []

  return results
    .map(([err, val]) => (err || !val) ? null : JSON.parse(val as string) as EventCluster)
    .filter((c): c is EventCluster => c !== null)
}

// ─── HELPER FUNCTIONS ────────────────────────────────────────────────────────

/**
 * Haversine distance in kilometers.
 */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371 // Earth radius in km
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180)
}

/** Category family grouping for partial causal matching (uses actual DB enum values) */
function getCategoryFamily(category: string): string | null {
  const families: Record<string, string> = {
    conflict:    'security',
    security:    'security',
    geopolitics: 'security',
    elections:   'political',
    culture:     'political',
    climate:     'environment',
    disaster:    'environment',
    science:     'science_tech',
    technology:  'science_tech',
    space:       'science_tech',
    health:      'health',
    economy:     'economy',
    breaking:    'breaking',  // breaking is its own family — correlates via other factors
    sports:      'sports',
    other:       'other',
  }
  return families[category] ?? null
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
  'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than',
  'too', 'very', 'just', 'because', 'if', 'when', 'while', 'that',
  'this', 'these', 'those', 'it', 'its', 'new', 'up', 'out', 'over',
  'reports', 'reported', 'says', 'said', 'according', 'update', 'alert',
])

function extractSignificantWords(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w))
  )
}

function intersection<T>(a: Set<T>, b: Set<T>): Set<T> {
  const result = new Set<T>()
  for (const item of a) {
    if (b.has(item)) result.add(item)
  }
  return result
}

function union<T>(a: Set<T>, b: Set<T>): Set<T> {
  const result = new Set(a)
  for (const item of b) result.add(item)
  return result
}
