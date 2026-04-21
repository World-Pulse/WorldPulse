// ─── WorldPulse SDK Types ────────────────────────────────────────
// Comprehensive type definitions for the WorldPulse Public API v1

/** Signal severity levels, ordered from most to least critical */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

/** Signal categories matching WorldPulse's 16-category taxonomy */
export type SignalCategory =
  | 'conflict'
  | 'politics'
  | 'climate'
  | 'economy'
  | 'health'
  | 'technology'
  | 'disaster'
  | 'human_rights'
  | 'energy'
  | 'migration'
  | 'space'
  | 'maritime'
  | 'sanctions'
  | 'disinformation'
  | 'infrastructure'
  | 'finance'

/** Sort options for signal listing */
export type SignalSort = 'newest' | 'severity' | 'reliability'

// ─── Response Types ──────────────────────────────────────────────

/** A signal in the public listing (summary view) */
export interface Signal {
  id: string
  title: string
  category: SignalCategory
  severity: Severity
  reliability_score: number | null
  location_name: string | null
  published_at: string
  source_url: string | null
}

/** A signal with full detail (from /signals/:id) */
export interface SignalDetail extends Signal {
  body: string | null
  lat: number | null
  lng: number | null
  country_code: string | null
  source_count: number
  updated_at: string
}

/** Category metadata from /categories */
export interface Category {
  id: SignalCategory
  label: string
  icon: string
  color: string
  count: number
}

/** Source metadata from /sources */
export interface Source {
  slug: string
  name: string
  url: string
  rss_url: string | null
  category: string
  tier: 'premium' | 'major' | 'specialised'
  country_code: string
  language: string
  bias: string | null
  reliability: number | null
}

/** Intelligence domain from /intelligence */
export interface IntelligenceDomain {
  id: string
  label: string
  path: string
  description: string
  endpoints: number
  coverage: Record<string, number>
}

/** Country signal activity from /countries */
export interface CountryActivity {
  country_code: string
  country_name: string
  signal_count: number
  latest_signal_at: string | null
}

/** Threat assessment from /threats */
export interface ThreatAssessment {
  category: SignalCategory
  threat_level: 'critical' | 'elevated' | 'guarded' | 'low'
  trend: 'escalating' | 'stable' | 'de-escalating'
  signal_count_24h: number
  previous_count_24h: number
  top_signal: Signal | null
}

/** Platform statistics from /stats */
export interface PlatformStats {
  total_signals: number
  signals_24h: number
  signals_7d: number
  active_sources: number
  total_feeds: number
  categories: number
  intel_domains: number
  severity_breakdown: Record<Severity, number>
  category_distribution: Record<string, number>
  api_version: string
}

// ─── Pagination ──────────────────────────────────────────────────

/** HATEOAS pagination links */
export interface PaginationLinks {
  self: string
  first: string
  next: string | null
  prev: string | null
  last: string
}

/** Paginated response wrapper */
export interface PaginatedResponse<T> {
  success: true
  data: T[]
  total: number
  limit: number
  offset: number
  _links?: PaginationLinks
}

/** Non-paginated response wrapper */
export interface DataResponse<T> {
  success: true
  data: T
}

/** List response wrapper */
export interface ListResponse<T> {
  success: true
  data: T[]
}

// ─── Query Parameters ────────────────────────────────────────────

/** Parameters for GET /signals */
export interface ListSignalsParams {
  category?: SignalCategory | string
  severity?: Severity
  country_code?: string
  q?: string
  sort?: SignalSort
  since?: string
  limit?: number
  offset?: number
}

/** Parameters for GET /sources */
export interface ListSourcesParams {
  tier?: 'premium' | 'major' | 'specialised'
  category?: string
  country_code?: string
  limit?: number
  offset?: number
}

/** Parameters for GET /countries */
export interface ListCountriesParams {
  since?: string
  limit?: number
}

/** Parameters for GET /breaking */
export interface ListBreakingParams {
  limit?: number
}

// ─── Error Types ─────────────────────────────────────────────────

/** API error response shape */
export interface ApiErrorResponse {
  success: false
  error: string
  code: string
}

// ─── Client Config ───────────────────────────────────────────────

/** Configuration for the WorldPulse SDK client */
export interface WorldPulseConfig {
  /** Base URL for the API. Default: https://api.world-pulse.io/api/v1/public */
  baseUrl?: string
  /** WebSocket base URL. Default: wss://api.world-pulse.io */
  wsBaseUrl?: string
  /** Request timeout in milliseconds. Default: 10000 */
  timeout?: number
  /** Maximum retry attempts for failed requests. Default: 2 */
  maxRetries?: number
  /** Initial retry delay in ms (doubles each attempt). Default: 1000 */
  retryDelay?: number
  /** Custom headers to include with every request */
  headers?: Record<string, string>
  /** Custom fetch implementation (e.g. for testing or Node.js <18) */
  fetch?: typeof globalThis.fetch
  /** Custom WebSocket constructor (e.g. for testing or Node.js) */
  WebSocket?: typeof globalThis.WebSocket
}

// ─── Streaming Types ─────────────────────────────────────────────

/** WebSocket message event types from the WorldPulse API */
export type WsEventType =
  | 'ping'
  | 'signal_new'
  | 'signal_update'
  | 'breaking_alert'
  | 'error'
  | 'pong'

/** Raw WebSocket message envelope */
export interface WsMessage<T = unknown> {
  event: WsEventType
  data: T
}

/** WS welcome/ping data */
export interface WsConnectedData {
  clientId: string
  authenticated: boolean
  serverTime: string
  connectedClients: number
  subscribed?: string[]
}

/** WS signal_new / signal_update data */
export interface WsSignalData {
  id: string
  title: string
  category: string
  severity: Severity
  reliability_score: number | null
  location_name: string | null
  published_at: string
  source_url: string | null
  lat?: number | null
  lng?: number | null
  country_code?: string | null
  body?: string | null
  source_count?: number
  updated_at?: string
}

/** Channels that can be subscribed to via WebSocket */
export type WsChannel =
  | SignalCategory
  | 'breaking'
  | 'critical'
  | 'all'
  | (string & {})  // custom country codes / tags

/** Options for a live WebSocket stream */
export interface LiveStreamOptions {
  /** Channels (categories, severity keywords, country codes) to subscribe to.
   *  Default: ['breaking', 'critical'] */
  channels?: WsChannel[]
  /** JWT auth token for authenticated streams */
  token?: string
  /** Max reconnect attempts before giving up. Default: 5 */
  maxReconnects?: number
  /** Delay between reconnect attempts in ms. Default: 2000 */
  reconnectDelay?: number
}

/** Event map for SignalLiveStream */
export interface LiveStreamEventMap {
  /** A new or updated signal arrived */
  signal: Signal
  /** WebSocket connected (or reconnected) */
  connected: WsConnectedData
  /** Connection closed cleanly */
  close: void
  /** An error occurred */
  error: Error
}

/** Options for the polling-based async-iterator stream */
export interface PollStreamOptions {
  /** Signal category filter */
  category?: SignalCategory | string
  /** Minimum severity filter */
  severity?: Severity
  /** ISO-8601 — only return signals published after this timestamp */
  since?: string
  /** Country code filter */
  country_code?: string
  /** Max signals per poll tick. Default: 20 */
  limit?: number
  /** Poll interval in milliseconds. Default: 5000 */
  intervalMs?: number
  /** AbortSignal to stop the iterator */
  signal?: AbortSignal
}
