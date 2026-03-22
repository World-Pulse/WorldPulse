'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ReputationChart, generateReputationHistory } from '@/components/ReputationChart'
import type { User } from '@worldpulse/types'
import { EmptyState } from '@/components/EmptyState'
import { useToast } from '@/components/Toast'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ─── Local types ─────────────────────────────────────────────────────────────

interface PostItem {
  id:               string
  content:          string
  post_type:        string
  like_count:       number
  boost_count:      number
  reply_count:      number
  tags:             string[]
  created_at:       string
  signal_id:        string | null
  media_urls:       string[]
  reliability_score: number | null
}

interface SignalItem {
  id:               string
  title:            string
  summary:          string | null
  category:         string
  severity:         string
  status:           string
  reliability_score: number
  source_count:     number
  location_name:    string | null
  country_code:     string | null
  tags:             string[]
  view_count:       number
  post_count:       number
  event_time:       string | null
  first_reported:   string
  verified_at:      string | null
  created_at:       string
}

interface PaginatedResult<T> {
  items:   T[]
  cursor:  string | null
  hasMore: boolean
}

// ─── Config maps ─────────────────────────────────────────────────────────────

const ACCOUNT_BADGE: Record<string, { label: string; cls: string }> = {
  official:   { label: 'Official Source',     cls: 'bg-[rgba(0,212,255,0.12)] text-wp-cyan border-[rgba(0,212,255,0.35)]' },
  journalist: { label: 'Verified Journalist', cls: 'bg-[rgba(0,230,118,0.12)] text-wp-green border-[rgba(0,230,118,0.35)]' },
  expert:     { label: 'Domain Expert',       cls: 'bg-[rgba(139,92,246,0.12)] text-purple-400 border-[rgba(139,92,246,0.35)]' },
  admin:      { label: 'Power User',          cls: 'bg-[rgba(245,166,35,0.12)] text-wp-amber border-[rgba(245,166,35,0.35)]' },
  ai:         { label: 'AI System',           cls: 'bg-[rgba(139,92,246,0.12)] text-purple-400 border-[rgba(139,92,246,0.35)]' },
  community:  { label: 'Community Member',    cls: 'bg-wp-s2 text-wp-text3 border-[rgba(255,255,255,0.12)]' },
  bot:        { label: 'Bot',                 cls: 'bg-wp-s2 text-wp-text3 border-[rgba(255,255,255,0.12)]' },
}

const SEVERITY_CLS: Record<string, string> = {
  critical: 'bg-[rgba(255,59,92,0.12)] text-wp-red border-[rgba(255,59,92,0.35)]',
  high:     'bg-[rgba(245,166,35,0.12)] text-wp-amber border-[rgba(245,166,35,0.35)]',
  medium:   'bg-[rgba(0,212,255,0.12)] text-wp-cyan border-[rgba(0,212,255,0.35)]',
  low:      'bg-[rgba(0,230,118,0.12)] text-wp-green border-[rgba(0,230,118,0.35)]',
  info:     'bg-wp-s2 text-wp-text3 border-[rgba(255,255,255,0.12)]',
}

const POST_TYPE_LABEL: Record<string, string> = {
  signal:    'Signal',
  thread:    'Thread',
  report:    'Report',
  boost:     'Boost',
  deep_dive: 'Deep Dive',
  poll:      'Poll',
  ai_digest: 'AI Digest',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function trustColor(pct: number): string {
  if (pct >= 85) return 'text-wp-green'
  if (pct >= 70) return 'text-wp-amber'
  return 'text-wp-red'
}

function trustBg(pct: number): string {
  if (pct >= 85) return '#00e676'
  if (pct >= 70) return '#f5a623'
  return '#ff3b5c'
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function PostCard({ post }: { post: PostItem }) {
  const label = POST_TYPE_LABEL[post.post_type] ?? post.post_type
  const reliabilityPct = post.reliability_score !== null
    ? Math.round(post.reliability_score * 100)
    : null

  return (
    <article className="border border-[rgba(255,255,255,0.07)] rounded-xl p-4 hover:border-[rgba(255,255,255,0.12)] transition-colors bg-wp-s2">
      <div className="flex items-start justify-between gap-3 mb-2">
        <span className="inline-flex items-center px-2 py-[2px] rounded text-[10px] font-mono font-semibold border border-[rgba(255,255,255,0.12)] text-wp-text3 bg-wp-s3 uppercase tracking-wide">
          {label}
        </span>
        <span className="text-[12px] text-wp-text3 shrink-0">{timeAgo(post.created_at)}</span>
      </div>

      <p className="text-[14px] text-wp-text leading-relaxed mb-3 line-clamp-3">
        {post.content}
      </p>

      {post.signal_id && (
        <Link
          href={`/signals/${post.signal_id}`}
          className="inline-flex items-center gap-1 text-[12px] text-wp-cyan hover:underline mb-3"
        >
          <span>→</span> View signal
        </Link>
      )}

      {post.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {post.tags.slice(0, 4).map(tag => (
            <span key={tag} className="text-[11px] font-mono text-wp-text3 bg-wp-s3 rounded px-2 py-[2px]">
              #{tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-4 text-[12px] text-wp-text3">
        <span>{post.like_count} likes</span>
        <span>{post.boost_count} boosts</span>
        <span>{post.reply_count} replies</span>
        {reliabilityPct !== null && (
          <span className={`ml-auto font-mono font-semibold ${reliabilityPct >= 80 ? 'text-wp-green' : reliabilityPct >= 60 ? 'text-wp-amber' : 'text-wp-red'}`}>
            {reliabilityPct}% reliable
          </span>
        )}
      </div>
    </article>
  )
}

function SignalCard({ signal }: { signal: SignalItem }) {
  const sevCls = SEVERITY_CLS[signal.severity] ?? SEVERITY_CLS.info
  const reliPct = Math.round(signal.reliability_score * 100)

  return (
    <Link href={`/signals/${signal.id}`}>
      <article className="border border-[rgba(255,255,255,0.07)] rounded-xl p-4 hover:border-[rgba(255,255,255,0.14)] transition-colors bg-wp-s2 cursor-pointer">
        <div className="flex items-start gap-3 mb-2">
          <span className={`shrink-0 inline-flex items-center px-2 py-[2px] rounded text-[10px] font-mono font-semibold border uppercase tracking-wide ${sevCls}`}>
            {signal.severity}
          </span>
          <span className="text-[11px] text-wp-text3 font-mono uppercase tracking-wide bg-wp-s3 px-2 py-[2px] rounded border border-[rgba(255,255,255,0.08)]">
            {signal.category}
          </span>
          {signal.status === 'verified' && (
            <span className="shrink-0 ml-auto text-[11px] text-wp-green font-mono">✓ Verified</span>
          )}
        </div>

        <h3 className="text-[15px] font-semibold text-wp-text leading-snug mb-2 line-clamp-2">
          {signal.title}
        </h3>

        {signal.summary && (
          <p className="text-[13px] text-wp-text2 leading-relaxed mb-3 line-clamp-2">
            {signal.summary}
          </p>
        )}

        <div className="flex items-center gap-4 text-[12px] text-wp-text3">
          {signal.location_name && <span>📍 {signal.location_name}</span>}
          <span>{timeAgo(signal.created_at)}</span>
          <span className={`ml-auto font-mono font-semibold ${reliPct >= 80 ? 'text-wp-green' : reliPct >= 60 ? 'text-wp-amber' : 'text-wp-red'}`}>
            {reliPct}% reliable
          </span>
        </div>
      </article>
    </Link>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = 'posts' | 'signals' | 'reputation'

export default function UserProfilePage() {
  const params  = useParams<{ handle: string }>()
  const handle  = params.handle ?? ''
  const router  = useRouter()

  const { toast } = useToast()

  const [user, setUser]       = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Viewer's own identity
  const [viewerHandle, setViewerHandle] = useState<string | null>(null)

  // Follow state
  const [following, setFollowing]     = useState(false)
  const [followBusy, setFollowBusy]   = useState(false)

  // Tabs
  const [activeTab, setActiveTab] = useState<Tab>('posts')

  // Posts
  const [posts, setPosts]           = useState<PostItem[]>([])
  const [postsCursor, setPostsCursor] = useState<string | null>(null)
  const [postsHasMore, setPostsHasMore] = useState(false)
  const [postsLoading, setPostsLoading] = useState(false)
  const [postsLoaded, setPostsLoaded]   = useState(false)

  // Signals
  const [signals, setSignals]               = useState<SignalItem[]>([])
  const [signalsCursor, setSignalsCursor]   = useState<string | null>(null)
  const [signalsHasMore, setSignalsHasMore] = useState(false)
  const [signalsLoading, setSignalsLoading] = useState(false)
  const [signalsLoaded, setSignalsLoaded]   = useState(false)

  // ── Read viewer from localStorage ─────────────────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem('wp_user')
    if (raw) {
      try { setViewerHandle((JSON.parse(raw) as { handle: string }).handle) } catch { /* ignore */ }
    }
  }, [])

  // ── Fetch profile ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!handle) return
    setLoading(true)
    setNotFound(false)

    async function load() {
      try {
        const token = localStorage.getItem('wp_access_token')
        const res   = await fetch(`${API_URL}/api/v1/users/${handle}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (res.status === 404) { setNotFound(true); return }
        const data = await res.json() as { success: boolean; data: User }
        if (data.success) {
          setUser(data.data)
          setFollowing(data.data.isFollowing ?? false)
        } else {
          setNotFound(true)
        }
      } catch {
        setNotFound(true)
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [handle])

  // ── Load posts ────────────────────────────────────────────────────────────
  const loadPosts = useCallback(async (cursor?: string) => {
    setPostsLoading(true)
    try {
      const qs = new URLSearchParams({ limit: '20' })
      if (cursor) qs.set('cursor', cursor)
      const res  = await fetch(`${API_URL}/api/v1/users/${handle}/posts?${qs}`)
      const data = await res.json() as { success: boolean; data: PaginatedResult<PostItem> }
      if (data.success) {
        setPosts(prev => cursor ? [...prev, ...data.data.items] : data.data.items)
        setPostsCursor(data.data.cursor)
        setPostsHasMore(data.data.hasMore)
        setPostsLoaded(true)
      }
    } finally {
      setPostsLoading(false)
    }
  }, [handle])

  // ── Load signals ──────────────────────────────────────────────────────────
  const loadSignals = useCallback(async (cursor?: string) => {
    setSignalsLoading(true)
    try {
      const qs = new URLSearchParams({ limit: '20' })
      if (cursor) qs.set('cursor', cursor)
      const res  = await fetch(`${API_URL}/api/v1/users/${handle}/signals?${qs}`)
      const data = await res.json() as { success: boolean; data: PaginatedResult<SignalItem> }
      if (data.success) {
        setSignals(prev => cursor ? [...prev, ...data.data.items] : data.data.items)
        setSignalsCursor(data.data.cursor)
        setSignalsHasMore(data.data.hasMore)
        setSignalsLoaded(true)
      }
    } finally {
      setSignalsLoading(false)
    }
  }, [handle])

  // Load posts once profile is available
  useEffect(() => {
    if (user && !postsLoaded) void loadPosts()
  }, [user, postsLoaded, loadPosts])

  // Lazy-load signals when tab first activated
  useEffect(() => {
    if (activeTab === 'signals' && user && !signalsLoaded) void loadSignals()
  }, [activeTab, user, signalsLoaded, loadSignals])

  // ── Follow / unfollow ─────────────────────────────────────────────────────
  const toggleFollow = async () => {
    const token = localStorage.getItem('wp_access_token')
    if (!token) { router.push('/auth/login'); return }
    setFollowBusy(true)
    const next = !following
    setFollowing(next)
    try {
      const res = await fetch(`${API_URL}/api/v1/users/${handle}/follow`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        setFollowing(!next)
        toast('Could not update follow status — please try again', 'error')
      } else {
        toast(next ? `Now following @${handle}` : `Unfollowed @${handle}`, next ? 'success' : 'info')
      }
    } catch {
      setFollowing(!next)
      toast('Network error — please try again', 'error')
    } finally {
      setFollowBusy(false)
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const isOwnProfile = viewerHandle !== null && viewerHandle === handle
  const badge        = user ? (ACCOUNT_BADGE[user.accountType] ?? ACCOUNT_BADGE.community) : null
  const trustPct     = user ? Math.round(user.trustScore * 100) : 0
  const joinDate     = user
    ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : ''
  const repHistory   = user ? generateReputationHistory(user.trustScore) : []

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="h-36 shimmer" />
        <div className="px-5 pt-4 space-y-3">
          <div className="flex justify-between items-end">
            <div className="w-20 h-20 rounded-full shimmer -mt-10" />
            <div className="w-24 h-9 rounded-full shimmer" />
          </div>
          <div className="h-6 w-48 rounded shimmer" />
          <div className="h-4 w-32 rounded shimmer" />
          <div className="h-16 rounded-xl shimmer" />
        </div>
      </div>
    )
  }

  // ── Not found ─────────────────────────────────────────────────────────────
  if (notFound || !user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <div className="text-[52px] mb-4">👤</div>
        <div className="text-[20px] font-bold text-wp-text mb-2">User not found</div>
        <div className="text-[14px] text-wp-text3 mb-6">@{handle} doesn&apos;t exist on WorldPulse</div>
        <Link href="/" className="px-5 py-2 rounded-lg bg-wp-amber text-black text-[13px] font-bold hover:bg-[#ffb84d] transition-all">
          Go home
        </Link>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto">

      {/* ── Banner ── */}
      <div className="h-36 bg-gradient-to-br from-wp-s2 via-wp-s3 to-wp-bg relative overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse at 25% 60%, rgba(245,166,35,0.12) 0%, transparent 55%),
              radial-gradient(ellipse at 75% 40%, rgba(0,212,255,0.07) 0%, transparent 55%)
            `,
          }}
        />
      </div>

      <div className="px-5 pb-8">

        {/* ── Avatar + action button ── */}
        <div className="flex items-end justify-between -mt-10 mb-4">
          <div className="w-[84px] h-[84px] rounded-full border-4 border-wp-bg bg-gradient-to-br from-wp-amber to-orange-600 flex items-center justify-center font-bold text-[30px] text-black shrink-0 overflow-hidden">
            {user.avatarUrl
              ? <img src={user.avatarUrl} alt={user.displayName} className="w-full h-full object-cover" />
              : user.displayName.charAt(0).toUpperCase()
            }
          </div>

          {isOwnProfile ? (
            <Link
              href="/users/me"
              className="px-5 py-[8px] rounded-full font-semibold text-[13px] bg-wp-s2 border border-[rgba(255,255,255,0.15)] text-wp-text2 hover:border-wp-amber hover:text-wp-amber transition-all"
            >
              Edit Profile
            </Link>
          ) : (
            <button
              onClick={() => void toggleFollow()}
              disabled={followBusy}
              className={`px-5 py-[8px] rounded-full font-semibold text-[13px] transition-all disabled:opacity-60
                ${following
                  ? 'bg-wp-s2 border border-[rgba(255,255,255,0.15)] text-wp-text2 hover:border-wp-red hover:text-wp-red'
                  : 'bg-wp-amber text-black hover:bg-[#ffb84d]'
                }`}
            >
              {following ? 'Following' : 'Follow'}
            </button>
          )}
        </div>

        {/* ── Name + handle + badges ── */}
        <div className="mb-3">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h1 className="text-[22px] font-bold text-wp-text leading-tight">{user.displayName}</h1>
            {user.verified && (
              <span title="Verified" className="text-wp-cyan text-[18px] leading-none">✓</span>
            )}
            {badge && (
              <span className={`inline-flex items-center px-2 py-[2px] rounded text-[11px] font-mono font-semibold border ${badge.cls}`}>
                {badge.label}
              </span>
            )}
          </div>
          <div className="font-mono text-[14px] text-wp-text3">@{user.handle}</div>
          {user.isFollowedBy && !isOwnProfile && (
            <div className="mt-1 text-[12px] text-wp-text3">Follows you</div>
          )}
        </div>

        {/* ── Bio ── */}
        {user.bio && (
          <p className="text-[14px] text-wp-text2 leading-relaxed mb-3">{user.bio}</p>
        )}

        {/* ── Meta ── */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-wp-text3 mb-4">
          {user.location && <span>📍 {user.location}</span>}
          {user.website  && (
            <a
              href={user.website.startsWith('http') ? user.website : `https://${user.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-wp-cyan hover:underline"
            >
              🔗 {user.website.replace(/^https?:\/\//, '')}
            </a>
          )}
          <span>📅 Joined {joinDate}</span>
        </div>

        {/* ── Trust score ── */}
        <div className="flex items-center gap-3 bg-wp-s2 rounded-xl p-3 border border-[rgba(255,255,255,0.07)] mb-5">
          <span className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase whitespace-nowrap shrink-0">
            Trust Score
          </span>
          <div className="flex-1 h-[6px] bg-wp-s3 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${trustPct}%`, background: trustBg(trustPct) }}
            />
          </div>
          <span className={`font-mono text-[14px] font-bold shrink-0 ${trustColor(trustPct)}`}>
            {trustPct}%
          </span>
        </div>

        {/* ── Stats ── */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { value: user.signalCount.toLocaleString(),   label: 'Signals'   },
            { value: user.followerCount.toLocaleString(),  label: 'Followers' },
            { value: user.followingCount.toLocaleString(), label: 'Following' },
          ].map(s => (
            <div key={s.label} className="bg-wp-s2 rounded-xl p-4 text-center border border-[rgba(255,255,255,0.07)]">
              <div className="font-display text-[22px] text-wp-amber tracking-wide leading-none mb-1">
                {s.value}
              </div>
              <div className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase">
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-0 border-b border-[rgba(255,255,255,0.07)] mb-5">
          {(['posts', 'signals', 'reputation'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-[10px] text-[13px] font-medium border-b-2 capitalize transition-all
                ${activeTab === tab
                  ? 'text-wp-amber border-wp-amber'
                  : 'text-wp-text3 border-transparent hover:text-wp-text2'
                }`}
            >
              {tab === 'reputation' ? 'Reputation' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* ── Posts tab ── */}
        {activeTab === 'posts' && (
          <div className="space-y-3">
            {postsLoading && posts.length === 0 ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-wp-s2 border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="h-[18px] w-16 rounded shimmer" />
                    <div className="h-[18px] w-20 rounded shimmer" />
                  </div>
                  <div className="h-4 w-full rounded shimmer mb-2" />
                  <div className="h-4 w-3/4 rounded shimmer mb-2" />
                  <div className="h-4 w-1/2 rounded shimmer" />
                </div>
              ))
            ) : posts.length === 0 ? (
              <EmptyState
                icon="💬"
                headline={`@${user.handle} hasn't posted yet`}
                message="No posts here. Check back later or explore the global feed."
                cta={{ label: 'Go to feed', href: '/' }}
                compact
              />
            ) : (
              <>
                {posts.map(p => <PostCard key={p.id} post={p} />)}
                {postsHasMore && (
                  <button
                    onClick={() => postsCursor && void loadPosts(postsCursor)}
                    disabled={postsLoading}
                    className="w-full py-3 text-[13px] text-wp-text3 hover:text-wp-text border border-[rgba(255,255,255,0.07)] rounded-xl transition-colors disabled:opacity-50"
                  >
                    {postsLoading ? 'Loading…' : 'Load more posts'}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Signals tab ── */}
        {activeTab === 'signals' && (
          <div className="space-y-3">
            {signalsLoading && signals.length === 0 ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-wp-s2 border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-[18px] w-14 rounded shimmer" />
                    <div className="h-[18px] w-16 rounded shimmer" />
                    <div className="h-[18px] w-16 rounded shimmer ml-auto" />
                  </div>
                  <div className="h-5 w-4/5 rounded shimmer mb-2" />
                  <div className="h-4 w-2/3 rounded shimmer" />
                </div>
              ))
            ) : signals.length === 0 ? (
              <EmptyState
                icon="📡"
                headline={`No signals from @${user.handle}`}
                message="This user hasn't submitted any intelligence signals yet."
                cta={{ label: 'Explore signals', href: '/map' }}
                compact
              />
            ) : (
              <>
                {signals.map(s => <SignalCard key={s.id} signal={s} />)}
                {signalsHasMore && (
                  <button
                    onClick={() => signalsCursor && void loadSignals(signalsCursor)}
                    disabled={signalsLoading}
                    className="w-full py-3 text-[13px] text-wp-text3 hover:text-wp-text border border-[rgba(255,255,255,0.07)] rounded-xl transition-colors disabled:opacity-50"
                  >
                    {signalsLoading ? 'Loading…' : 'Load more signals'}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Reputation tab ── */}
        {activeTab === 'reputation' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold text-wp-text">Trust Score History</h2>
              <span className={`font-mono text-[13px] font-bold ${trustColor(trustPct)}`}>
                Current: {trustPct}%
              </span>
            </div>
            <div className="bg-wp-s2 border border-[rgba(255,255,255,0.07)] rounded-xl p-4 mb-4">
              <ReputationChart data={repHistory} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-wp-s2 border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
                <div className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase mb-2">Peak Score</div>
                <div className="font-display text-[22px] text-wp-green">
                  {Math.max(...repHistory.map(r => r.score))}%
                </div>
              </div>
              <div className="bg-wp-s2 border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
                <div className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase mb-2">30-day Change</div>
                <div className={`font-display text-[22px] ${
                  repHistory.length >= 2
                    ? repHistory[repHistory.length - 1].score >= repHistory[repHistory.length - 2].score
                      ? 'text-wp-green'
                      : 'text-wp-red'
                    : 'text-wp-text'
                }`}>
                  {repHistory.length >= 2
                    ? `${repHistory[repHistory.length - 1].score - repHistory[repHistory.length - 2].score > 0 ? '+' : ''}${repHistory[repHistory.length - 1].score - repHistory[repHistory.length - 2].score}%`
                    : '—'
                  }
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
