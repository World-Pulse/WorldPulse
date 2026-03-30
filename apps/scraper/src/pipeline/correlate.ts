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
 *   - Reliability scores get a corroboration boost (+0.05 per corroborating source)
 *   - A correlated_signals array is stored in Redis for fast retrieval
 *
 * @module pipeline/correlate
 */

import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
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

/** Reliability boost per corroborating source (capped at 0.15 total) */
const CORROBORATION_BOOST = 0.05
const MAX_CORROBORATION_BOOST = 0.15

/** Redis TTL for correlation data */
const CORRELATION_TTL = 7 * 24 * 60 * 60 // 7 days

/** Maximum cluster size to prevent runaway merges */
const MAX_CLUSTER_SIZE = 12

// ─── CAUSAL CHAIN RULES ──────────────────────────────────────────────────────
// Maps category pairs that have known causal relationships.
// { trigger → [possible effects] }
const CAUSAL_CHAINS: Record<string, string[]> = {
  // Natural disasters cascade
  'science:earthquake':     ['weather:tsunami', 'humanitarian:displacement', 'infrastructure:power_outage'],
  'weather:tsunami':        ['humanitarian:displacement', 'humanitarian:disaster'],
  'science:volcano':        ['weather:severe', 'humanitarian:displacement', 'transportation:aviation'],
  'weather:severe':         ['infrastructure:power_outage', 'humanitarian:disaster'],

  // Conflict cascade
  'conflict:armed_conflict': ['humanitarian:displacement', 'humanitarian:crisis', 'security:sanctions'],
  'conflict:protest':        ['security:sanctions', 'conflict:armed_conflict'],

  // Cyber cascade
  'security:vulnerability':  ['security:threat', 'infrastructure:power_outage'],
  'security:threat':         ['infrastructure:power_outage', 'security:vulnerability'],

  // Radiation cascade
  'science:radiation':       ['humanitarian:displacement', 'health:outbreak'],

  // Military cascade
  'military:deployment':     ['conflict:armed_conflict', 'security:sanctions'],
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
    if (candidates.length === 0) return null

    // 2. Score each candidate for correlation
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

    // 5. Form or extend cluster
    let cluster: EventCluster
    if (existingClusterId) {
      cluster = await extendCluster(existingClusterId, signal, topCorrelations)
    } else {
      cluster = await createCluster(signal, topCorrelations)
    }

    // 6. Apply reliability boost to corroborated signals
    await applyCorroborationBoost(cluster)

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

  const query = db('signals')
    .select(
      'id', 'title', 'category', 'severity', 'source_id',
      'location_name', 'reliability_score', 'published_at', 'tags',
    )
    .where('published_at', '>=', since.toISOString())
    .whereNot('id', signal.id)
    .orderBy('published_at', 'desc')
    .limit(200)

  // If we have PostGIS and location, also fetch lat/lng
  const rows = await query

  return rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    title: r.title as string,
    category: r.category as string,
    severity: r.severity as string,
    source_id: r.source_id as string,
    location_name: r.location_name as string | null,
    lat: r.lat as number | null,
    lng: r.lng as number | null,
    published_at: r.published_at as string,
    reliability_score: r.reliability_score as number,
    tags: Array.isArray(r.tags) ? r.tags as string[] : [],
  }))
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
  const catA = `${a.category}:${a.severity}`
  const catB = `${b.category}:${b.severity}`

  // Check direct causal chains
  for (const [trigger, effects] of Object.entries(CAUSAL_CHAINS)) {
    const triggerCategory = trigger.split(':')[0] ?? ''
    if (a.category === triggerCategory) {
      for (const effect of effects) {
        const effectCategory = effect.split(':')[0] ?? ''
        if (b.category === effectCategory) return 1.0
      }
    }
    if (b.category === triggerCategory) {
      for (const effect of effects) {
        const effectCategory = effect.split(':')[0] ?? ''
        if (a.category === effectCategory) return 1.0
      }
    }
  }

  // Same category = moderate correlation (different sources reporting same type of event)
  if (a.category === b.category && a.source_id !== b.source_id) return 0.6

  // Same domain family
  const familyA = getCategoryFamily(a.category)
  const familyB = getCategoryFamily(b.category)
  if (familyA && familyA === familyB) return 0.3

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
    sources: [...new Set(allSignals.map(s => s.source_id))],
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
  existing.sources = [...new Set([...existing.sources, newSignal.source_id])]

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

async function applyCorroborationBoost(cluster: EventCluster): Promise<void> {
  if (cluster.sources.length < 2) return // Need 2+ unique sources

  const uniqueSources = cluster.sources.length
  const boost = Math.min(
    CORROBORATION_BOOST * (uniqueSources - 1),
    MAX_CORROBORATION_BOOST
  )

  try {
    await db('signals')
      .whereIn('id', cluster.signal_ids)
      .whereRaw('reliability_score + ? <= 1.0', [boost])
      .update({
        reliability_score:   db.raw(`LEAST(reliability_score + ?, 1.0)`, [boost]),
        // Stamp the precise moment of cross-source corroboration for velocity tracking.
        // ViralityBadge uses this (instead of last_updated) to detect spreading events.
        last_corroborated_at: db.raw('NOW()'),
      })

    logger.debug({
      cluster_id: cluster.cluster_id,
      boost,
      unique_sources: uniqueSources,
    }, 'Applied corroboration reliability boost + stamped last_corroborated_at')
  } catch (err) {
    logger.warn({ err, cluster_id: cluster.cluster_id }, 'Failed to apply corroboration boost')
  }
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

/** Category family grouping for partial causal matching */
function getCategoryFamily(category: string): string | null {
  const families: Record<string, string> = {
    conflict: 'security',
    security: 'security',
    military: 'security',
    weather: 'environment',
    science: 'environment',
    health: 'health',
    humanitarian: 'humanitarian',
    infrastructure: 'infrastructure',
    transportation: 'infrastructure',
    technology: 'technology',
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
