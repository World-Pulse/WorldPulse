import { MeiliSearch } from 'meilisearch'

export const meili = new MeiliSearch({
  host:   process.env.MEILI_HOST ?? 'http://localhost:7700',
  apiKey: process.env.MEILI_KEY  ?? '',
})

// ─── Document interfaces ───────────────────────────────────────────────────

export interface SignalDoc {
  id:               string
  title:            string
  summary:          string | null
  body:             string | null
  category:         string
  severity:         string
  status:           string
  alertTier:        string   // 'FLASH' | 'PRIORITY' | 'ROUTINE'
  reliabilityScore: number
  locationName:     string | null
  countryCode:      string | null
  tags:             string[]
  language:         string
  viewCount:        number
  postCount:        number
  /** Unix timestamp (seconds) — required for Meilisearch numeric range filters */
  createdAt:        number
}

export interface PostDoc {
  id:                string
  content:           string
  postType:          string
  tags:              string[]
  authorId:          string
  authorHandle:      string
  authorDisplayName: string
  likeCount:         number
  boostCount:        number
  replyCount:        number
  sourceName:        string | null
  language:          string
  signalId:          string | null
  /** Unix timestamp (seconds) */
  createdAt:         number
}

export interface UserDoc {
  id:            string
  handle:        string
  displayName:   string
  bio:           string | null
  accountType:   string
  verified:      boolean
  followerCount: number
  trustScore:    number
}

// ─── Index setup ──────────────────────────────────────────────────────────

export async function setupSearchIndexes(): Promise<void> {
  // Signals: primary search surface for global intelligence events
  await meili.index('signals').updateSettings({
    searchableAttributes: ['title', 'summary', 'body', 'tags', 'locationName', 'countryCode'],
    filterableAttributes: [
      'category', 'severity', 'status', 'countryCode', 'language', 'createdAt', 'reliabilityScore', 'alertTier',
    ],
    sortableAttributes: ['createdAt', 'reliabilityScore', 'viewCount', 'postCount', 'alertTier'],
    rankingRules: [
      'words',
      'typo',
      'proximity',
      'attribute',
      'sort',
      'exactness',
      // Boost high-reliability signals for the same relevance rank
      'reliabilityScore:desc',
    ],
    typoTolerance: {
      enabled: true,
      minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
    },
    pagination: { maxTotalHits: 10_000 },
  })

  // Posts: user-generated content — engagement-weighted
  await meili.index('posts').updateSettings({
    searchableAttributes: ['content', 'tags', 'authorHandle', 'authorDisplayName', 'sourceName'],
    filterableAttributes: ['postType', 'language', 'authorId', 'signalId', 'createdAt'],
    sortableAttributes:   ['createdAt', 'likeCount', 'boostCount', 'replyCount'],
    rankingRules: [
      'words',
      'typo',
      'proximity',
      'attribute',
      'sort',
      'exactness',
    ],
    typoTolerance: {
      enabled: true,
      minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
    },
    pagination: { maxTotalHits: 10_000 },
  })

  // Users: people search — follower-count weighted
  await meili.index('users').updateSettings({
    searchableAttributes: ['handle', 'displayName', 'bio'],
    filterableAttributes: ['accountType', 'verified'],
    sortableAttributes:   ['followerCount', 'trustScore'],
    rankingRules: [
      'words',
      'typo',
      'proximity',
      'attribute',
      'sort',
      'exactness',
      'followerCount:desc',
    ],
    typoTolerance: {
      enabled: true,
      // Shorter handles need early typo tolerance
      minWordSizeForTypos: { oneTypo: 3, twoTypos: 6 },
    },
    pagination: { maxTotalHits: 5_000 },
  })
}

// ─── Internal helpers ─────────────────────────────────────────────────────

function toTimestamp(val: unknown): number {
  if (val instanceof Date) return Math.floor(val.getTime() / 1000)
  if (typeof val === 'string' && val.length > 0) return Math.floor(new Date(val).getTime() / 1000)
  if (typeof val === 'number') return val
  return 0
}

function toSignalDoc(row: Record<string, unknown>): SignalDoc {
  return {
    id:               row.id as string,
    title:            row.title as string,
    summary:          (row.summary as string | null) ?? null,
    body:             (row.body as string | null) ?? null,
    category:         row.category as string,
    severity:         row.severity as string,
    status:           row.status as string,
    alertTier:        (row.alert_tier as string) ?? 'ROUTINE',
    reliabilityScore: (row.reliability_score as number) ?? 0,
    locationName:     (row.location_name as string | null) ?? null,
    countryCode:      (row.country_code as string | null) ?? null,
    tags:             (row.tags as string[]) ?? [],
    language:         (row.language as string) ?? 'en',
    viewCount:        (row.view_count as number) ?? 0,
    postCount:        (row.post_count as number) ?? 0,
    createdAt:        toTimestamp(row.created_at),
  }
}

function toPostDoc(row: Record<string, unknown>): PostDoc {
  return {
    id:                row.id as string,
    content:           row.content as string,
    postType:          row.post_type as string,
    tags:              (row.tags as string[]) ?? [],
    authorId:          row.author_id as string,
    authorHandle:      (row.author_handle as string) ?? '',
    authorDisplayName: (row.author_display_name as string) ?? '',
    likeCount:         (row.like_count as number) ?? 0,
    boostCount:        (row.boost_count as number) ?? 0,
    replyCount:        (row.reply_count as number) ?? 0,
    sourceName:        (row.source_name as string | null) ?? null,
    language:          (row.language as string) ?? 'en',
    signalId:          (row.signal_id as string | null) ?? null,
    createdAt:         toTimestamp(row.created_at),
  }
}

function toUserDoc(row: Record<string, unknown>): UserDoc {
  return {
    id:            row.id as string,
    handle:        row.handle as string,
    displayName:   (row.display_name as string) ?? '',
    bio:           (row.bio as string | null) ?? null,
    accountType:   (row.account_type as string) ?? 'community',
    verified:      (row.verified as boolean) ?? false,
    followerCount: (row.follower_count as number) ?? 0,
    trustScore:    (row.trust_score as number) ?? 0,
  }
}

// ─── Single-document index functions ─────────────────────────────────────

/** Index a signal from a raw DB row (snake_case keys). Fire-and-forget safe. */
export async function indexSignal(row: Record<string, unknown>): Promise<void> {
  await meili.index('signals').addDocuments([toSignalDoc(row)])
}

/** Index a post from a raw DB row that includes `author_handle` and
 *  `author_display_name` columns (e.g. from a JOIN or manual merge). */
export async function indexPost(row: Record<string, unknown>): Promise<void> {
  await meili.index('posts').addDocuments([toPostDoc(row)])
}

/** Index a user from a raw DB row (snake_case keys). */
export async function indexUser(row: Record<string, unknown>): Promise<void> {
  await meili.index('users').addDocuments([toUserDoc(row)])
}

// ─── Batch index functions (used by backfill) ─────────────────────────────

export async function indexSignals(rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return
  await meili.index('signals').addDocuments(rows.map(toSignalDoc))
}

export async function indexPosts(rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return
  await meili.index('posts').addDocuments(rows.map(toPostDoc))
}

export async function indexUsers(rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return
  await meili.index('users').addDocuments(rows.map(toUserDoc))
}

// ─── Remove functions ─────────────────────────────────────────────────────

export async function removeSignal(id: string): Promise<void> {
  await meili.index('signals').deleteDocument(id)
}

export async function removePost(id: string): Promise<void> {
  await meili.index('posts').deleteDocument(id)
}

export async function removeUser(id: string): Promise<void> {
  await meili.index('users').deleteDocument(id)
}
