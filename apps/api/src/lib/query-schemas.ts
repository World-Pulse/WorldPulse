/**
 * query-schemas.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared Zod schemas for validating GET query-string parameters across all
 * WorldPulse API routes.
 *
 * WHY: TypeScript's `req.query as { ... }` is a compile-time assertion with NO
 * runtime effect — Fastify passes every query param as a raw string. Without
 * safeParse, numeric params stay as strings, enum params accept any value, and
 * malformed inputs propagate into SQL/Redis/PostGIS layers causing 500 errors.
 *
 * USAGE:
 *   import { FeedQuerySchema, parseBboxParam } from '../lib/query-schemas'
 *
 *   const parsed = FeedQuerySchema.safeParse(req.query)
 *   if (!parsed.success) return sendError(reply, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid query params')
 *   const { cursor, category, severity, limit } = parsed.data
 */

import { z } from 'zod'

// ─── Shared primitive transformers ────────────────────────────────────────────

/** Parse a string that represents a positive integer, apply a max cap. */
function intParam(defaultVal: number, min = 1, max = 200) {
  return z
    .union([z.string(), z.number()])
    .optional()
    .transform(v => (v === undefined ? defaultVal : typeof v === 'number' ? v : parseInt(v, 10)))
    .pipe(z.number().int().min(min).max(max))
}

/** Parse a cursor string (base64 or uuid-ish), pass through or undefined. */
const cursorParam = z.string().max(256).optional()

/** Parse a non-empty string enum param, trimmed and lowercased. */
function enumParam<T extends readonly [string, ...string[]]>(values: T, defaultVal?: T[number]) {
  const base = z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(values))
  return defaultVal !== undefined ? base.optional().default(defaultVal) : base.optional()
}

// ─── Shared domain enums ──────────────────────────────────────────────────────

export const SEVERITY_VALUES  = ['low', 'medium', 'high', 'critical'] as const
export const CATEGORY_VALUES  = [
  'all', 'conflict', 'breaking_news', 'climate', 'health', 'markets',
  'science', 'technology', 'politics', 'cyber', 'natural_disaster',
  'humanitarian', 'maritime', 'aviation', 'space', 'sports', 'culture',
] as const
export const WINDOW_VALUES    = ['1h', '6h', '12h', '24h', '48h', '7d', '30d'] as const
export const SORT_VALUES      = ['recent', 'trending', 'reliability', 'views'] as const
export const SIGNAL_STATUS_VALUES = ['all', 'verified', 'pending', 'disputed'] as const

export type SeverityValue  = typeof SEVERITY_VALUES[number]
export type CategoryValue  = typeof CATEGORY_VALUES[number]
export type WindowValue    = typeof WINDOW_VALUES[number]
export type SortValue      = typeof SORT_VALUES[number]

// ─── Route-specific schemas ───────────────────────────────────────────────────

/**
 * Schema for the main global feed endpoint:
 * GET /api/v1/feed/global  and  GET /api/v1/feed/signals
 */
export const FeedQuerySchema = z.object({
  cursor:   cursorParam,
  category: z.string().trim().optional(),          // allow any string — DB filters validate
  severity: z.enum(SEVERITY_VALUES).optional(),
  country:  z.string().trim().max(3).optional(),   // ISO 3166-1 alpha-2/3
  limit:    intParam(20, 1, 100),
})

export type FeedQuery = z.infer<typeof FeedQuerySchema>

/**
 * Schema for the public unauthenticated signals API:
 * GET /api/v1/public/signals
 */
export const PublicSignalsQuerySchema = z.object({
  category: z.string().trim().optional(),
  severity: z.enum(SEVERITY_VALUES).optional(),
  limit:    intParam(50, 1, 100),
  offset:   z
    .union([z.string(), z.number()])
    .optional()
    .transform(v => (v === undefined ? 0 : typeof v === 'number' ? v : parseInt(v, 10)))
    .pipe(z.number().int().min(0).max(10_000)),
})

export type PublicSignalsQuery = z.infer<typeof PublicSignalsQuerySchema>

/**
 * Schema for the signal list endpoint:
 * GET /api/v1/signals
 */
export const SignalListQuerySchema = z.object({
  category: z.string().trim().optional(),
  severity: z.enum(SEVERITY_VALUES).optional(),
  country:  z.string().trim().max(3).optional(),
  status:   z.enum(SIGNAL_STATUS_VALUES).optional().default('verified'),
  cursor:   cursorParam,
  limit:    intParam(20, 1, 100),
  bbox:     z.string().max(80).optional(),  // further validated by parseBboxParam
})

export type SignalListQuery = z.infer<typeof SignalListQuerySchema>

/**
 * Schema for the signals map points endpoint:
 * GET /api/v1/signals/map/points
 */
export const MapPointsQuerySchema = z.object({
  category: z.string().trim().optional(),
  severity: z.enum(SEVERITY_VALUES).optional(),
  hours:    intParam(24, 1, 168),  // cap at 1 week
  bbox:     z.string().max(80).optional(),
})

export type MapPointsQuery = z.infer<typeof MapPointsQuerySchema>

/**
 * Schema for trending / analytics window params.
 */
export const WindowQuerySchema = z.object({
  window: enumParam(WINDOW_VALUES, '24h'),
  limit:  intParam(20, 1, 100),
})

export type WindowQuery = z.infer<typeof WindowQuerySchema>

/**
 * Schema for the verification history endpoint:
 * GET /api/v1/signals/:id/verifications
 */
export const HistoryQuerySchema = z.object({
  page:  intParam(1, 1, 1000),
  limit: intParam(20, 1, 100),
})

export type HistoryQuery = z.infer<typeof HistoryQuerySchema>

/**
 * Schema for geographic convergence hotspots:
 * GET /api/v1/signals/map/hotspots
 */
export const HotspotsQuerySchema = z.object({
  hours:          intParam(24, 1, 168),
  min_categories: intParam(3, 2, 10),
  limit:          intParam(20, 1, 50),
})

export type HotspotsQuery = z.infer<typeof HotspotsQuerySchema>

// ─── Community sort enum ──────────────────────────────────────────────────────

export const COMMUNITY_SORT_VALUES = ['members', 'posts', 'trending', 'newest'] as const
export type CommunitySortValue = typeof COMMUNITY_SORT_VALUES[number]

/**
 * Schema for community list endpoint:
 * GET /api/v1/communities
 */
export const CommunityListQuerySchema = z.object({
  search:   z.string().trim().max(100).optional(),
  category: z.string().trim().optional(),
  sort:     enumParam(COMMUNITY_SORT_VALUES, 'members'),
  limit:    intParam(50, 1, 100),
})

export type CommunityListQuery = z.infer<typeof CommunityListQuerySchema>

/**
 * Schema for community members endpoint:
 * GET /api/v1/communities/:id/members
 */
export const MEMBER_ROLE_VALUES = ['admin', 'moderator', 'member'] as const

export const CommunityMembersQuerySchema = z.object({
  role:   z.enum(MEMBER_ROLE_VALUES).optional(),
  limit:  intParam(50, 1, 100),
  cursor: cursorParam,
})

export type CommunityMembersQuery = z.infer<typeof CommunityMembersQuerySchema>

/**
 * Schema for country intelligence index:
 * GET /api/v1/countries  (leaderboard)
 */
export const CountryIndexQuerySchema = z.object({
  window:   enumParam(WINDOW_VALUES, '24h'),
  limit:    intParam(50, 1, 200),
  category: z.string().trim().optional(),
})

export type CountryIndexQuery = z.infer<typeof CountryIndexQuerySchema>

/**
 * Schema for country detail endpoint:
 * GET /api/v1/countries/:code
 */
export const CountryDetailQuerySchema = z.object({
  window: enumParam(WINDOW_VALUES, '7d'),
  limit:  intParam(10, 1, 50),
})

export type CountryDetailQuery = z.infer<typeof CountryDetailQuerySchema>

/**
 * Schema for RSS feed endpoints.
 */
export const RssQuerySchema = z.object({
  category:        z.string().trim().optional(),
  severity:        z.enum(SEVERITY_VALUES).optional(),
  min_reliability: z
    .string()
    .optional()
    .transform(v => (v === undefined ? 0 : parseFloat(v)))
    .pipe(z.number().min(0).max(1)),
  limit: intParam(50, 1, 100),
})

export type RssQuery = z.infer<typeof RssQuerySchema>

// ─── Bbox validation helper (exported so routes can share it) ─────────────────

/**
 * Validate a `bbox` query string of the form "minLng,minLat,maxLng,maxLat".
 * Returns `{ coords }` on success or `{ error: string }` on failure.
 * Exported so it can be reused by any route that accepts a bbox param.
 */
export function parseBboxParam(
  raw: string,
): { coords: [number, number, number, number] } | { error: string } {
  const parts = raw.split(',').map(Number)
  if (parts.length !== 4 || parts.some(n => !isFinite(n) || isNaN(n))) {
    return {
      error:
        'bbox must be exactly 4 comma-separated finite numbers: minLng,minLat,maxLng,maxLat',
    }
  }
  const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number]
  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90) {
    return {
      error: 'bbox coordinates out of valid range: lng ∈ [-180, 180], lat ∈ [-90, 90]',
    }
  }
  if (minLng >= maxLng || minLat >= maxLat) {
    return { error: 'bbox min values must be strictly less than their max counterparts' }
  }
  return { coords: [minLng, minLat, maxLng, maxLat] }
}

// ─── Generic helper for route handlers ───────────────────────────────────────

/**
 * Parse query params and return typed data, or null with an error string.
 *
 * @example
 * const result = parseQuery(FeedQuerySchema, req.query)
 * if (result.error) return sendError(reply, 400, 'VALIDATION_ERROR', result.error)
 * const { cursor, limit } = result.data
 */
export function parseQuery<T extends z.ZodTypeAny>(
  schema: T,
  raw: unknown,
): { data: z.infer<T>; error: null } | { data: null; error: string } {
  const result = schema.safeParse(raw)
  if (!result.success) {
    const issue = result.error.issues[0]
    const field = issue?.path.join('.') ?? 'query'
    const msg   = issue?.message ?? 'Invalid query parameters'
    return { data: null, error: `${field}: ${msg}` }
  }
  return { data: result.data as z.infer<T>, error: null }
}
