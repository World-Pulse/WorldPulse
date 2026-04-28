/**
 * Entity-Relationship Knowledge Graph Pipeline
 *
 * Extracts named entities (people, organisations, locations, events) from
 * signals and resolves the *relationships* between them — the same class of
 * structured intelligence that GDELT 5.0 derives from Gemini knowledge graphs.
 *
 * Pipeline stages:
 *   1. **Entity extraction** — NER from title + body via LLM (or fast regex fallback)
 *   2. **Relationship inference** — subject → predicate → object triples
 *   3. **Entity resolution** — fuzzy-merge duplicates ("US", "United States", "USA")
 *   4. **Graph persistence** — write nodes + edges to PostgreSQL + cache in Redis
 *   5. **Trend detection** — surface entities whose mention frequency spikes
 *
 * Design constraints:
 *   - Works with or without an LLM key (graceful degradation)
 *   - Idempotent — re-processing the same signal produces no duplicates
 *   - Redis cache for hot entity lookups (TTL 2h)
 *   - PostgreSQL for durable storage (entity_nodes + entity_edges tables)
 *
 * @module pipeline/entity-graph
 */

import { pgPool as db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import { createHash } from 'crypto'

// ─── TYPES ─────────────────────────────────────────────────────────────────────

export type EntityType =
  | 'person'
  | 'organisation'
  | 'location'
  | 'event'
  | 'weapon_system'
  | 'legislation'
  | 'commodity'
  | 'technology'

export interface EntityNode {
  id: string               // deterministic hash of (type, canonical_name)
  type: EntityType
  canonical_name: string   // normalised display name
  aliases: string[]        // other forms seen ("USA", "United States")
  first_seen: string       // ISO timestamp
  last_seen: string
  mention_count: number
  signal_ids: string[]     // signals that mention this entity (last 100)
  metadata: Record<string, unknown>
}

export interface EntityEdge {
  id: string               // hash of (source_id, target_id, predicate)
  source_entity_id: string
  target_entity_id: string
  predicate: string        // "leads", "sanctions", "located_in", "caused_by", …
  weight: number           // co-occurrence strength 0-1
  signal_ids: string[]     // supporting signals
  first_seen: string
  last_seen: string
}

export interface ExtractionResult {
  entities: ExtractedEntity[]
  relationships: ExtractedRelationship[]
}

export interface ExtractedEntity {
  name: string
  type: EntityType
  salience: number  // 0-1 importance in context
}

export interface ExtractedRelationship {
  subject: string
  predicate: string
  object: string
  confidence: number // 0-1
}

// ─── CONSTANTS ─────────────────────────────────────────────────────────────────

const ENTITY_CACHE_TTL = 7200      // 2 hours
const MAX_SIGNAL_IDS_PER_ENTITY = 100
const TRENDING_WINDOW_HOURS = 24
const TRENDING_SPIKE_THRESHOLD = 3 // 3x above rolling average → trending

// Common predicates for relationship extraction
export const PREDICATES = [
  'leads',
  'member_of',
  'located_in',
  'sanctions',
  'allied_with',
  'opposes',
  'caused_by',
  'resulted_in',
  'supplies',
  'funds',
  'attacks',
  'defends',
  'negotiates_with',
  'signed',
  'deployed_to',
  'manufactures',
  'regulates',
  'employs',
  'successor_of',
  'predecessor_of',
] as const

export type Predicate = (typeof PREDICATES)[number]

// ─── ENTITY ID GENERATION ──────────────────────────────────────────────────────

export function entityId(type: EntityType, canonicalName: string): string {
  const input = `${type}::${canonicalName.toLowerCase().trim()}`
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

export function edgeId(
  sourceEntityId: string,
  targetEntityId: string,
  predicate: string,
): string {
  const input = `${sourceEntityId}::${predicate}::${targetEntityId}`
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

// ─── CANONICAL NAME RESOLUTION ─────────────────────────────────────────────────

const COUNTRY_ALIASES: Record<string, string> = {
  'us': 'United States', 'usa': 'United States', 'united states of america': 'United States',
  'u.s.': 'United States', 'u.s.a.': 'United States', 'america': 'United States',
  'uk': 'United Kingdom', 'u.k.': 'United Kingdom', 'britain': 'United Kingdom',
  'great britain': 'United Kingdom', 'england': 'United Kingdom',
  'prc': 'China', 'peoples republic of china': 'China', "people's republic of china": 'China',
  'dprk': 'North Korea', 'north korea': 'North Korea',
  'rok': 'South Korea', 'south korea': 'South Korea',
  'russia': 'Russia', 'russian federation': 'Russia', 'rf': 'Russia',
  'uae': 'United Arab Emirates', 'eu': 'European Union',
  'un': 'United Nations', 'nato': 'NATO', 'who': 'World Health Organization',
  'imf': 'International Monetary Fund', 'world bank': 'World Bank',
}

const ORG_ALIASES: Record<string, string> = {
  'dod': 'Department of Defense', 'pentagon': 'Department of Defense',
  'cia': 'Central Intelligence Agency', 'fbi': 'Federal Bureau of Investigation',
  'nsa': 'National Security Agency', 'gchq': 'GCHQ',
  'mossad': 'Mossad', 'fsb': 'FSB', 'mi6': 'MI6', 'mi5': 'MI5',
  'iaea': 'International Atomic Energy Agency',
  'opcw': 'Organisation for the Prohibition of Chemical Weapons',
  'icrc': 'International Committee of the Red Cross',
  'msf': 'Médecins Sans Frontières', 'doctors without borders': 'Médecins Sans Frontières',
}

export function resolveCanonicalName(name: string, type: EntityType): string {
  const lower = name.toLowerCase().trim()

  if (type === 'location') {
    return COUNTRY_ALIASES[lower] ?? titleCase(name)
  }
  if (type === 'organisation') {
    return ORG_ALIASES[lower] ?? name.trim()
  }
  return name.trim()
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

// ─── LLM-BASED EXTRACTION ─────────────────────────────────────────────────────

const LLM_CONFIGURED = !!(
  process.env.LLM_API_URL ||
  process.env.OPENAI_API_KEY ||
  process.env.GEMINI_API_KEY
)

export async function extractEntitiesLLM(
  title: string,
  body: string | null,
): Promise<ExtractionResult> {
  const cacheKey = `kg:extract:${createHash('sha256').update(title).digest('hex').slice(0, 12)}`
  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached) as ExtractionResult

  if (!LLM_CONFIGURED) {
    return extractEntitiesRuleBased(title, body)
  }

  const prompt = `You are an intelligence analyst building a knowledge graph from news signals.
Extract all named entities and relationships from this signal.

Return ONLY valid JSON with this schema:
{
  "entities": [
    {"name": "...", "type": "person|organisation|location|event|weapon_system|legislation|commodity|technology", "salience": 0.0-1.0}
  ],
  "relationships": [
    {"subject": "entity name", "predicate": "leads|member_of|located_in|sanctions|allied_with|opposes|caused_by|resulted_in|supplies|funds|attacks|defends|negotiates_with|signed|deployed_to|manufactures|regulates|employs|successor_of|predecessor_of", "object": "entity name", "confidence": 0.0-1.0}
  ]
}

Rules:
- Extract up to 10 entities, focus on salience > 0.3
- Only extract relationships with confidence > 0.5
- Use the exact predicate strings listed above
- Salience = importance of entity to this specific signal (0-1)
- Prefer specific entity names over generic ones

Signal title: ${title}
Content: ${(body ?? '').slice(0, 2000)}

Return ONLY valid JSON, no markdown fences.`

  try {
    // Try Gemini first (cheapest), fall back to OpenAI
    const result = process.env.GEMINI_API_KEY
      ? await callGeminiExtraction(prompt)
      : await callOpenAIExtraction(prompt)

    await redis.setex(cacheKey, ENTITY_CACHE_TTL, JSON.stringify(result))
    return result
  } catch (err) {
    logger.warn({ err }, 'LLM entity extraction failed, falling back to rule-based')
    return extractEntitiesRuleBased(title, body)
  }
}

async function callGeminiExtraction(prompt: string): Promise<ExtractionResult> {
  const key = process.env.GEMINI_API_KEY!
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash'
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
        },
      }),
    },
  )
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`)
  const data: any = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'
  return parseExtractionJSON(text)
}

async function callOpenAIExtraction(prompt: string): Promise<ExtractionResult> {
  const key = process.env.OPENAI_API_KEY!
  const baseUrl = process.env.LLM_API_URL ?? 'https://api.openai.com/v1'
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 1024,
      response_format: { type: 'json_object' },
    }),
  })
  if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`)
  const data: any = await res.json()
  const text = data?.choices?.[0]?.message?.content ?? '{}'
  return parseExtractionJSON(text)
}

function parseExtractionJSON(raw: string): ExtractionResult {
  try {
    const parsed = JSON.parse(raw)
    const entities: ExtractedEntity[] = (parsed.entities ?? [])
      .filter((e: any) => e.name && e.type)
      .map((e: any) => ({
        name: String(e.name),
        type: validateEntityType(e.type),
        salience: Math.max(0, Math.min(1, Number(e.salience) || 0.5)),
      }))

    const relationships: ExtractedRelationship[] = (parsed.relationships ?? [])
      .filter((r: any) => r.subject && r.predicate && r.object)
      .map((r: any) => ({
        subject: String(r.subject),
        predicate: String(r.predicate),
        object: String(r.object),
        confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0.5)),
      }))

    return { entities, relationships }
  } catch {
    return { entities: [], relationships: [] }
  }
}

function validateEntityType(type: string): EntityType {
  const valid: EntityType[] = [
    'person', 'organisation', 'location', 'event',
    'weapon_system', 'legislation', 'commodity', 'technology',
  ]
  return valid.includes(type as EntityType) ? (type as EntityType) : 'organisation'
}

// ─── RULE-BASED FALLBACK EXTRACTION ────────────────────────────────────────────

// Regex patterns for common entity types
const PERSON_PATTERN = /(?:President|PM|Minister|Gen\.|Gen |Admiral|Secretary|Chief|Director|Ambassador|Dr\.|Prof\.) [A-Z][a-z]+ [A-Z][a-z]+/g
const ORG_PATTERN = /(?:NATO|UN|EU|WHO|IMF|IAEA|OPCW|ICRC|WTO|ASEAN|AU|BRICS|G7|G20|OPEC|UNHCR|UNICEF|FAO|ILO|UNCTAD)/g
const LOCATION_PATTERN = /(?:in|from|near|across) ([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})/g
const WEAPON_PATTERN = /(?:ICBM|SLBM|IRBM|SAM|MANPAD|HIMARS|ATACMS|S-[34]00|Patriot|Iron Dome|THAAD|F-(?:16|22|35)|Su-\d{2}|MiG-\d{2}|Iskander|Kalibr|Tomahawk)/g
const TECH_PATTERN = /(?:blockchain|cryptocurrency|Bitcoin|Ethereum|quantum computing|5G|6G|CBDC|LLM|GPT|CRISPR|fusion reactor|semiconductor|microchip)/gi

export function extractEntitiesRuleBased(
  title: string,
  body: string | null,
): ExtractionResult {
  const text = `${title} ${body ?? ''}`
  const entities: ExtractedEntity[] = []
  const seen = new Set<string>()

  const addEntity = (name: string, type: EntityType, salience: number) => {
    const key = `${type}:${name.toLowerCase()}`
    if (!seen.has(key)) {
      seen.add(key)
      entities.push({ name, type, salience })
    }
  }

  // People
  for (const match of text.matchAll(PERSON_PATTERN)) {
    addEntity(match[0].trim(), 'person', 0.7)
  }

  // Organisations
  for (const match of text.matchAll(ORG_PATTERN)) {
    addEntity(match[0], 'organisation', 0.6)
  }

  // Locations (from prepositions)
  for (const match of text.matchAll(LOCATION_PATTERN)) {
    if (match[1] && match[1].length > 2) {
      addEntity(match[1], 'location', 0.5)
    }
  }

  // Weapon systems
  for (const match of text.matchAll(WEAPON_PATTERN)) {
    addEntity(match[0], 'weapon_system', 0.8)
  }

  // Technology
  for (const match of text.matchAll(TECH_PATTERN)) {
    addEntity(match[0], 'technology', 0.5)
  }

  return { entities: entities.slice(0, 10), relationships: [] }
}

// ─── GRAPH PERSISTENCE ─────────────────────────────────────────────────────────

export async function upsertEntityNode(
  entity: ExtractedEntity,
  signalId: string,
  timestamp: string,
): Promise<EntityNode> {
  const canonical = resolveCanonicalName(entity.name, entity.type)
  const id = entityId(entity.type, canonical)
  const now = timestamp || new Date().toISOString()

  // Upsert into PostgreSQL
  const result = await db.query(
    `INSERT INTO entity_nodes (id, type, canonical_name, aliases, first_seen, last_seen, mention_count, signal_ids, metadata)
     VALUES ($1, $2, $3, $4, $5, $5, 1, ARRAY[$6]::text[], $7)
     ON CONFLICT (id) DO UPDATE SET
       last_seen = $5,
       mention_count = entity_nodes.mention_count + 1,
       signal_ids = (
         SELECT array_agg(DISTINCT sid)
         FROM (
           SELECT unnest(entity_nodes.signal_ids || ARRAY[$6]::text[]) AS sid
         ) sub
         LIMIT ${MAX_SIGNAL_IDS_PER_ENTITY}
       ),
       aliases = (
         SELECT array_agg(DISTINCT a)
         FROM unnest(entity_nodes.aliases || ARRAY[$8]::text[]) AS a
       )
     RETURNING *`,
    [id, entity.type, canonical, [entity.name], now, signalId, JSON.stringify({ salience: entity.salience }), entity.name],
  )

  const row = result.rows[0]

  // Cache hot entity in Redis
  const node: EntityNode = {
    id: row.id,
    type: row.type,
    canonical_name: row.canonical_name,
    aliases: row.aliases ?? [],
    first_seen: row.first_seen,
    last_seen: row.last_seen,
    mention_count: row.mention_count,
    signal_ids: row.signal_ids ?? [],
    metadata: row.metadata ?? {},
  }
  await redis.setex(`kg:node:${id}`, ENTITY_CACHE_TTL, JSON.stringify(node))

  return node
}

export async function upsertEntityEdge(
  rel: ExtractedRelationship,
  sourceType: EntityType,
  targetType: EntityType,
  signalId: string,
  timestamp: string,
): Promise<EntityEdge> {
  const srcCanonical = resolveCanonicalName(rel.subject, sourceType)
  const tgtCanonical = resolveCanonicalName(rel.object, targetType)
  const srcId = entityId(sourceType, srcCanonical)
  const tgtId = entityId(targetType, tgtCanonical)
  const eid = edgeId(srcId, tgtId, rel.predicate)
  const now = timestamp || new Date().toISOString()

  const result = await db.query(
    `INSERT INTO entity_edges (id, source_entity_id, target_entity_id, predicate, weight, signal_ids, first_seen, last_seen)
     VALUES ($1, $2, $3, $4, $5, ARRAY[$6]::text[], $7, $7)
     ON CONFLICT (id) DO UPDATE SET
       last_seen = $7,
       weight = LEAST(1.0, entity_edges.weight + 0.05),
       signal_ids = (
         SELECT array_agg(DISTINCT sid)
         FROM (
           SELECT unnest(entity_edges.signal_ids || ARRAY[$6]::text[]) AS sid
         ) sub
         LIMIT ${MAX_SIGNAL_IDS_PER_ENTITY}
       )
     RETURNING *`,
    [eid, srcId, tgtId, rel.predicate, rel.confidence, signalId, now],
  )

  const row = result.rows[0]
  const edge: EntityEdge = {
    id: row.id,
    source_entity_id: row.source_entity_id,
    target_entity_id: row.target_entity_id,
    predicate: row.predicate,
    weight: row.weight,
    signal_ids: row.signal_ids ?? [],
    first_seen: row.first_seen,
    last_seen: row.last_seen,
  }
  await redis.setex(`kg:edge:${eid}`, ENTITY_CACHE_TTL, JSON.stringify(edge))

  return edge
}

// ─── MAIN PIPELINE ENTRY POINT ─────────────────────────────────────────────────

export async function processSignalForKnowledgeGraph(
  signalId: string,
  title: string,
  body: string | null,
  timestamp: string,
): Promise<{ entities: EntityNode[]; edges: EntityEdge[] }> {
  const extraction = await extractEntitiesLLM(title, body)
  const entityNodes: EntityNode[] = []
  const edgeResults: EntityEdge[] = []

  // Build a name→type map for relationship resolution
  const nameTypeMap = new Map<string, EntityType>()
  for (const e of extraction.entities) {
    nameTypeMap.set(e.name.toLowerCase(), e.type)
  }

  // Upsert entity nodes
  for (const entity of extraction.entities) {
    try {
      const node = await upsertEntityNode(entity, signalId, timestamp)
      entityNodes.push(node)
    } catch (err) {
      logger.warn({ err, entity: entity.name }, 'Failed to upsert entity node')
    }
  }

  // Upsert relationship edges
  for (const rel of extraction.relationships) {
    try {
      const srcType = nameTypeMap.get(rel.subject.toLowerCase()) ?? 'organisation'
      const tgtType = nameTypeMap.get(rel.object.toLowerCase()) ?? 'organisation'
      const edge = await upsertEntityEdge(rel, srcType, tgtType, signalId, timestamp)
      edgeResults.push(edge)
    } catch (err) {
      logger.warn({ err, rel }, 'Failed to upsert entity edge')
    }
  }

  logger.info(
    { signalId, entities: entityNodes.length, edges: edgeResults.length },
    'Knowledge graph updated',
  )
  return { entities: entityNodes, edges: edgeResults }
}

// ─── TRENDING ENTITY DETECTION ─────────────────────────────────────────────────

export async function detectTrendingEntities(
  limit: number = 20,
): Promise<Array<{ entity: EntityNode; spike_ratio: number; recent_mentions: number }>> {
  const windowStart = new Date(Date.now() - TRENDING_WINDOW_HOURS * 3600 * 1000).toISOString()
  const baselineStart = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()

  const result = await db.query(
    `WITH recent AS (
       SELECT id, canonical_name, type, mention_count, last_seen,
              (SELECT COUNT(*) FROM unnest(signal_ids) sid
               WHERE EXISTS (SELECT 1 FROM signals s WHERE s.id = sid AND s.published_at >= $1)) as recent_mentions
       FROM entity_nodes
       WHERE last_seen >= $1
     ),
     baseline AS (
       SELECT id,
              GREATEST(1, mention_count / GREATEST(1, EXTRACT(EPOCH FROM (NOW() - first_seen)) / 86400)) as daily_avg
       FROM entity_nodes
       WHERE first_seen <= $2
     )
     SELECT r.*, COALESCE(r.recent_mentions::float / NULLIF(b.daily_avg, 0), r.recent_mentions) as spike_ratio
     FROM recent r
     LEFT JOIN baseline b ON r.id = b.id
     WHERE r.recent_mentions >= 2
     ORDER BY spike_ratio DESC, r.recent_mentions DESC
     LIMIT $3`,
    [windowStart, baselineStart, limit],
  )

  return result.rows.map((row: any) => ({
    entity: {
      id: row.id,
      type: row.type,
      canonical_name: row.canonical_name,
      aliases: row.aliases ?? [],
      first_seen: row.first_seen,
      last_seen: row.last_seen,
      mention_count: row.mention_count,
      signal_ids: row.signal_ids ?? [],
      metadata: row.metadata ?? {},
    },
    spike_ratio: Number(row.spike_ratio) || 0,
    recent_mentions: Number(row.recent_mentions) || 0,
  }))
}

// ─── GRAPH QUERY HELPERS ───────────────────────────────────────────────────────

export async function getEntityNeighbors(
  entityId: string,
  depth: number = 1,
  limit: number = 50,
): Promise<{ nodes: EntityNode[]; edges: EntityEdge[] }> {
  // Get edges where this entity is source or target
  const edgeResult = await db.query(
    `SELECT * FROM entity_edges
     WHERE source_entity_id = $1 OR target_entity_id = $1
     ORDER BY weight DESC, last_seen DESC
     LIMIT $2`,
    [entityId, limit],
  )

  const edges: EntityEdge[] = edgeResult.rows.map(mapEdgeRow)

  // Collect unique neighbor IDs
  const neighborIds = new Set<string>()
  for (const edge of edges) {
    neighborIds.add(edge.source_entity_id)
    neighborIds.add(edge.target_entity_id)
  }
  neighborIds.delete(entityId)

  // Fetch neighbor nodes
  const nodes: EntityNode[] = []
  if (neighborIds.size > 0) {
    const nodeResult = await db.query(
      `SELECT * FROM entity_nodes WHERE id = ANY($1) ORDER BY mention_count DESC`,
      [Array.from(neighborIds)],
    )
    nodes.push(...nodeResult.rows.map(mapNodeRow))
  }

  // Depth 2: get edges between neighbors
  if (depth >= 2 && neighborIds.size > 1) {
    const interEdges = await db.query(
      `SELECT * FROM entity_edges
       WHERE source_entity_id = ANY($1) AND target_entity_id = ANY($1)
       ORDER BY weight DESC
       LIMIT $2`,
      [Array.from(neighborIds), limit],
    )
    edges.push(...interEdges.rows.map(mapEdgeRow))
  }

  return { nodes, edges }
}

export async function searchEntities(
  query: string,
  type?: EntityType,
  limit: number = 20,
): Promise<EntityNode[]> {
  const params: any[] = [`%${query.toLowerCase()}%`]
  let sql = `SELECT * FROM entity_nodes WHERE LOWER(canonical_name) LIKE $1`

  if (type) {
    sql += ` AND type = $${params.length + 1}`
    params.push(type)
  }

  sql += ` ORDER BY mention_count DESC LIMIT $${params.length + 1}`
  params.push(limit)

  const result = await db.query(sql, params)
  return result.rows.map(mapNodeRow)
}

// ─── ROW MAPPERS ───────────────────────────────────────────────────────────────

function mapNodeRow(row: any): EntityNode {
  return {
    id: row.id,
    type: row.type,
    canonical_name: row.canonical_name,
    aliases: row.aliases ?? [],
    first_seen: row.first_seen,
    last_seen: row.last_seen,
    mention_count: row.mention_count,
    signal_ids: row.signal_ids ?? [],
    metadata: row.metadata ?? {},
  }
}

function mapEdgeRow(row: any): EntityEdge {
  return {
    id: row.id,
    source_entity_id: row.source_entity_id,
    target_entity_id: row.target_entity_id,
    predicate: row.predicate,
    weight: row.weight,
    signal_ids: row.signal_ids ?? [],
    first_seen: row.first_seen,
    last_seen: row.last_seen,
  }
}
