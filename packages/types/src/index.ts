// @worldpulse/types — Shared TypeScript type definitions

export type SignalSeverity    = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type AlertTier        = 'FLASH' | 'PRIORITY' | 'ROUTINE'
export type SignalStatus      = 'pending' | 'verified' | 'disputed' | 'false' | 'retracted'
export type CrossCheckStatus  = 'confirmed' | 'unconfirmed' | 'contested'
export type FlagReason        = 'inaccurate' | 'outdated' | 'duplicate' | 'misinformation'
export type AccountType    = 'community' | 'journalist' | 'official' | 'expert' | 'ai' | 'bot' | 'admin'
export type PostType       = 'signal' | 'thread' | 'report' | 'boost' | 'deep_dive' | 'poll' | 'ai_digest'
export type SourceTier     = 'wire' | 'national' | 'regional' | 'community' | 'user'
export type SignalMomentum = 'surging' | 'rising' | 'steady' | 'cooling'

export type Category =
  | 'breaking' | 'conflict' | 'geopolitics' | 'climate' | 'health'
  | 'economy'  | 'technology' | 'science' | 'elections' | 'culture'
  | 'disaster' | 'security' | 'sports' | 'space' | 'finance' | 'other'

export type FinanceSubcategory = 'market_move' | 'central_bank' | 'sanctions' | 'corporate' | 'crypto'

// ─── GEO ────────────────────────────────────────────────────────────────
export interface GeoPoint {
  lat: number
  lng: number
}

// ─── SOURCE ──────────────────────────────────────────────────────────────
export interface Source {
  id:          string
  slug:        string
  name:        string
  description: string | null
  url:         string
  logoUrl:     string | null
  tier:        SourceTier
  trustScore:  number
  language:    string
  country:     string | null
  categories:  Category[]
  activeAt:    string
  // Per-signal article URL from signal_sources junction table (null when no direct link)
  articleUrl?: string | null
}

// ─── SIGNAL ──────────────────────────────────────────────────────────────
export interface Signal {
  id:               string
  title:            string
  summary:          string | null
  body:             string | null
  category:         Category
  severity:         SignalSeverity
  status:           SignalStatus
  reliabilityScore: number    // 0.0 – 1.0
  alertTier:        AlertTier  // FLASH | PRIORITY | ROUTINE — urgency classification
  sourceCount:      number
  location:         GeoPoint | null
  locationName:     string | null
  countryCode:      string | null
  region:           string | null
  tags:             string[]
  sources:          Source[]
  originalUrls:     string[]
  language:         string
  viewCount:        number
  shareCount:       number
  postCount:        number
  eventTime:        string | null
  firstReported:    string
  verifiedAt:           string | null
  lastUpdated:          string
  /** Timestamp of last cross-source corroboration. Null = single-source, never corroborated. */
  lastCorroboratedAt:   string | null
  createdAt:          string
  isBreaking?:        boolean
  communityFlagCount?: number
  media_urls?:        string[]
  // AI-generated summary (present on signal detail, absent on list views)
  aiSummary?: {
    text:        string
    model:       'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'ollama' | 'extractive'
    generatedAt: string
  } | null
  // Multimedia items extracted from article content (YouTube, podcast audio)
  media?: Array<{
    id:           string
    mediaType:    'youtube' | 'podcast_audio' | 'video' | 'iframe'
    url:          string
    embedId?:     string | null
    title?:       string | null
    thumbnailUrl?: string | null
    sourceName?:  string | null
  }>
}

// ─── USER ─────────────────────────────────────────────────────────────────
export interface User {
  id:            string
  handle:        string
  displayName:   string
  bio:           string | null
  avatarUrl:     string | null
  location:      string | null
  website:       string | null
  accountType:   AccountType
  trustScore:    number
  followerCount: number
  followingCount:number
  signalCount:   number
  verified:      boolean
  createdAt:     string
  // Viewer-relative (only present when authenticated)
  isFollowing?:  boolean
  isFollowedBy?: boolean
}

export interface AuthUser extends User {
  email: string
  onboarded: boolean
}

// ─── POLL ────────────────────────────────────────────────────────────────
export interface PollOption {
  text:  string
  votes: number
}

export interface PollData {
  options:   PollOption[]
  endsAt:    string | null  // ISO timestamp
  totalVotes: number
  ended:     boolean
}

// ─── POST ────────────────────────────────────────────────────────────────
export interface Post {
  id:               string
  author:           User
  postType:         PostType
  content:          string
  signalId:         string | null
  signal:           Signal | null
  parentId:         string | null
  parent:           Post | null
  boostOfId:        string | null
  boostOf:          Post | null
  threadRootId:     string | null
  locationName:     string | null
  location:         GeoPoint | null
  mediaUrls:        string[]
  mediaTypes:       string[]
  sourceUrl:        string | null
  sourceName:       string | null
  tags:             string[]
  likeCount:        number
  boostCount:       number
  replyCount:       number
  viewCount:        number
  reliabilityScore: number | null
  language:         string
  isEdited:         boolean
  pollData:         PollData | null
  createdAt:        string
  updatedAt:        string
  // Viewer-relative
  hasLiked?:        boolean
  hasBoosted?:      boolean
  hasBookmarked?:   boolean
  userVote?:        number | null  // poll option index the viewer voted for
  isMuted?:         boolean        // whether the post author is muted by the viewer
}

// ─── TRENDING ────────────────────────────────────────────────────────────
export interface TrendingTopic {
  id:       string
  tag:      string
  category: Category | null
  window:   '1h' | '6h' | '24h'
  score:    number
  delta:    number
  count:    number
  momentum: SignalMomentum
}

// ─── FEED ────────────────────────────────────────────────────────────────
export interface FeedItem {
  type:   'post' | 'signal' | 'trending'
  post?:  Post
  signal?: Signal
  topic?: TrendingTopic
}

export interface PaginatedResponse<T> {
  items:    T[]
  total:    number
  cursor:   string | null
  hasMore:  boolean
}

// ─── WEBSOCKET ───────────────────────────────────────────────────────────
export type WSEventType =
  | 'signal.new'
  | 'signal.updated'
  | 'signal.verified'
  | 'post.new'
  | 'trending.update'
  | 'alert.trigger'
  | 'alert.breaking'
  | 'ping'

export interface WSMessage<T = unknown> {
  event:     WSEventType
  data:      T
  timestamp: string
  id:        string
}

export interface WSSignalNew {
  signal: Signal
}

export interface WSPostNew {
  post:     Post
  signalId: string | null
}

export interface WSTrendingUpdate {
  topics: TrendingTopic[]
  window: '1h' | '6h' | '24h'
}

// ─── API RESPONSES ───────────────────────────────────────────────────────
export interface ApiResponse<T> {
  success: boolean
  data?:   T
  error?:  string
  code?:   string
}

export interface AuthTokens {
  accessToken:  string
  refreshToken: string
  expiresIn:    number
}

// ─── SEARCH ──────────────────────────────────────────────────────────────
export interface SearchResult {
  type:   'signal' | 'post' | 'user' | 'tag'
  signal?: Signal
  post?:   Post
  user?:   User
  tag?:    string
  score:  number
}

// ─── ALERT SUBSCRIPTION ──────────────────────────────────────────────────
export interface AlertSubscription {
  id:          string
  name:        string
  keywords:    string[]
  categories:  Category[]
  countries:   string[]
  minSeverity: SignalSeverity
  channels:    { email: boolean; push: boolean; in_app: boolean }
  active:      boolean
  createdAt:   string
}

// ─── VERIFIED SOURCE PACKS ───────────────────────────────────────────────
export interface SignedPack {
  id:            string          // UUID v4
  version:       '1'
  category:      string          // 'all' | category slug
  generated_at:  string          // ISO timestamp
  signal_count:  number
  signals: Array<{
    id:                string
    title:             string
    summary:           string | null
    severity:          string
    category:          string
    reliability_score: number
    location_name:     string | null
    country_code:      string | null
    created_at:        string
    url:               string
  }>
  signature:      string         // base64url Ed25519 signature over canonical JSON payload
  public_key_pem: string         // base64 DER of the public key, for verification
}
