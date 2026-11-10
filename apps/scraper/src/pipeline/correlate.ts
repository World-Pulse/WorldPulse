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
import { findGazetteerPlace, oneArea, splitPlaces } from './geo'
import { isEventTemplateTitle } from './event-titles'
import { countIndependentOutlets, isCopyOf } from './independence'
import { joinStory, ensureStoryIdColumn } from './stories'
import { liftedSeverity, readLoweredSql, type SeverityRow } from './severity-lift'
import { crossCheckLater } from './crosscheck'
import { reindexLater } from './reindex'
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
export function corroboratedReliabilitySql(added: string, bindings: unknown[] = []) {
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
const SAME_STORY_RADIUS_KM = 300    // reports of an event tied to a spot must be near each other (see farApartEvents)

/**
 * A second look for a report that matched nothing the usual way (Nov 5, 2026, plan Q10: 24 places had
 * no verified story in the week to Oct 31). In small places one outlet's story is rarely told again
 * within the day in most of the same words: "Dubrovnik Airport faces €22 million EU repayment over
 * procurement irregularities" and "Dubrovnik Airport Scandal – Wrong Pipes Used, €22 Million Must be
 * Returned" (Croatia Week and Total Croatia News, 9 hours apart) share 31% of their words; Dominica's two
 * outlets carried the prime minister's Independence Day address 37 hours apart; weeklies print days
 * apart. The second look (secondLook) takes fewer words in common, but at least two that single the story
 * out and are not the day's busy words (BUSY_WORD_OUTLETS: on Nov 5, 2026 "Trump", "midterm", "Peña" and
 * "juicio político" were in hundreds of headlines about other angles of one big story); and up to
 * SLOW_WINDOW_HOURS apart only for two reports from the outlets of one thinly covered place (setThinPlaces).
 * Tried on a day of reports (17,525, Nov 5) and the 24 places' week before it is turned on: see
 * departments/data/q10-no-verified-story-2026-11-05.md.
 */
const SLOW_WINDOW_HOURS = Math.max(TEMPORAL_WINDOW_HOURS, Number(process.env.CORRELATION_SLOW_WINDOW_HOURS || 48))
const SECOND_LOOK_MIN_SHARED = 4
const SECOND_LOOK_MIN_JACCARD = 0.3
const SECOND_LOOK_MIN_STRONG = 2
/** A word this many outlets among a report's candidates use is the day's topic, not what singles a story out */
const BUSY_WORD_OUTLETS = 5

/** Places whose own feeds are few (set when the news reader starts: news-rss.ts thinPlaces), upper-case codes */
let thinPlaces: ReadonlySet<string> = new Set()
export function setThinPlaces(codes: Iterable<string>): void {
  thinPlaces = new Set([...codes].map(c => c.toUpperCase()))
}

/** The thinly covered places, upper-case codes (second-outlet.ts: the quiet places' everyday stories, Nov 10, 2026) */
export function thinPlaceCodes(): string[] {
  return [...thinPlaces].sort()
}

/** The thinly covered place whose outlet filed a report (its feed's country tag), or null */
export function thinHome(c: Pick<CorrelationCandidate, 'tags'>): string | null {
  const home = outletHome(c)
  return home && thinPlaces.has(home) ? home : null
}

/** The country of the outlet that filed a report: its feed's country tag (news feeds tag each item with it), or null */
export function outletHome(c: Pick<CorrelationCandidate, 'tags'>): string | null {
  const tag = (c.tags ?? []).find(t => /^[a-z]{2}$/.test(t))
  return tag ? tag.toUpperCase() : null
}

/** The words that BUSY_WORD_OUTLETS or more different outlets among these candidates use (not countries, counts or dates) */
export function busyWords(candidates: Iterable<CorrelationCandidate>): Set<string> {
  const outlets = new Map<string, Set<string>>()
  for (const c of candidates) {
    if (!c.source_id) continue
    for (const w of storyWords(c.title ?? '')) {
      if (/^[@#~%]/.test(w)) continue
      let set = outlets.get(w)
      if (!set) outlets.set(w, set = new Set())
      set.add(c.source_id)
    }
  }
  return new Set([...outlets].filter(([, set]) => set.size >= BUSY_WORD_OUTLETS).map(([w]) => w))
}

/** isSameStory's options: the second look, with the words busy among the report's candidates (correlateSignal only) */
export interface SameStoryOptions {
  secondLook?: { busy: ReadonlySet<string> }
}

/**
 * Kinds of story whose map point is where the event happened (an earthquake,
 * a storm, a crash), so two reports far apart are two events. For other
 * stories a report's point is a place it mentions, or its outlet's home city.
 */
const PLACE_BOUND_CATEGORIES = new Set(['disaster', 'weather', 'climate'])

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
    let sameStory = [...pool.values()].filter(c => isSameStory(signal, c))
    if (sameStory.length === 0) {
      // Nothing the usual way: the second look (see SLOW_WINDOW_HOURS), also at the day before for a
      // thinly covered place's own outlets
      if (thinHome(signal)) {
        const older = await fetchSameStoryCandidates(signal, true).catch(() => [] as CorrelationCandidate[])
        for (const c of older) pool.set(c.id, c)
      }
      const busy = busyWords(pool.values())
      sameStory = [...pool.values()].filter(c => isSameStory(signal, c, { secondLook: { busy } }))
    }
    if (sameStory.length > 0) {
      // ...kept to one story: a report that matches two stories doesn't join them (oneStory)
      const stories = await storiesOf(sameStory.map(c => c.id)).catch(() => new Map<string, string>())
      await applyCorroborationBoost(signal, oneStory(sameStory, stories))
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
 * compared. Only used for same-story corroboration, not for clusters. With
 * `older`, the day before the window (the second look, for thinly covered places).
 */
async function fetchSameStoryCandidates(signal: CorrelationCandidate, older = false): Promise<CorrelationCandidate[]> {
  // Each word by its stem, as a prefix ("attack:*" finds "attacks" and "attacked"; isSameStory compares stems).
  // Not its date: "october:*" and "2026:*" would find every daily feature
  const words = searchWords(signal.title ?? '')
  if (words.length < SAME_STORY_MIN_SHARED) return []
  const tsquery = words.map(w => `${w}:*`).join(' | ')
  // The day before by default; the second look's day before that (SLOW_WINDOW_HOURS) when asked
  const since = new Date(Date.now() - (older ? SLOW_WINDOW_HOURS : TEMPORAL_WINDOW_HOURS) * 60 * 60 * 1000)
  const until = older ? new Date(Date.now() - TEMPORAL_WINDOW_HOURS * 60 * 60 * 1000) : null

  let query = db('signals')
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
  if (until) query = query.where('created_at', '<', until.toISOString())
  const rows = await query
    .whereNot('id', signal.id)
    .whereRaw(`to_tsvector('simple', title) @@ to_tsquery('simple', ?)`, [tsquery])
    .orderByRaw(`ts_rank(to_tsvector('simple', title), to_tsquery('simple', ?)) DESC`, [tsquery])
    .limit(older ? 25 : 50)
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
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'tonight',
  'governor', 'official', 'officials', 'authorities', 'spokesman', 'spokeswoman', 'spokesperson', 'media',
  'source', 'sources', 'report', 'claims', 'claim',
  'against', 'about', 'across', 'around', 'toward', 'towards', 'despite', 'among', 'between', 'within',
  'under', 'off', 'onto', 'upon', 'via', 'per', 'near', 'behind', 'beyond', 'until', 'since',
  // Pronouns and forms of address (Nov 5, 2026): "His Majesty Sultan Haitham accorded official welcome in
  // Brunei" and "His Majesty the Sultan ... witness signing of several documents" shared "his", "majesty"
  // and "sultan", as Times of Oman's and The Arabian Stories' every headline of the visit did
  'his', 'her', 'hers', 'him', 'their', 'theirs', 'them', 'they', 'our', 'ours', 'your', 'yours', 'she',
  'majesty', 'highness', 'excellency', 'honourable', 'honorable',
])

/**
 * The little words of the feeds' other languages (Nov 5, 2026), as foldAccents leaves them: like "the" and
 * "of", they say nothing about which story it is. Without them two Spanish headlines shared "una" and
 * "nueva" as if they were words of the story ("Una nueva caravana de migrantes sale de Honduras..." and
 * "...Familias emprenden una nueva caravana"). Spanish, French, Italian, Portuguese, German, Dutch, Catalan,
 * Romanian, Albanian, the languages of the former Yugoslavia and Danish; words that are also English
 * headline words or names were left out (son, care, Kane, Jane, Das, CES, PAS, MAS, NAS, ALS, NYT).
 */
export const FUNCTION_WORDS = new Set((
  // es
  'los las una unos unas del con por para que sus sobre tras ante entre hasta desde sin este esta estos estas fue hay muy ser ' +
  'tiene tienen pero nueva nuevo nuevas nuevos otra otro otras otros cuando donde segun durante contra hacia tambien cual quien ' +
  'todo toda todos todas sera puede pueden hace dice dicen ' +
  // fr
  'les une des aux avec pour par sur dans qui ses est plus apres avant contre sans sous chez leur leurs cette ont ete etre tout ' +
  'tous toute toutes nouveau nouvelle nouvelles nouveaux selon lors depuis encore mais fait faire avoir comme aussi alors sont ' +
  'elle elles ils nous vous lui dont vers ' +
  // it
  'gli uno dei della delle dello degli dal dalla dalle dai dagli sul sulla sulle sui sugli tra fra che non piu alla alle agli ' +
  'allo nel nella nelle nei negli nello sono dopo anche questo questa quella quello suo sua suoi loro nuovo nuova nuovi nuove ' +
  'essere stato ancora ecco tutto tutti tutta senza oggi ieri cosa perche ' +
  // pt
  'umas uns dos nos pelo pela pelos pelas com seu seus suas mais apos sem sao foi tem onde novos novas isso esse essa ainda ' +
  'depois antes diz dizem ' +
  // de, nl
  'der das den des ein eine einen einem einer und oder auf bei nach von vor zum zur ist sind nicht auch wie wird werden wurde ' +
  'haben sich noch nur mehr gegen neue neuen neuer neues seit schon heute beim vom ins ihre ihr sein ' +
  'het een voor aan uit bij naar niet ook zijn wordt worden werd maar nog dat deze heeft hebben geen meer tegen onder nieuwe ' +
  'tussen sinds omdat wel ' +
  // ca, ro, sq
  'els amb dels pel pels seva aquest aquesta fins durant ' +
  'din pentru sunt dupa cel cea cei cele sau iar fost este dar prin spre catre fara intre despre acest aceasta noul unei unui ' +
  'cand unde ' +
  'dhe ose nje nuk eshte jane ishte kete kjo mbi deri edhe sot ' +
  // bs, hr, me, sr, sl (Latin script)
  'kod nakon zbog koji koja koje kojeg biti vise nije ili sto kao pri preko prema protiv tokom oko bez izmedju nove novi sve ' +
  'svi sta danas juce sutra ter tudi kot kjer zaradi proti brez nad bil bila bilo bodo lahko vec ' +
  // da
  'det til har ikke efter fra som vil skal blev bliver ved mellem nye hendes deres eller ogsa'
).split(' '))

/** Letters that lose their marks but don't come apart in Unicode's decomposition */
const LETTER_FOLDS: Record<string, string> = { 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'đ': 'd', 'ð': 'd', 'ł': 'l', 'ı': 'i', 'þ': 'th', 'ħ': 'h' }

/**
 * Lower-case text without its accents (Nov 5, 2026): "Mišo Kovač" and "Miso Kovac", "Sécurité" and
 * "securite" are one word each. Before, the accented letters were dropped and split the words ("mi",
 * "kova"; "d", "l", "gation" for "délégation"), so the same name in two outlets' spellings never matched.
 */
export function foldAccents(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/[ßæœøđðłıþħ]/g, ch => LETTER_FOLDS[ch] ?? ch)
}

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

/**
 * Ordinals, marked "%3": "Kenya confirms second Ebola case" and "... third
 * Ebola case" are two occurrences, not one story told twice (Oct 16, 2026).
 */
const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
}

/** A shared word that singles out a story: a name, a thing, a count of 3 or more; not a country, a date, an ordinal or a kind of event */
function isParticular(word: string): boolean {
  if (word.startsWith('@') || word.startsWith('~') || word.startsWith('%')) return false
  if (word.startsWith('#')) return Number(word.slice(1)) >= 3
  return !EVENT_WORDS.has(word)
}

/**
 * Dates in a headline, each as one word, "~10-15" (month-day, or as written
 * for 10/15/2026). Daily features carry the day's date in their headlines
 * ("Pix of the Day, 15 October, 2026", "Daily Cartoon, October 15, 2026",
 * "Morning Digest: October 15, 2026"), and its day and year counted as two
 * shared counts, which single out a story: photo galleries, cartoons, digests
 * and Wordle hints turned verified together (10 of the 30 "different event"
 * cross-check verdicts read on Oct 15, 2026). A date still counts as one
 * shared word, never as what singles a story out.
 */
const MONTH_NUMBER: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const MONTH_NAME = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?![a-z])\\.?'
const YEAR_AFTER = '(?:,?\\s*(?:19|20)\\d{2}(?!\\d))?'
const monthNumber = (name: string) => /^\d+$/.test(name) ? Number(name) : MONTH_NUMBER[name.slice(0, 3).toLowerCase()]
/** Each form of date and the word it becomes (g: the match, then its groups) */
const DATE_FORMS: Array<{ re: RegExp; word: (g: string[]) => string }> = [
  // 15 October, 2026 · 14th October 2026 · 15 Oct
  { re: new RegExp(`(?<![\\d.,/])\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_NAME}${YEAR_AFTER}`, 'gi'), word: g => `~${monthNumber(g[2]!)}-${Number(g[1])}` },
  // October 15, 2026 · October 15th · Sept. 17
  { re: new RegExp(`\\b${MONTH_NAME}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d.,]\\d)\\b${YEAR_AFTER}`, 'gi'), word: g => `~${monthNumber(g[1]!)}-${Number(g[2])}` },
  // October 2026
  { re: new RegExp(`\\b${MONTH_NAME},?\\s+((?:19|20)\\d{2})(?!\\d)`, 'gi'), word: g => `~${monthNumber(g[1]!)}/${g[2]}` },
  // 2026-10-15
  { re: /\b(?:19|20)\d{2}-(\d{1,2})-(\d{1,2})\b/g, word: g => `~${Number(g[1])}-${Number(g[2])}` },
  // 10/15/2026 · 15.10.2026, as written (which comes first differs by country)
  { re: /\b(\d{1,2})[/.](\d{1,2})[/.](?:(?:19|20)\d{2}|\d{2})\b/g, word: g => `~${Number(g[1])}-${Number(g[2])}` },
]

/** A headline without its dates, and the dates as words ("~10-15") */
export function takeDates(title: string): { text: string; dates: string[] } {
  const dates: string[] = []
  let text = title
  for (const { re, word } of DATE_FORMS) {
    text = text.replace(re, (...args: unknown[]) => {
      // (the match and its groups; then the offset and the whole string)
      const g = args.slice(0, -2).map(a => String(a ?? ''))
      // "Protesters march 3 miles", "prices may 2x": in lower case these are verbs, not months
      if (/\b(?:march|may)\b/.test(g[0]!)) return g[0]!
      dates.push(word(g))
      return ' '
    })
  }
  return { text, dates }
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

/**
 * Things many unrelated events happen to or in, as stemWord leaves them: like a toll, they single out no story
 * (see isSameStory). Defined after ENDINGS, which stemWord reads.
 */
const COMMON_THINGS = new Set([
  'helicopter', 'chopper', 'plane', 'airplane', 'aircraft', 'jet', 'airliner', 'flight', 'train', 'bus', 'minibus',
  'coach', 'boat', 'ship', 'ferry', 'vessel', 'tanker', 'truck', 'lorry', 'car', 'vehicle', 'motorcycle', 'pilot',
  'crew', 'passenger', 'building', 'bridge', 'mine', 'school', 'hospital', 'market', 'hotel', 'church', 'mosque',
  'temple', 'road', 'highway', 'station', 'airport', 'factory', 'plant', 'warehouse', 'tower', 'dam', 'house',
  'home', 'village',
].map(stemWord))

// ── Headlines in Arabic and Cyrillic letters (Nov 6, 2026; Devon: "proceed") ────────────────────────────────
// Until now storyWords read Latin letters only, so two Arabic or Russian headlines of one story had no words in
// common and an outlet in those scripts could never verify a story (Jordan's, Syria's and Bahrain's Arabic press,
// Kyrgyzstan's and Mongolia's Cyrillic press). Each script gets the same treatment as Latin words: its little words
// left out, one form for a word's variants, its countries marked "@JO", and its kinds of events and common things
// known, so they don't single out a story on their own. Latin headlines read exactly as before.

/** Arabic-Indic digits (٠١٢ and ۰۱۲) as 0-9, so a toll counts in either script */
export function westernDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, d => String(d.charCodeAt(0) & 0xf))
}

/** One spelling of an Arabic word, after foldAccents (which drops the vowel marks and hamzas): no tatweel, ى as ي, ة as ه */
function arabicLetters(word: string): string {
  return word.replace(/ـ/g, '').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
}

/** The article and the little words joined to it: "والحكومه", "بالعاصمه" and "للرئيس" are "حكومه", "عاصمه" and "رئيس" */
const ARABIC_ARTICLES = ['وال', 'بال', 'فال', 'كال', 'لل', 'ال']
export function arabicBase(word: string): string {
  let w = arabicLetters(word)
  for (const a of ARABIC_ARTICLES) if (w.startsWith(a) && w.length - a.length >= 2) { w = w.slice(a.length); break }
  // and "و" (and) or "ب" (in, by) joined to the word: "وزيارة" and "بحادث" are "زياره" and "حادث" (4 letters left: "وزير" stays)
  if ((w.startsWith('و') || w.startsWith('ب')) && w.length >= 5) w = w.slice(1)
  return w
}

/** One form for an Arabic word's variants: the article, then one plural, dual or feminine ending, leaving 3 letters */
const ARABIC_ENDINGS = ['ات', 'ون', 'ين', 'ان', 'يه', 'ه']
export function arabicStem(word: string): string {
  const w = arabicBase(word)
  for (const end of ARABIC_ENDINGS) if (w.endsWith(end) && w.length - end.length >= 3) return w.slice(0, -end.length)
  return w
}

/**
 * One form for a Russian, Kyrgyz or Mongolian word's variants: one case ending (the longest that leaves 3 letters),
 * then the first six letters, as for Latin words ("президента" and "президент" are "презид", "Москве" and
 * "Москва" "москв"). foldAccents has made й и and ё е.
 */
const CYRILLIC_ENDINGS = ['ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ах', 'ях', 'ам', 'ям', 'ов', 'ев', 'ом', 'ем',
  'ым', 'ои', 'еи', 'ыи', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ую', 'юю', 'а', 'я', 'ы', 'и', 'у', 'ю', 'е', 'о', 'ь']
export function cyrillicStem(word: string, agglutinative = false): string {
  let w = word
  for (const end of agglutinative ? STEPPE_ENDINGS : CYRILLIC_ENDINGS) {
    if (w.endsWith(end) && w.length - end.length >= 3) { w = w.slice(0, -end.length); break }
  }
  return w.slice(0, 6)
}

/**
 * Kyrgyz and Mongolian add their case and plural endings to the word ("Японд", to Japan; "Улсын", of the state):
 * a headline with ө, ү or ң, letters Russian doesn't use, has its words' endings taken off from these instead,
 * the longest first ("Японд" is "япон", "улсад" "улс", "төрийн" "төр")
 */
const STEPPE_ENDINGS = [
  // mn
  'нүүд', 'нууд', 'чууд', 'үүд', 'ууд', 'аас', 'ээс', 'оос', 'өөс', 'тай', 'тэй', 'той', 'руу', 'рүү', 'аар', 'ээр', 'оор', 'өөр',
  'иин', 'нии', 'ыг', 'иг', 'ын', 'ад', 'эд', 'од', 'өд',
  // ky
  'дын', 'дин', 'дун', 'дүн', 'тын', 'тин', 'тун', 'түн', 'нын', 'нин', 'нун', 'нүн', 'дан', 'ден', 'дон', 'дөн', 'тан', 'тен',
  'тон', 'төн', 'лар', 'лер', 'лор', 'лөр', 'дар', 'дер', 'дор', 'дөр', 'тар', 'тер', 'тор', 'төр', 'га', 'ге', 'го', 'гө', 'ка',
  'ке', 'ко', 'кө', 'да', 'де', 'до', 'дө', 'та', 'те', 'то', 'тө', 'ды', 'ди', 'ду', 'дү', 'ты', 'ти', 'ту', 'тү', 'ны', 'ни',
  'ну', 'нү', 'сы', 'си', 'су', 'сү',
  // mn, one letter
  'д', 'т', 'н', 'г',
].sort((a, b) => b.length - a.length)
const STEPPE_LETTERS = /[өүң]/u

// (Script_Extensions: the tatweel is a letter of Arabic and of other scripts)
const ARABIC_SCRIPT = /^\p{scx=Arabic}+$/u
const CYRILLIC_SCRIPT = /^\p{scx=Cyrillic}+$/u
/** A word's form in its script, as storyWords compares them (and the stop lists below are built) */
function otherScriptStem(word: string): string {
  const w = foldAccents(word)
  return ARABIC_SCRIPT.test(w) ? arabicStem(w) : cyrillicStem(w, STEPPE_LETTERS.test(w))
}
const stemsOf = (list: string) => new Set(list.split(/\s+/).filter(Boolean).map(otherScriptStem))

/** The little words, reporting verbs and headline labels of Arabic, Russian, Kyrgyz and Mongolian (as written; compared folded) */
const OTHER_SCRIPT_STOP = new Set([
  // ar
  'في من الى إلى على عن مع بعد قبل خلال حول ضد بين تحت فوق منذ حتى او أو ثم قد لم لن لا ما ان أن إن هذا هذه ذلك تلك التي الذي ' +
  'الذين هو هي هم كان كانت يكون كما اي أي كل عند لدى غير اكثر أكثر اول أول جديد جديدة يوم اليوم امس أمس عاجل فيديو صور ' +
  'بالصور بالفيديو شاهد تقرير قال قالت يقول تقول أكد اكد أكدت أعلن اعلن أعلنت مصدر مصادر نحو وسط إثر اثر عبر لدى',
  // ru
  'и в во на с со по для не что из к ко о об от за у до как это а но его ее её их при после над под без между уже также или ' +
  'ли же бы чем то все всё был была были будет быть может могут год года году заявил заявила заявили сообщил сообщила ' +
  'сообщили сегодня вчера новости видео фото срочно стало известно более около против через',
  // ky
  'жана менен үчүн боюнча деп бул ал да дагы анын алар болуп керек тууралуу кийин чейин',
  // mn
  'ба болон нь юм энэ тэр байна гэж гэв хийх тухай дээр үед шинэ өнөөдөр',
].join(' ').split(/\s+/).filter(Boolean).flatMap(w => [foldAccents(w), otherScriptStem(w)]))

/** Kinds of events and their usual actors (see EVENT_WORDS) */
for (const stem of stemsOf(
  // ar
  'قتل مقتل قتلى هجوم هجمات قصف غارة غارات انفجار إصابة إصابات جرحى شهيد شهداء حرب اشتباكات اعتقال الشرطة الجيش قوات ' +
  'رئيس الرئيس الحكومة وزير وزارة مجلس الدولة حريق فيضانات زلزال عاصفة حادث وفاة مواطن مواطنين شخص أشخاص ' +
  // ru, ky, mn
  'убит убиты погиб погибли погибших атака атаки удар удары обстрел взрыв ранен ранены раненых война войны бой бои арест ' +
  'задержан полиция армия военные военный президент правительство министр министерство глава власти страна государство ' +
  'пожар наводнение землетрясение авария человек люди граждане өкмөт милиция кырсык өрт ерөнхийлөгч засгийн сайд цагдаа ' +
  'гал осол хүн иргэд улс',
)) EVENT_WORDS.add(stem)

/** Numbers in words, as their stems: "ثلاثة" and "три" are #3, like "three" */
const OTHER_SCRIPT_COUNTS = new Map<string, number>(([
  [1, 'واحد один одна одного'], [2, 'اثنان اثنين اثنتان два две двое двух'], [3, 'ثلاث ثلاثة три трое трех'],
  [4, 'أربع أربعة четыре четырех'], [5, 'خمس خمسة пять пяти'], [6, 'ستة шесть шести'], [7, 'سبع سبعة семь семи'],
  [8, 'ثماني ثمانية восемь восьми'], [9, 'تسع تسعة девять девяти'], [10, 'عشر عشرة десять десяти'],
] as Array<[number, string]>).flatMap(([n, names]) => names.split(' ').map(w => [otherScriptStem(w), n] as [string, number])))

/** Things many unrelated events happen to or in (see COMMON_THINGS) */
for (const stem of stemsOf(
  'طائرة مروحية قطار حافلة سفينة قارب شاحنة سيارة مستشفى مدرسة سوق مسجد كنيسة جسر مبنى منزل فندق مطار ' +
  'самолет вертолет поезд автобус судно корабль лодка грузовик автомобиль машина больница школа рынок мечеть церковь мост ' +
  'здание дом гостиница отель аэропорт',
)) COMMON_THINGS.add(stem)

/**
 * Countries named in Arabic, Russian, Kyrgyz or Mongolian (their names, peoples and capitals): an Arabic word by its
 * form without the article (its endings stay: "حلبة", an arena, is not Aleppo, nor "عدنان" Aden), a Cyrillic word by its stem
 */
const OTHER_SCRIPT_COUNTRIES = new Map<string, string>(([
  ['JO', 'الأردن أردني الأردنية الأردنيين الأردنيون إربد العقبة'],
  ['SY', 'سوريا سورية سوري السورية السوريين السوريون دمشق حلب حمص إدلب درعا اللاذقية السويداء الحسكة'],
  ['BH', 'البحرين بحريني البحرينية البحرينيين البحرينيون المنامة المحرق'],
  ['LB', 'لبنان لبناني اللبنانية اللبنانيين اللبنانيون بيروت'],
  ['IQ', 'العراق عراقي العراقية بغداد البصرة الموصل أربيل'], ['EG', 'مصر مصري المصرية القاهرة'],
  ['SA', 'السعودية سعودي الرياض جدة مكة'], ['IR', 'إيران إيراني الإيرانية طهران'],
  ['IL', 'إسرائيل إسرائيلي الإسرائيلية الإسرائيليين الإسرائيليون'],
  ['PS', 'فلسطين فلسطيني الفلسطينية الفلسطينيين الفلسطينيون غزة'], ['AE', 'الإمارات إماراتي الإماراتية دبي أبوظبي'], ['QA', 'قطر قطري القطرية الدوحة'],
  ['KW', 'الكويت كويتي الكويتية'], ['YE', 'اليمن يمني اليمنية صنعاء عدن'], ['LY', 'ليبيا ليبي الليبية'], ['TN', 'تونس تونسي التونسية'],
  ['DZ', 'الجزائر جزائري الجزائرية'], ['MA', 'المغرب مغربي المغربية الرباط'], ['SD', 'السودان سوداني السودانية الخرطوم'],
  ['TR', 'تركيا التركية أنقرة إسطنبول اسطنبول'], ['RU', 'روسيا روسي الروسية موسكو'], ['UA', 'أوكرانيا أوكراني الأوكرانية كييف'],
  ['CN', 'الصين صيني الصينية بكين'], ['US', 'أمريكا أميركا أمريكي أميركي الأمريكية الأميركية واشنطن'],
  ['FR', 'فرنسا فرنسي الفرنسية باريس'], ['GB', 'بريطانيا بريطاني البريطانية لندن'], ['DE', 'ألمانيا ألماني الألمانية برلين'],
  ['IN', 'الهند هندي الهندية'], ['PK', 'باكستان باكستاني'], ['AF', 'أفغانستان أفغاني'], ['JP', 'اليابان ياباني اليابانية'],
  ['RU', 'россия россии российский российская рф москва москве орусия орос оросын'],
  ['KG', 'кыргызстан кыргызстана кыргызстане кыргызский кыргыз киргизия бишкек бишкеке'],
  ['KZ', 'казахстан казахский астана алматы'], ['UZ', 'узбекистан узбекский ташкент'], ['TJ', 'таджикистан таджикский душанбе'],
  ['TM', 'туркменистан'], ['MN', 'монголия монголии монгол монгольский улаанбаатар'],
  ['CN', 'китай китая китайский хятад кытай'], ['US', 'сша америка американский ану акш'],
  ['UA', 'украина украины украинский киев'], ['BY', 'беларусь белоруссия минск'], ['TR', 'турция турции турецкий түркия'],
  ['IR', 'иран ирана иранский'], ['JP', 'япония японии японский япон'], ['DE', 'германия германии'],
  ['FR', 'франция франции'], ['GB', 'великобритания британия'], ['IN', 'индия индии'], ['AF', 'афганистан'], ['PK', 'пакистан'],
] as Array<[string, string]>).flatMap(([code, names]) => names.split(' ').flatMap(n => {
  const w = foldAccents(n)
  return ARABIC_SCRIPT.test(w) ? [[arabicBase(w), code]] : [[cyrillicStem(w), code], [cyrillicStem(w, true), code]]
}) as Array<[string, string]>))

/** Arabic country names of two words, found before the words are split (as foldAccents leaves them); with a city's name */
const ARABIC_COUNTRY_PHRASES: Array<[RegExp, string, string?]> = [
  [/الولايات\s+المتحد[ةه](?:\s+الامريكي[ةه]|\s+الاميركي[ةه])?/g, 'US'], [/المملك[ةه]\s+المتحد[ةه]/g, 'GB'],
  [/المملك[ةه]\s+العربي[ةه]\s+السعودي[ةه]/g, 'SA'], [/سلطن[ةه]\s+عمان/g, 'OM'], [/تل\s+ابيب/g, 'IL', 'تل ابيب'],
  [/الضف[ةه]\s+الغربي[ةه]/g, 'PS'], [/رام\s+الله/g, 'PS', 'رام الله'], [/دير\s+الزور/g, 'SY', 'دير الزور'],
  [/ابو\s+ظبي/g, 'AE', 'ابوظبي'],
]

/**
 * The cities among those names: headlines that each name a city, and none the same, tell of two events, as
 * isSameStory reads the place list's cities ("مقتل 3 أشخاص في قصف على ريف إدلب" is not "... في انفجار في حلب")
 */
const OTHER_SCRIPT_CITIES = new Set(('إربد العقبة دمشق حلب حمص إدلب درعا اللاذقية السويداء الحسكة المنامة المحرق بيروت بغداد البصرة ' +
  'الموصل أربيل القاهرة الرياض جدة مكة طهران دبي أبوظبي الدوحة صنعاء عدن الرباط الخرطوم أنقرة إسطنبول موسكو كييف بكين واشنطن ' +
  'باريس لندن برلين غزة бишкек астана алматы ташкент душанбе улаанбаатар москва киев минск').split(' ').map(n => {
  const w = foldAccents(n)
  return ARABIC_SCRIPT.test(w) ? arabicBase(w) : cyrillicStem(w)
}))
const OTHER_SCRIPT_LETTERS = /[\u0600-\u06FF\u0400-\u04FF]/

/** The cities a headline names in Arabic or Cyrillic letters (see OTHER_SCRIPT_CITIES) */
export function otherScriptCities(title: string): string[] {
  if (!OTHER_SCRIPT_LETTERS.test(title)) return []
  let text = foldAccents(title)
  const out: string[] = []
  for (const [re, , city] of ARABIC_COUNTRY_PHRASES) if (city) text = text.replace(re, () => { out.push(city); return ' ' })
  for (const token of text.split(/[^\p{L}]+/u)) {
    if (!token) continue
    const key = ARABIC_SCRIPT.test(token) ? arabicBase(token) : CYRILLIC_SCRIPT.test(token) ? cyrillicStem(token) : ''
    if (key && OTHER_SCRIPT_CITIES.has(key) && !out.includes(key)) out.push(key)
  }
  return out
}

/**
 * The words of a headline's Arabic and Cyrillic parts, as storyWords compares them: stems, and the countries
 * named, marked "@JO" (text: the headline after foldAccents)
 */
export function otherScriptWords(text: string): string[] {
  const out: string[] = []
  let rest = text
  for (const [re, code] of ARABIC_COUNTRY_PHRASES) rest = rest.replace(re, () => { out.push(`@${code}`); return ' ' })
  const steppe = STEPPE_LETTERS.test(rest)
  for (const token of rest.split(/[^\p{L}]+/u)) {
    if (!token) continue
    const arabic = ARABIC_SCRIPT.test(token)
    if (!arabic && !CYRILLIC_SCRIPT.test(token)) continue
    if (OTHER_SCRIPT_STOP.has(token)) continue
    const stem = arabic ? arabicStem(token) : cyrillicStem(token, steppe)
    const code = OTHER_SCRIPT_COUNTRIES.get(arabic ? arabicBase(token) : stem) ?? (steppe ? OTHER_SCRIPT_COUNTRIES.get(cyrillicStem(token)) : undefined)
    if (code) { out.push(`@${code}`); continue }
    const count = OTHER_SCRIPT_COUNTS.get(stem)
    if (count !== undefined) { out.push(`#${count}`); continue }
    if (stem.length < (arabic ? 2 : 3) || OTHER_SCRIPT_STOP.has(stem)) continue
    out.push(stem)
  }
  return out
}

const storyWordCache = new Map<string, Set<string>>()
const storyPlaceCache = new Map<string, ReturnType<typeof splitPlaces>['places']>()

/** The gazetteer places a headline names, in order of mention (see isSameStory) */
function storyPlaces(title: string): ReturnType<typeof splitPlaces>['places'] {
  const known = storyPlaceCache.get(title)
  if (known) return known
  const { places } = splitPlaces(title)
  if (storyPlaceCache.size >= 5000) storyPlaceCache.clear()
  storyPlaceCache.set(title, places)
  return places
}

/**
 * What a headline says, for telling whether two are the same story: its
 * content words in one form each, its numbers marked "#12" (in digits or
 * words, years too), its ordinals marked "%3" ("third", "3rd") and the
 * countries it is about, marked "@SA", in
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
  // A date is one word ("~10-15"), not a day and a year counted as two numbers
  const { text: undated, dates } = takeDates(rest)
  for (const date of dates) words.add(date)
  // Accents folded (foldAccents): "Kovač" and "Kovac" are one word, not "kova" and "kovac"
  // (and Arabic-Indic digits as digits: a toll counts in either script)
  const text = foldAccents(westernDigits(undated)).replace(/(\d),(?=\d{3}\b)/g, '$1')
  for (const raw of text.replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/)) {
    if (!raw) continue
    if (/^\d+$/.test(raw)) { words.add(`#${Number(raw)}`); continue }
    // Own keys only: "constructor" is not a number
    if (Object.hasOwn(COUNT_WORDS, raw)) { words.add(`#${COUNT_WORDS[raw]}`); continue }
    const nth = /^(\d+)(?:st|nd|rd|th)$/.exec(raw)?.[1] ?? (Object.hasOwn(ORDINAL_WORDS, raw) ? ORDINAL_WORDS[raw] : undefined)
    if (nth !== undefined) { words.add(`%${Number(nth)}`); continue }
    if (raw.length < 3 || STOP_WORDS.has(raw) || HEADLINE_FILLER.has(raw) || FUNCTION_WORDS.has(raw)) continue
    words.add(stemWord(raw))
  }
  // Words in Arabic and Cyrillic letters (Nov 6, 2026), with the countries they name
  for (const word of otherScriptWords(text)) words.add(word)
  for (const code of countries) words.add(`@${code}`)
  if (storyWordCache.size >= 5000) storyWordCache.clear()
  storyWordCache.set(title, words)
  return words
}

/**
 * The words the same-story search looks for (fetchSameStoryCandidates), stems as prefixes, at most 12
 * of the headline's words: each as written, and without its accents when it has them, so "Kovač" finds
 * "Kovač" and "Kovac" (the database's word index keeps accents). A headline in plain letters gets the
 * same words as before Nov 5, 2026.
 */
export function searchWords(title: string): string[] {
  const keep = (w: string) => w.length >= 4 && !STOP_WORDS.has(w) && !HEADLINE_FILLER.has(w) && !FUNCTION_WORDS.has(w)
    && !OTHER_SCRIPT_STOP.has(foldAccents(w))
  const out: string[] = []
  let base = 0
  for (const token of takeDates(title).text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (base >= 12) break
    // As written in plain letters (as before), as written with its accents, and without them
    const forms = [...token.split(/[^a-z0-9]+/), token, foldAccents(token)]
    // An Arabic word also without its article and with it (Nov 6, 2026): "الحكومة" finds "حكومة" and the reverse
    if (ARABIC_SCRIPT.test(foldAccents(token))) {
      const stem = arabicStem(foldAccents(token))
      if (stem.length >= 3 && !OTHER_SCRIPT_STOP.has(stem) && !OTHER_SCRIPT_STOP.has(foldAccents(token))) forms.push(stem, `ال${stem}`)
    }
    let counted = false
    for (const form of forms) {
      if (!keep(form) || /[^\p{L}\p{N}]/u.test(form)) continue
      const stem = stemWord(form)
      if (stem.length < 4 || out.includes(stem)) continue
      if (!counted) { base++; counted = true }
      out.push(stem)
    }
  }
  return out
}

/** A shared word that singles a story out more than most: a name or a thing (not one many events share), or a sum of 10 or more that isn't a year */
function strongWord(word: string): boolean {
  if (word.startsWith('#')) {
    const n = Number(word.slice(1))
    return n >= 10 && (n < 1900 || n > 2100)
  }
  return isParticular(word) && !COMMON_THINGS.has(word)
}

/**
 * The second look (see SLOW_WINDOW_HOURS): headlines that share at least 4 words and 30% of them, 2
 * of them strongWords that aren't busy among the report's candidates (a city both name counts as one),
 * that name the same countries (or only one names any, and then 3: "Prime Minister Roosevelt Skerrit,
 * 48th Anniversary of Independence Address" and "2026 Independence Day Message from Prime Minister
 * Honourable Roosevelt Skerrit"), and whose sums of 10 or more agree when both give some ("Tonga beat
 * Samoa 20-18" is not "Tonga beat Fiji 30-10").
 */
function secondLook(a: CorrelationCandidate, b: CorrelationCandidate, wordsA: Set<string>, wordsB: Set<string>,
  shared: number, jaccard: number, busy: ReadonlySet<string>): boolean {
  if (shared < SECOND_LOOK_MIN_SHARED || jaccard < SECOND_LOOK_MIN_JACCARD) return false
  const cities = new Set(storyPlaces(a.title ?? '').map(p => p.place)
    .filter(place => storyPlaces(b.title ?? '').some(pb => pb.place === place)))
  for (const city of otherScriptCities(a.title ?? '')) if (otherScriptCities(b.title ?? '').includes(city)) cities.add(city)
  const strong = [...wordsA].filter(w => wordsB.has(w) && strongWord(w) && !busy.has(w)).length + cities.size
  if (strong < SECOND_LOOK_MIN_STRONG) return false
  // The countries: the same, or only one headline names any ("Paraguay President Santiago Peña resigns" /
  // "Santiago Peña promete acudir al juicio político en su contra"). With no country in common, 3 strongWords,
  // unless both outlets are the same thinly covered place's own (Dominica News Online and the prime minister's press room)
  const countries = (words: Set<string>) => [...words].filter(w => w.startsWith('@')).sort().join(' ')
  const countriesA = countries(wordsA)
  const countriesB = countries(wordsB)
  if (countriesA && countriesB && countriesA !== countriesB) return false
  // and 4 when the outlets are of two different countries ("Budget 2027 : le ministère de l'Économie dénonce
  // des manœuvres à l'Assemblée nationale" in Dakar and "Loi de finances 2027 : un budget ... à l'épreuve de
  // l'Assemblée nationale" in Antananarivo)
  const home = thinHome(a)
  const placeInCommon = (countriesA !== '' && countriesA === countriesB) || (home !== null && thinHome(b) === home)
  const homeA = outletHome(a)
  const homeB = outletHome(b)
  const need = placeInCommon ? SECOND_LOOK_MIN_STRONG : homeA && homeB && homeA !== homeB ? SECOND_LOOK_MIN_STRONG + 2 : SECOND_LOOK_MIN_STRONG + 1
  if (strong < need) return false
  const sums = (words: Set<string>) => [...words].filter(w => w.startsWith('#') && strongWord(w))
  const sumsA = sums(wordsA)
  const sumsB = sums(wordsB)
  if (sumsA.length > 0 && sumsB.length > 0 && !sumsA.some(w => wordsB.has(w))) return false
  return true
}

/**
 * Whether two signals are independent reports of the same story: two different
 * known outlets, within the time window, headlines that share most of their
 * content words and name no different places, and, for an event tied to a
 * spot, near each other on the map (farApartEvents). Short or templated
 * headlines ("Protest in Jaipur, Rajasthan, India") never qualify: they don't
 * carry enough of the story to compare.
 */
export function isSameStory(a: CorrelationCandidate, b: CorrelationCandidate, options: SameStoryOptions = {}): boolean {
  if (!a.source_id || !b.source_id || a.source_id === b.source_id) return false
  // GDELT's "<event label> in <place>" titles name an event type and a place,
  // not a story ("Armed conflict in Washington, District of Columbia, ...")
  if (isEventTemplateTitle(a.title) || isEventTemplateTitle(b.title)) return false
  // Within the day; a day or two apart only in the second look, for two reports from the outlets of one
  // thinly covered place (thinHome). Unreadable dates count as within the day, as before.
  const second = options.secondLook
  const hours = Math.abs(new Date(a.published_at).getTime() - new Date(b.published_at).getTime()) / (60 * 60 * 1000)
  const withinDay = !(hours >= TEMPORAL_WINDOW_HOURS)
  if (!withinDay) {
    const home = second && hours < SLOW_WINDOW_HOURS ? thinHome(a) : null
    if (!home || thinHome(b) !== home) return false
  }

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
  const firstLook = withinDay && shared >= SAME_STORY_MIN_SHARED && jaccard >= SAME_STORY_MIN_JACCARD
  // The second look is never for events tied to a spot (PLACE_BOUND_CATEGORIES), which recur there: an
  // aftershock, the next day's flood, two road accidents on San Marino's Superstrada in one day
  const placeBound = PLACE_BOUND_CATEGORIES.has(a.category) || PLACE_BOUND_CATEGORIES.has(b.category)
  if (!firstLook && (!second || placeBound || !secondLook(a, b, wordsA, wordsB, shared, jaccard, second.busy))) return false
  // ...and something particular in common: a name, a thing or a count, not just
  // the kind of event and the country ("Russian attack kills seven in Ukraine's
  // Zaporizhzhia" and "Russian attacks kill 24 across Ukraine" share only that)
  const particular = [...wordsA].filter(w => wordsB.has(w) && isParticular(w))
  if (particular.length === 0) return false
  // A toll is common to many events ("one killed, three injured"): when it is all
  // the two share, the countries they name must agree. "One killed, three injured
  // as gunmen attack NDC candidate's convoy" (Nigeria) and "One Indian killed, 3
  // injured in attacks in Saudi Arabia" passed for one story on Oct 23, 2026, and
  // put the Nigerian attack's headline on the Saudi airport attacks' story
  if (particular.every(w => w.startsWith('#'))) {
    const countriesA = [...wordsA].filter(w => w.startsWith('@'))
    const countriesB = [...wordsB].filter(w => w.startsWith('@'))
    if ((countriesA.length > 0 || countriesB.length > 0) && !countriesA.some(w => wordsB.has(w))) return false
  } else if (particular.every(w => w.startsWith('#') || COMMON_THINGS.has(w))) {
    // So are the things many events happen to (a helicopter, a train, a market): when they and a toll are all
    // the two share, two headlines that both name countries must name one in common. On Oct 30, 2026 an EU
    // helicopter crash in Bosnia, a midair collision in Oregon and a crash in India's Uttarakhand were one
    // story of 36 outlets, placed in Oregon. A headline naming no country is let be: "the EUFOR Helicopter
    // Crash in BiH" and "Drone Strike on Nyala Market" name theirs in words the place list doesn't read
    const countriesA = [...wordsA].filter(w => w.startsWith('@'))
    const countriesB = [...wordsB].filter(w => w.startsWith('@'))
    if (countriesA.length > 0 && countriesB.length > 0 && !countriesA.some(w => wordsB.has(w))) return false
  }
  // Headlines that each name a country the other doesn't tell of two events, though they share one
  // ("Tonga beat Samoa 20-18 to reach the Rugby League World Cup semi-finals" / "Tonga beat Fiji 30-10 to
  // reach ..." share 60% of their words; Nov 5, 2026)
  // (the Vatican counts as Italy here: "Bob Dylan meets Pope Leo at the Vatican" / "Pope Leo hosts Bob Dylan in Rome")
  const named = (words: Set<string>) => new Set([...words].filter(w => w.startsWith('@')).map(w => w === '@VA' ? '@IT' : w))
  const namedA = named(wordsA)
  const namedB = named(wordsB)
  if ([...namedA].some(c => !namedB.has(c)) && [...namedB].some(c => !namedA.has(c))) return false
  // Headlines whose first ordinals differ tell of two occurrences ("Kenya
  // confirms second Ebola case" / "... third Ebola case")
  const nthA = [...wordsA].find(w => w.startsWith('%'))
  const nthB = [...wordsB].find(w => w.startsWith('%'))
  if (nthA && nthB && nthA !== nthB) return false

  // Headlines that name different known places are different events, however
  // alike the rest is ("Explosion hits Kherson" / "Explosion hits Kyiv"). Every place
  // each names counts, and a state and a place in it are one area (geo.ts oneArea):
  // "Tinubu departs Abuja for Umrah at Makkah" and "Tinubu jets to Makkah for Umrah"
  // are one story, "Gunmen kill 12 in Borno" and "... near Maiduguri" too (Oct 30, 2026)
  const placesA = storyPlaces(a.title ?? '')
  const placesB = storyPlaces(b.title ?? '')
  const samePlace = placesA.some(pa => placesB.some(pb => oneArea(pa, pb)))
  if (placesA.length > 0 && placesB.length > 0 && !samePlace) return false
  // ...and the cities named in Arabic or Cyrillic letters (Nov 6, 2026)
  const citiesA = otherScriptCities(a.title ?? '')
  const citiesB = otherScriptCities(b.title ?? '')
  if (citiesA.length > 0 && citiesB.length > 0 && !citiesA.some(c => citiesB.includes(c))) return false
  if (farApartEvents(a, b, samePlace)) return false
  return true
}

/**
 * A report's same-story matches, kept to one story (Oct 30, 2026: a report that matched reports of two
 * different stories joined them, and Spain's train crash and the drone strike on Dnipro's train station
 * became one story of 132 outlets, at the top of the day's most-reported). When the matches sit in two or
 * more stories, the one with the most matches leads (the earliest on a tie), and another story's matches
 * stay only when one of them is the same story as one of the leader's. Matches in no story yet stay.
 */
export function oneStory(matches: CorrelationCandidate[], storyOf: ReadonlyMap<string, string>): CorrelationCandidate[] {
  const byStory = new Map<string, CorrelationCandidate[]>()
  for (const m of matches) {
    const story = storyOf.get(m.id)
    if (story) byStory.set(story, [...(byStory.get(story) ?? []), m])
  }
  if (byStory.size <= 1) return matches
  const time = (m: CorrelationCandidate) => new Date(m.published_at).getTime() || 0
  const earliest = (ms: CorrelationCandidate[]) => Math.min(...ms.map(time))
  const [lead, ...others] = [...byStory.values()].sort((a, b) => b.length - a.length || earliest(a) - earliest(b))
  const dropped = new Set<string>()
  for (const other of others) {
    if (!other.some(m => lead!.some(x => isSameStory(m, x)))) for (const m of other) dropped.add(m.id)
  }
  return matches.filter(m => !dropped.has(m.id))
}

/** The story each of these signals is in (only those in one) */
async function storiesOf(ids: string[]): Promise<Map<string, string>> {
  if (ids.length < 2 || !(await ensureStoryIdColumn())) return new Map()
  const rows = await db('signals').whereIn('id', ids).whereNotNull('story_id').select('id', 'story_id') as Array<{ id: string; story_id: string }>
  return new Map(rows.map(r => [String(r.id), String(r.story_id)]))
}

/**
 * Whether two reports of an event tied to a spot (PLACE_BOUND_CATEGORIES: an
 * earthquake off Aomori and one off Fukuoka) are too far apart on the map to
 * be one event. Only when both are pinned to more than a country and their
 * headlines don't name the same place: a report's map point is often its
 * outlet's home city (Lagos or Abuja for Nigerian papers, Chennai or New
 * Delhi for Indian ones) or a word read as a place ("French side" as French
 * Guiana, "Knowledge Centre" as Centre-Val de Loire). Until Oct 16, 2026 every
 * pair of reports more than 300 km apart was turned down: in 30 hours of
 * reports that was the only reason 566 pairs from independent outlets were
 * turned down, and of 180 of them read by hand, 166 (92%) were one story told
 * by two outlets. Ledger's cross-check still reads every story this verifies.
 */
export function farApartEvents(a: CorrelationCandidate, b: CorrelationCandidate, sameNamedPlace = false): boolean {
  if (sameNamedPlace) return false
  if (!PLACE_BOUND_CATEGORIES.has(a.category) && !PLACE_BOUND_CATEGORIES.has(b.category)) return false
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return false
  if (countryLevelPlace(a.location_name) || countryLevelPlace(b.location_name)) return false
  return haversineKm(a.lat, a.lng, b.lat, b.lng) > SAME_STORY_RADIUS_KM
}

/**
 * Whether a report's place is only a country ("Spain", "United Kingdom",
 * "DR Congo"), pinned at its capital: such a point says nothing about where
 * in the country the story happened
 */
export function countryLevelPlace(name: string | null | undefined): boolean {
  if (!name || findGazetteerPlace(name)) return false
  const { countries, rest } = splitPlaces(name)
  return countries.length > 0 && !/\p{L}/u.test(rest.replace(/\b(?:and|the|of)\b/gi, ''))
}

/** Words that open a headline with a colon as a label, not a name ("Breaking:", "Watch:") */
const HEADLINE_LABELS = new Set(['breaking', 'watch', 'video', 'videos', 'live', 'update', 'updated', 'opinion', 'analysis',
  'exclusive', 'explainer', 'explained', 'photos', 'pictures', 'gallery', 'editorial', 'report', 'news', 'just', 'listen',
  'podcast', 'interview', 'review', 'factbox', 'timeline', 'revealed', 'confirmed', 'official', 'urgent', 'alert', 'flash',
  'developing', 'latest', 'recap', 'quiz', 'poll', 'comment', 'letters', 'obituary'])

/** A headline as namesDiffer reads it: curly apostrophes straight, dotted acronyms one word ("U.S." is "US") */
function tidyHeadline(t: string): string {
  return t.replace(/[\u2018\u2019]/g, "'").replace(/(?<![\p{L}.])(?:\p{Lu}\.){2,}/gu, m => m.replace(/\./g, ''))
}
const tidy = tidyHeadline

/** Particles inside a name ("Lula da Silva", "Ursula von der Leyen") */
const NAME_PARTICLES = new Set(['da', 'de', 'do', 'dos', 'das', 'del', 'della', 'di', 'van', 'von', 'der', 'den', 'al', 'el', 'bin', 'ibn', 'la', 'le'])

/**
 * The name a headline opens with, when it is one (Nov 10, 2026). The first word's capital tells nothing, so
 * only: a hyphenated name ("Ramos-Horta"), a name of two or more capitalised words in a headline whose other
 * words aren't ("Xanana Gusmão meets …"), one with a capital inside ("McCarthy"), a possessive ("Putin's envoy
 * …") and an acronym ("NATO warns …"). An acronym is its own kind: "UN" and "United Nations" are one body. A
 * one-word name ("Putin meets …") can't be told from a word ("Gunmen kill …") and isn't read.
 */
export function leadName(title: string): { kind: 'name' | 'acronym'; words: string[] } | null {
  const words = tidy(title).split(/\s+/).filter(Boolean)
  const bare = (w: string) => w.replace(/[,;:.!?"”]+$/u, '')
  const parts = (w: string) => w.replace(/'s$/u, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(x => x.toLowerCase())
  const first = bare(words[0] ?? '')
  if (/^\p{Lu}{2,}$/u.test(first)) return { kind: 'acronym', words: [first.toLowerCase()] }
  if (/^\p{Lu}[\p{L}']*-\p{Lu}/u.test(first) || /^\p{Lu}\p{Ll}+\p{Lu}/u.test(first) || /^\p{Lu}\p{L}+'s$/u.test(first)) {
    return { kind: 'name', words: parts(first) }
  }
  const run: string[] = []
  for (const w of words.slice(0, 5)) {
    const b = bare(w)
    if (/^\p{Lu}\p{Ll}/u.test(b)) run.push(b)
    else if (run.length > 0 && NAME_PARTICLES.has(b)) continue
    else break
    if (b !== w) break
  }
  const rest = words.slice(run.length).filter(w => /^\p{L}/u.test(w) && w.length > 3)
  return run.length >= 2 && rest.some(w => /^\p{Ll}/u.test(w)) ? { kind: 'name', words: run.flatMap(parts) } : null
}

/**
 * Whether each headline names someone or somewhere the other doesn't: a
 * capitalised word (not the first word) missing from the other headline.
 * Two stories that share a headline template but differ in that name
 * ("Russia launches drone attack on Kyiv" / "... on Odesa") collide on the
 * scraper's topic hash, so merged articles must pass this too. A first word
 * ending in a colon is a name too ("Benue: Gunmen kill 12 …" / "Delta: …",
 * Nigerian outlets' style, matched as one story in the April–May repair of
 * Oct 22, 2026), unless it is a label ("Breaking:"). Two headlines that open
 * with two names, neither in the other headline, tell of what two people did
 * (leadName, Nov 10, 2026): "Xanana Gusmão meets Prabowo in Jakarta" and
 * "Ramos-Horta meets Prabowo in Jakarta" had passed for one story.
 */
export function namesDiffer(a: string, b: string): boolean {
  const names = (t: string) => {
    const words = tidy(t).split(/\s+/).filter(Boolean)
    const first = words[0] ?? ''
    const lead = /^\p{Lu}[\p{L}\p{N}'-]*:$/u.test(first) && !HEADLINE_LABELS.has(first.slice(0, -1).toLowerCase()) ? [first.slice(0, -1)] : []
    return new Set(
      [...lead, ...words.slice(1)]
        .flatMap(w => w.replace(/'s\b/g, '').split(/[^\p{L}\p{N}]+/u))
        .filter(w => /^\p{Lu}/u.test(w) && w.length > 1)
        .map(w => w.toLowerCase()),
    )
  }
  const words = (t: string) => new Set(tidy(t).toLowerCase().replace(/'s\b/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean))
  const [wa, wb] = [words(a), words(b)]
  const [la, lb] = [leadName(a), leadName(b)]
  if (la && lb && la.kind === lb.kind && !la.words.some(w => wb.has(w)) && !lb.words.some(w => wa.has(w))) return true
  const [na, nb] = [names(a), names(b)]
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
      .returning('id') as Array<{ id: string }>

    // Ledger's cross-check: Claude reads the reports of a story that just
    // turned verified and records whether they're one event; when they aren't,
    // the ones promoted here go back to pending (pipeline/crosscheck.ts)
    if (promoted.length > 0) crossCheckLater(ids, [], promoted.map(r => r.id))
    // the search index keeps the status a report had when new (reindex.ts)
    if (promoted.length > 0) reindexLater(promoted.map(r => r.id))

    // With the outlets counted, the single-source severity cap lifts: each
    // report gets the severity its own words earn, up to what the count allows
    const rows = await db('signals').whereIn('id', ids)
      .select('id', 'title', 'summary', 'category', 'severity', 'language', db.raw(`${readLoweredSql()} AS read_lowered`)) as SeverityRow[]
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
      promoted_count: promoted.length,
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

  if (promoted > 0) crossCheckLater([existingId], [{ title: incoming.title }], [existingId])
  if (promoted > 0) reindexLater([existingId])

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
  /** crossCheck false: no Claude cross-check of what this verifies (second-outlet.ts past its daily share) */
  opts: { crossCheck?: boolean } = {},
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

  if (promoted > 0 && opts.crossCheck !== false) crossCheckLater([signalId], [{ title: incoming.title }], [signalId])
  if (promoted > 0) reindexLater([signalId])

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
