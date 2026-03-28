import * as SecureStore from 'expo-secure-store'

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001'

const ACCESS_TOKEN_KEY = 'wp_access_token'
const REFRESH_TOKEN_KEY = 'wp_refresh_token'

// ─── TOKEN STORAGE ────────────────────────────────────────────────────────

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY)
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY)
}

export async function setTokens(access: string, refresh: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, access),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refresh),
  ])
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ])
}

// ─── HTTP CLIENT ──────────────────────────────────────────────────────────

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  params?: Record<string, string | number | boolean | undefined>
  auth?: boolean  // default: true
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, params, auth = true } = options

  // Build URL
  const url = new URL(`${API_BASE}${path}`)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
  }

  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'WorldPulse-Mobile/0.1',
  }

  if (auth) {
    const token = await getAccessToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    // Try token refresh on 401
    if (response.status === 401 && auth) {
      const refreshed = await tryRefreshToken()
      if (refreshed) {
        // Retry with new token
        const newToken = await getAccessToken()
        headers['Authorization'] = `Bearer ${newToken}`
        const retryResponse = await fetch(url.toString(), {
          method,
          headers,
          body: body != null ? JSON.stringify(body) : undefined,
        })
        const retryData = await retryResponse.json().catch(() => ({}))
        if (retryResponse.ok) return retryData as T
      }
    }

    throw new ApiError(
      response.status,
      data.code ?? 'API_ERROR',
      data.error ?? `Request failed with status ${response.status}`,
    )
  }

  return data as T
}

async function tryRefreshToken(): Promise<boolean> {
  const refreshToken = await getRefreshToken()
  if (!refreshToken) return false

  try {
    const response = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })

    if (!response.ok) {
      await clearTokens()
      return false
    }

    const data = await response.json()
    if (data.data?.accessToken && data.data?.refreshToken) {
      await setTokens(data.data.accessToken, data.data.refreshToken)
      return true
    }

    return false
  } catch {
    return false
  }
}

// ─── API METHODS ──────────────────────────────────────────────────────────

export type Signal = {
  id: string
  title: string
  summary: string
  category: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  status: string
  reliabilityScore: number
  /** True if the multi-model AI consensus pipeline verified this signal */
  consensusVerified?: boolean
  sourceCount: number
  location: { lng: number; lat: number } | null
  locationName: string | null
  countryCode: string | null
  tags: string[]
  viewCount: number
  postCount: number
  eventTime: string | null
  createdAt: string
  cibScore?: number | null
  riskScore?: number | null
  aiSummary?: string | null
  breaking?: boolean
}

export type TrendingEntity = {
  entity: string
  type: 'country' | 'org' | 'tag' | 'actor'
  count: number
  topCategories: string[]
  topSeverity: 'critical' | 'high' | 'medium' | 'low' | 'info'
}

export type TrendingEntitiesResponse = {
  window: '1h' | '6h' | '24h' | '7d'
  entities: TrendingEntity[]
  total_signals_scanned: number
  unique_entity_count: number
  generated_at: string
}

export type Post = {
  id: string
  postType: string
  content: string
  likeCount: number
  boostCount: number
  replyCount: number
  reliabilityScore?: number | null
  createdAt: string
  author: {
    id: string
    handle: string
    displayName: string
    avatarUrl: string | null
    verified: boolean
    trustScore: number
  }
}

export type FeedPage = {
  items: Signal[]
  cursor: string | null
  hasMore: boolean
}

export type AlertSubscription = {
  id: string
  name: string
  keywords: string[]
  categories: string[]
  countries: string[]
  minSeverity: string
  active: boolean
  createdAt: string
}

export type UserProfile = {
  id: string
  handle: string
  displayName: string
  bio: string | null
  avatarUrl: string | null
  accountType: string
  trustScore: number
  followerCount: number
  followingCount: number
  signalCount: number
  verified: boolean
  createdAt: string
}

// Feed
export const feedApi = {
  getGlobal: (params?: { cursor?: string; category?: string; limit?: number }) =>
    request<{ success: boolean; data: FeedPage }>('/api/v1/feed', { params }),

  getForYou: (params?: { cursor?: string; limit?: number }) =>
    request<{ success: boolean; data: FeedPage }>('/api/v1/feed/for-you', { params }),

  getFollowing: (params?: { cursor?: string; limit?: number }) =>
    request<{ success: boolean; data: FeedPage }>('/api/v1/feed/following', { params }),
}

// Signals
export const signalsApi = {
  getAll: (params?: {
    category?: string; severity?: string; cursor?: string; limit?: number
  }) => request<{ success: boolean; data: FeedPage }>('/api/v1/signals', { params }),

  getById: (id: string) =>
    request<{ success: boolean; data: Signal & { sources: unknown[]; verifications: unknown[] } }>(
      `/api/v1/signals/${id}`
    ),

  getPosts: (id: string, params?: { cursor?: string; limit?: number }) =>
    request<{ success: boolean; data: { items: Post[]; cursor: string | null; hasMore: boolean } }>(
      `/api/v1/signals/${id}/posts`, { params }
    ),

  getMapPoints: (params?: { category?: string; severity?: string; hours?: number }) =>
    request<{ success: boolean; data: Array<Signal & { lng: number; lat: number }> }>(
      '/api/v1/signals/map/points', { params }
    ),
}

// Auth
export const authApi = {
  login: (email: string, password: string) =>
    request<{ success: boolean; data: { accessToken: string; refreshToken: string; user: UserProfile } }>(
      '/api/v1/auth/login',
      { method: 'POST', body: { email, password }, auth: false }
    ),

  register: (handle: string, displayName: string, email: string, password: string) =>
    request<{ success: boolean; data: { accessToken: string; refreshToken: string; user: UserProfile } }>(
      '/api/v1/auth/register',
      { method: 'POST', body: { handle, displayName, email, password }, auth: false }
    ),

  logout: () =>
    request<{ success: boolean }>('/api/v1/auth/logout', { method: 'POST' }),

  me: () =>
    request<{ success: boolean; data: UserProfile }>('/api/v1/auth/me'),
}

// Alerts
export const alertsApi = {
  getAll: () =>
    request<{ success: boolean; data: AlertSubscription[] }>('/api/v1/alerts'),

  create: (data: Partial<AlertSubscription>) =>
    request<{ success: boolean; data: AlertSubscription }>(
      '/api/v1/alerts', { method: 'POST', body: data }
    ),

  toggle: (id: string, active: boolean) =>
    request<{ success: boolean }>(`/api/v1/alerts/${id}`, {
      method: 'PATCH', body: { active }
    }),

  delete: (id: string) =>
    request<{ success: boolean }>(`/api/v1/alerts/${id}`, { method: 'DELETE' }),
}

export type Community = {
  id: string
  slug: string
  name: string
  description: string | null
  avatarUrl: string | null
  bannerUrl: string | null
  categories: string[]
  memberCount: number
  postCount: number
  createdAt: string
  isMember?: boolean
}

export type SearchResults = {
  signals: Signal[]
  posts: Post[]
  users: UserProfile[]
  tags: string[]
}

// Users
export const usersApi = {
  getProfile: (handle: string) =>
    request<{ success: boolean; data: UserProfile & { isFollowing?: boolean } }>(`/api/v1/users/${handle}`),

  follow: (handle: string) =>
    request<{ success: boolean }>(`/api/v1/users/${handle}/follow`, { method: 'POST' }),

  unfollow: (handle: string) =>
    request<{ success: boolean }>(`/api/v1/users/${handle}/follow`, { method: 'DELETE' }),

  getPosts: (handle: string, params?: { cursor?: string; limit?: number }) =>
    request<{ success: boolean; data: { items: Post[]; cursor: string | null; hasMore: boolean } }>(
      `/api/v1/users/${handle}/posts`, { params }
    ),
}

// Search
export const searchApi = {
  search: (q: string, type?: 'signals' | 'posts' | 'users' | 'tags', limit = 20) =>
    request<{ success: boolean; data: SearchResults }>(
      '/api/v1/search', { params: { q, type, limit }, auth: false }
    ),
}

// Communities
export const communitiesApi = {
  getAll: (params?: { search?: string; sort?: 'members' | 'posts' | 'trending' | 'newest'; limit?: number }) =>
    request<{ success: boolean; data: Community[] }>('/api/v1/communities', { params }),

  getBySlug: (slug: string) =>
    request<{ success: boolean; data: Community }>(`/api/v1/communities/${slug}`),

  getPosts: (slug: string, params?: { cursor?: string; limit?: number }) =>
    request<{ success: boolean; data: { items: Post[]; cursor: string | null; hasMore: boolean } }>(
      `/api/v1/communities/${slug}/posts`, { params }
    ),

  join: (slug: string) =>
    request<{ success: boolean }>(`/api/v1/communities/${slug}/join`, { method: 'POST' }),

  leave: (slug: string) =>
    request<{ success: boolean }>(`/api/v1/communities/${slug}/leave`, { method: 'DELETE' }),
}

// Analytics
export const analyticsApi = {
  getTrendingEntities: (window: '1h' | '6h' | '24h' | '7d' = '24h', type?: string, limit = 10) =>
    request<{ success: boolean; data: TrendingEntitiesResponse }>(
      '/api/v1/analytics/trending-entities',
      { params: { window, ...(type ? { type } : {}), limit }, auth: false }
    ),
}

// Posts
export const postsApi = {
  getFeed: (params?: { limit?: number; cursor?: string; tab?: 'global' | 'following' }) =>
    request<{ success: boolean; data: { items: Post[]; cursor: string | null; hasMore: boolean } }>(
      '/api/v1/posts', { params }
    ),

  create: (data: { content: string; signalId?: string; postType?: string }) =>
    request<{ success: boolean; data: Post }>('/api/v1/posts', { method: 'POST', body: data }),

  like: (id: string) =>
    request<{ success: boolean }>(`/api/v1/posts/${id}/like`, { method: 'POST' }),

  unlike: (id: string) =>
    request<{ success: boolean }>(`/api/v1/posts/${id}/like`, { method: 'DELETE' }),

  boost: (id: string) =>
    request<{ success: boolean }>(`/api/v1/posts/${id}/boost`, { method: 'POST' }),
}

// Notifications
export const notificationsApi = {
  registerDeviceToken: (token: string, platform: 'expo' | 'fcm' | 'apns' = 'expo') =>
    request<{ success: boolean }>('/api/v1/notifications/device-token', {
      method: 'POST', body: { token, platform }
    }),

  getAll: (params?: { cursor?: string; limit?: number }) =>
    request<{ success: boolean; data: { items: unknown[]; cursor: string | null; hasMore: boolean } }>(
      '/api/v1/notifications', { params }
    ),

  markRead: (ids?: string[]) =>
    request<{ success: boolean }>('/api/v1/notifications/read', {
      method: 'PATCH', body: { ids }
    }),

  getUnreadCount: () =>
    request<{ success: boolean; data: { count: number } }>('/api/v1/notifications/unread-count'),
}

// Briefing
export type BriefingSection = {
  title: string
  summary: string
  category: string
  signalCount: number
  topSignalId: string | null
}

export type Briefing = {
  id: string
  date: string
  headline: string
  summary: string
  sections: BriefingSection[]
  generatedAt: string
}

export const briefingApi = {
  getLatest: () =>
    request<{ success: boolean; data: Briefing }>('/api/v1/briefings/latest'),
}

// Countries
export type CountrySummary = {
  countryCode: string
  countryName: string
  signalCount: number
  criticalCount: number
  highCount: number
  latestSignalAt: string | null
  topCategory: string | null
}

export const countriesApi = {
  getAll: (params?: { hours?: number }) =>
    request<{ success: boolean; data: CountrySummary[] }>('/api/v1/countries', { params, auth: false }),

  getSignals: (code: string, params?: { cursor?: string; limit?: number; severity?: string }) =>
    request<{ success: boolean; data: FeedPage }>(`/api/v1/countries/${code}/signals`, { params }),
}

// Breaking alerts
export type BreakingAlert = {
  id: string
  title: string
  severity: 'critical' | 'high'
  category: string
  locationName: string | null
  createdAt: string
  signalId: string | null
}

export const breakingApi = {
  getLatest: () =>
    request<{ success: boolean; data: BreakingAlert[] }>('/api/v1/breaking/latest', { auth: false }),
}
