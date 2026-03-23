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
  sourceCount: number
  location: { lng: number; lat: number } | null
  locationName: string | null
  countryCode: string | null
  tags: string[]
  viewCount: number
  postCount: number
  eventTime: string | null
  createdAt: string
}

export type Post = {
  id: string
  postType: string
  content: string
  likeCount: number
  boostCount: number
  replyCount: number
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

// Posts
export const postsApi = {
  create: (data: { content: string; signalId?: string; postType?: string }) =>
    request<{ success: boolean; data: Post }>('/api/v1/posts', { method: 'POST', body: data }),

  like: (id: string) =>
    request<{ success: boolean }>(`/api/v1/posts/${id}/like`, { method: 'POST' }),

  unlike: (id: string) =>
    request<{ success: boolean }>(`/api/v1/posts/${id}/like`, { method: 'DELETE' }),
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
