// ─── WorldPulse SDK types ────────────────────────────────────────
// What each route in apps/api/src/routes answers, field by field, as its
// handler builds it (plan V3h). Dates are ISO 8601 strings.

/** A signal's severity (the database's signal_severity list) */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

/** A signal's status (the database's signal_status list) */
export type SignalStatus = 'pending' | 'verified' | 'disputed' | 'false' | 'retracted'

/** The answer most routes wrap their result in */
export interface DataResponse<T> {
  success: true
  data: T
}

// ─── GET /api/v1/public/signals ──────────────────────────────────

export interface ListSignalsParams {
  /** One of the names categories.list() answers, or 'all' (the default) */
  category?: string
  severity?: Severity
  /** 1 to 100, default 50 */
  limit?: number
  /** 0 to 10,000, default 0 */
  offset?: number
}

/** A verified signal as the public list sends it (routes/public.ts) */
export interface PublicSignal {
  id: string
  title: string
  category: string
  severity: Severity
  /** 0 to 1 */
  reliability_score: number
  location_name: string | null
  /** When WorldPulse saved the report */
  published_at: string
  source_url: string | null
}

export interface SignalList {
  success: true
  /** Newest first */
  data: PublicSignal[]
  /** How many verified signals match the filter (never fewer than this page shows) */
  total: number
  /** false while `total` is the database's estimate; the exact count is made in the background */
  total_exact: boolean
  limit: number
  offset: number
}

// ─── GET /api/v1/signals/:id ─────────────────────────────────────

/** A known source of the signal, most trusted first */
export interface SignalSource {
  id: string
  slug: string
  name: string
  url: string
  logoUrl: string | null
  /** wire, national, regional, community or user */
  tier: string
  /** 0 to 1 */
  trustScore: number
  /** The source's article about this signal, when known */
  articleUrl: string | null
}

/** One of the signal's last 10 verification checks, newest first */
export interface SignalVerification {
  check_type: string
  result: string
  /** 0 to 1, as the database keeps it (a decimal, which arrives as a string such as "0.850") */
  confidence: number | string | null
  notes: string | null
  created_at: string
}

export interface SignalRiskScore {
  /** 0 to 100 */
  score: number
  level: 'critical' | 'high' | 'medium' | 'low'
  factors: {
    severityScore: number
    reliabilityScore: number
    corroborationScore: number
    recencyScore: number
  }
  /** For example "High Risk · 72" */
  label: string
}

/** A summary written in the background (or the outlet's own); never written when the page is opened */
export interface SignalSummary {
  text: string
  model: 'anthropic' | 'gemini' | 'openrouter' | 'ollama' | 'extractive'
  generatedAt: string
}

/** The political lean of the signal's first source */
export interface SourceBias {
  /** -1 (far left) to 1 (far right) */
  score: number
  label: 'far-left' | 'left' | 'center-left' | 'center' | 'center-right' | 'right' | 'far-right' | 'unknown'
  confidence: 'high' | 'medium' | 'low'
  method: 'seed' | 'heuristic' | 'unknown'
}

export interface SignalMedia {
  id: string
  /** youtube, podcast_audio, video or iframe */
  mediaType: string
  url: string
  embedId: string | null
  title: string | null
  thumbnailUrl: string | null
  sourceName: string | null
}

/** One signal in full (routes/signals.ts): any status, so check `status` */
export interface SignalDetail {
  id: string
  title: string
  summary: string | null
  body: string | null
  category: string
  severity: Severity
  status: SignalStatus
  /** 0 to 1, as the database keeps it (a decimal, which arrives as a string such as "0.850": use Number()) */
  reliabilityScore: number | string
  sourceCount: number
  location: { lng: number; lat: number } | null
  locationName: string | null
  countryCode: string | null
  region: string | null
  tags: string[]
  /** The outlets' article links */
  originalUrls: string[]
  language: string
  viewCount: number
  shareCount: number
  postCount: number
  eventTime: string | null
  firstReported: string | null
  verifiedAt: string | null
  lastUpdated: string | null
  lastCorroboratedAt: string | null
  createdAt: string | null
  isBreaking: boolean
  communityFlagCount: number
  sources: SignalSource[]
  riskScore: SignalRiskScore
  verifications: SignalVerification[]
  aiSummary: SignalSummary | null
  sourceBias: SourceBias | null
  media: SignalMedia[]
}

// ─── GET /api/v1/stories ─────────────────────────────────────────

export interface TopStoriesParams {
  /** Reported in the last this many hours: 1 to 72, default 12 */
  hours?: number
  /** At most this many stories: 1 to 20, default 6 */
  limit?: number
  /** Only stories with a report placed in this country: a two-letter code such as 'NG' */
  country?: string
}

/** A story: the reports of one event, from two outlets or more (lib/story-list.ts) */
export interface Story {
  /** The story's id, for stories.get() */
  id: string
  /** The report to open: a recent, reliable one with a real headline */
  leadId: string
  title: string
  category: string | null
  /** The place most of its reports are pinned to */
  place: string | null
  /** The highest severity among its reports */
  severity: Severity
  /** How many reports it has */
  size: number
  /** Websites that reported it, at most 12, the most reliable reports' first */
  outlets: string[]
  /** How many websites reported it */
  outletCount: number
  firstSeenAt: string
  /** Its newest report */
  updatedAt: string
  verifiedAt: string | null
}

export interface StoryList {
  /** Ranked by how many outlets report each and how serious it is, fading with age; each event once */
  stories: Story[]
  hours: number
  /** The country asked for, when one was */
  country?: string
  generatedAt: string
}

// ─── GET /api/v1/stories/:id ─────────────────────────────────────

export interface StoryReport {
  id: string
  title: string
  status: 'verified' | 'pending'
  severity: Severity
  category: string
  /** 0 to 1 */
  reliabilityScore: number
  /** The website of its article ('' when it has no link) */
  outlet: string
  url: string | null
  locationName: string | null
  createdAt: string | null
  verifiedAt: string | null
  /** 1 for the story's first report; gaps show where reports were left out */
  position: number | null
}

export interface StoryDetail {
  storyId: string
  /** How many reports it has (more than `signals` holds when it's big) */
  size: number
  /** How many websites carried it, from every report's links */
  outlets: number
  /** Those websites, A to Z */
  outletNames: string[]
  verifiedAt: string | null
  /** Its first 10 reports, its latest 40 and the one asked for, oldest first */
  signals: StoryReport[]
}

// ─── GET /api/v1/stories/week ────────────────────────────────────

export interface Week {
  /** Its ISO name, such as '2026-W42' */
  week: string
  /** Monday 00:00 UTC */
  start: string
  /** The next Monday 00:00 UTC */
  end: string
  /** true for the week under way, whose numbers still grow */
  underWay: boolean
  /** Its top 15 stories, counting only the week's own reports */
  stories: Story[]
  /** The 12 countries with the most verified stories that week */
  countries: Array<{ code: string; name: string; stories: number }>
  /** For the week under way, the 10 people named in the most reports of the last 7 days; null otherwise */
  people: Array<{ id: string; name: string; reports: number }> | null
  generatedAt: string
}

// ─── GET /api/v1/search/semantic ─────────────────────────────────

export interface SemanticSearchParams {
  /** 1 to 50, default 10 */
  limit?: number
  /** Only signals of this category */
  category?: string
}

export interface SemanticMatch {
  id: string
  title: string
  summary: string | null
  category: string
  severity: Severity
  status: SignalStatus
  /** 0 to 1, as the database keeps it (a decimal, which arrives as a string such as "0.850": use Number()) */
  reliabilityScore: number | string
  locationName: string | null
  countryCode: string | null
  tags: string[]
  createdAt: string | null
  /** FLASH, PRIORITY or ROUTINE */
  alertTier: string | null
  /** How close in meaning to the question: 0 to 1, 1 being the same meaning */
  score: number
}

/** Not wrapped in `data`: the route answers these fields at the top level */
export interface SemanticSearchResponse {
  success: true
  /** Closest in meaning first */
  results: SemanticMatch[]
  /** false while the search model is starting up; results is then empty */
  semantic: boolean
  partial: boolean
  /** Sent with semantic: false */
  message?: string
}

// ─── GET /api/v1/countries ───────────────────────────────────────

export type CountryWindow = '24h' | '48h' | '7d' | '30d'

export interface CountryIndexParams {
  /** The period counted, default '24h' */
  window?: CountryWindow
  /** 1 to 200, default 50 */
  limit?: number
  /** Count only signals of this category (one of categories.list()) */
  category?: string
}

export interface CountryRisk {
  /** Two-letter code */
  code: string
  name: string
  /** 10 to 95, relative to the other countries in this answer */
  risk_score: number
  risk_label: 'Critical' | 'High' | 'Elevated' | 'Moderate' | 'Low'
  risk_color: string
  /** Verified signals placed in the country in the period */
  signal_count: number
  /** Of those, the ones from the last 6 hours */
  recent_6h: number
  trend: 'rising' | 'stable' | 'falling'
  categories: string[]
  /** 0 to 1 */
  avg_reliability: number | null
  latest_signal_at: string
}

/** Not wrapped: the route answers these fields at the top level */
export interface CountryIndex {
  window: CountryWindow
  total: number
  /** Highest risk first */
  countries: CountryRisk[]
  generated_at: string
}

// ─── Client options ──────────────────────────────────────────────

export interface WorldPulseOptions {
  /** Where the API is: default https://api.world-pulse.io (your own, say http://localhost:3001) */
  baseUrl?: string
  /** An API key (wp_live_…), sent as X-API-Key. None of the routes the SDK calls needs one */
  apiKey?: string
  /** A sign-in token (accessToken from POST /api/v1/auth/login), sent as Authorization: Bearer. None of the routes the SDK calls needs one */
  token?: string
  /** Headers added to every request */
  headers?: Record<string, string>
  /** The fetch to use: default the global one (Node.js 18 and later, browsers) */
  fetch?: typeof globalThis.fetch
  /** Milliseconds before a request is given up: default 60,000; 0 waits as long as it takes */
  timeout?: number
}
