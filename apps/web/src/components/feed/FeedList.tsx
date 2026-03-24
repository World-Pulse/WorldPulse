'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { Post, PollData } from '@worldpulse/types'
import { PollDisplay } from './PollDisplay'
import { RichMediaEmbed, extractFirstEmbedUrl } from '@/components/RichMediaEmbed'
import { ImageGallery } from '@/components/ImageGallery'
import { EmptyState } from '@/components/EmptyState'
import { useToast } from '@/components/Toast'
import { ReliabilityDots } from '@/components/signals/ReliabilityDots'
import { FlagModal } from '@/components/signals/FlagModal'
import type { CrossCheckStatus } from '@worldpulse/types'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ─── INTERNAL FEED ITEM SHAPE ────────────────────────────────────────────────
interface FeedItem {
  id: string
  type: 'signal' | 'post' | 'ai_digest'
  severity?: string
  sourceBadge?: string
  author: { initials: string; name: string; handle: string; verified?: boolean; color: string; badge?: string }
  breaking?: boolean
  contested?: boolean
  event?: {
    category: string
    location: string
    title: string
    summary: string
    sources: string[]
    impact: number
    impactColor: string
    isLive?: boolean
  }
  content?: string
  tags?: string[]
  tagTypes?: string[]
  mediaUrls?: string[]
  mediaTypes?: string[]
  pollData?: PollData
  pollId?: string
  likes: number
  boosts: number
  replies: number
  time: string
  // Raw 0-1 score for ReliabilityDots
  reliability: number | null
  // Tooltip metadata (signals only)
  sourceCount?: number
  crossCheckStatus?: CrossCheckStatus
  communityFlagCount?: number
}

// ─── DATA ADAPTERS ───────────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1)  return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

const CATEGORY_COLORS: Record<string, string> = {
  breaking: '#ff3b5c',
  conflict: '#ff3b5c',
  disaster: '#ff3b5c',
  high:     '#ff3b5c',
  critical: '#ff3b5c',
  climate:  '#00e676',
  science:  '#00d4ff',
  health:   '#00d4ff',
  economy:  '#f5a623',
  geopolitics: '#f5a623',
  elections: '#00d4ff',
  technology: '#a855f7',
  security: '#f97316',
  sports:   '#10b981',
  space:    '#6366f1',
}

const SOURCE_SLUG_TO_BADGE: Record<string, string> = {
  'ap-news': 'ap',
  'reuters': 'reuters',
  'bbc-world': 'bbc',
  'al-jazeera': 'al-jazeera',
  'guardian': 'guardian',
  'who': 'who',
  'usgs-quakes': 'usgs',
}

function crossCheckFromStatus(status: string): CrossCheckStatus {
  if (status === 'verified') return 'confirmed'
  if (status === 'disputed') return 'contested'
  return 'unconfirmed'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function adaptSignal(sig: any): FeedItem {
  const impactColor = CATEGORY_COLORS[sig.severity] ?? CATEGORY_COLORS[sig.category] ?? '#f5a623'
  const impact      = Math.round((sig.reliabilityScore ?? 0.5) * 100)
  const sourceSlugs: string[] = (sig.sources ?? []).map((s: { slug?: string }) => SOURCE_SLUG_TO_BADGE[s.slug ?? ''] ?? s.slug ?? 'wp')
  const badgeSlugs  = sourceSlugs.slice(0, 4)
  const ageMs       = sig.createdAt ? Date.now() - new Date(sig.createdAt as string).getTime() : Infinity
  const flagCount   = (sig.communityFlagCount ?? 0) as number

  return {
    id:       sig.id,
    type:     'signal',
    severity: sig.severity,
    sourceBadge: badgeSlugs[0],
    author: {
      initials: 'WP',
      name:     sig.locationName ? `WorldPulse · ${sig.locationName}` : 'WorldPulse Signal',
      handle:   '@worldpulse',
      verified: true,
      color:    'from-red-700 to-red-900',
    },
    breaking:  sig.isBreaking === true && ageMs < 30 * 60_000,
    contested: sig.status === 'disputed' || flagCount >= 3,
    event: {
      category: [sig.category?.toUpperCase(), sig.locationName ? sig.locationName.split(',').pop()?.trim() : null]
        .filter(Boolean).join(' · '),
      location: sig.locationName ? `📍 ${sig.locationName}` : '',
      title:    sig.title,
      summary:  sig.summary ?? '',
      sources:  badgeSlugs,
      impact,
      impactColor,
    },
    tags:              sig.tags ?? [],
    tagTypes:          (sig.tags ?? []).map(() => sig.category ?? 'breaking'),
    likes:             sig.viewCount  ?? 0,
    boosts:            sig.shareCount ?? 0,
    replies:           sig.postCount  ?? 0,
    time:              sig.createdAt ? timeAgo(sig.createdAt) : '?',
    reliability:       sig.reliabilityScore ?? null,
    sourceCount:       sig.sourceCount,
    crossCheckStatus:  sig.status ? crossCheckFromStatus(sig.status) : undefined,
    communityFlagCount: flagCount,
  }
}

function adaptPost(post: Post): FeedItem {
  const initial = (post.author.displayName || post.author.handle).charAt(0).toUpperCase()
  const base: FeedItem = {
    id:       post.id,
    type:     post.postType === 'signal' ? 'signal' : 'post',
    author: {
      initials: initial,
      name:     post.author.displayName,
      handle:   '@' + post.author.handle,
      verified: post.author.verified,
      color:    'from-violet-600 to-purple-900',
    },
    content:  post.content,
    tags:     post.tags ?? [],
    mediaUrls: post.mediaUrls ?? [],
    mediaTypes: post.mediaTypes ?? [],
    pollData: post.pollData ?? undefined,
    pollId:   post.id,
    likes:    post.likeCount  ?? 0,
    boosts:   post.boostCount ?? 0,
    replies:  post.replyCount ?? 0,
    time:     timeAgo(post.createdAt),
    reliability: post.reliabilityScore ?? null,
  }

  if (post.signal) {
    const s = post.signal
    const impactColor = CATEGORY_COLORS[s.severity] ?? '#f5a623'
    base.severity = s.severity
    base.breaking = s.severity === 'critical'
    base.event = {
      category: s.category?.toUpperCase() ?? 'SIGNAL',
      location: s.locationName ? `📍 ${s.locationName}` : '',
      title:    s.title,
      summary:  s.summary ?? '',
      sources:  [],
      impact:   Math.round((s.reliabilityScore ?? 0.5) * 100),
      impactColor,
    }
  }

  return base
}

// ─── STYLING HELPERS ─────────────────────────────────────────────────────────
const SEVERITY_BORDER: Record<string, string> = {
  critical: 'border-l-[3px] border-l-wp-red',
  high:     'border-l-[3px] border-l-wp-amber',
  medium:   'border-l-[3px] border-l-wp-cyan',
}

const SOURCE_BADGES: Record<string, string> = {
  ap:          'bg-red-700 text-white',
  reuters:     'bg-orange-500 text-black',
  bbc:         'bg-red-800 text-white',
  'al-jazeera': 'bg-[rgba(0,212,255,0.15)] text-wp-cyan border border-[rgba(0,212,255,0.3)]',
  guardian:    'bg-[rgba(0,230,118,0.15)] text-wp-green border border-[rgba(0,230,118,0.3)]',
  who:         'bg-[rgba(0,212,255,0.1)] text-wp-cyan border border-[rgba(0,212,255,0.3)]',
  usgs:        'bg-[rgba(245,166,35,0.15)] text-wp-amber border border-[rgba(245,166,35,0.3)]',
  wp:          'bg-[rgba(245,166,35,0.1)] text-wp-amber border border-[rgba(245,166,35,0.3)]',
}

const SOURCE_LABELS: Record<string, string> = {
  ap: 'AP', reuters: 'REUTERS', bbc: 'BBC',
  'al-jazeera': 'AL JAZEERA', guardian: 'GUARDIAN',
  who: 'WHO', usgs: 'USGS', wp: 'WorldPulse',
}

function formatCount(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000 ? `${(n / 1000).toFixed(1)}K`
    : String(n)
}


function TagPills({ tags, types }: { tags: string[]; types?: string[] }) {
  return (
    <div className="flex gap-[6px] flex-wrap mb-[10px]">
      {tags.map((tag, i) => (
        <span key={tag} className={`tag-pill tag-${types?.[i] ?? 'breaking'}`}>{tag}</span>
      ))}
    </div>
  )
}

function ActionBar({ item }: { item: FeedItem }) {
  const [liked,         setLiked]         = useState(false)
  const [boosted,       setBoosted]       = useState(false)
  const [bookmarked,    setBookmarked]    = useState(false)
  const [flagModalOpen, setFlagModalOpen] = useState(false)
  const [likes,  setLikes]  = useState(item.likes)
  const [boosts, setBoosts] = useState(item.boosts)
  const { toast } = useToast()

  const toggleLike = () => {
    const next = !liked
    setLiked(next)
    setLikes(n => next ? n + 1 : n - 1)
  }

  const toggleBoost = () => {
    const next = !boosted
    setBoosted(next)
    setBoosts(n => next ? n + 1 : n - 1)
    if (next) toast('Signal boosted — reaching more people', 'success')
  }

  const toggleBookmark = () => {
    const next = !bookmarked
    setBookmarked(next)
    toast(next ? 'Signal bookmarked — saved to your collection' : 'Bookmark removed', next ? 'success' : 'info')
  }

  return (
    <div className="flex items-center gap-0 mt-2" role="group" aria-label="Post actions">
      <button
        className="flex items-center gap-[5px] px-3 py-[6px] rounded-full text-[12px] text-wp-text3 hover:text-wp-amber hover:bg-[rgba(245,166,35,0.1)] transition-all"
        aria-label={`Reply — ${formatCount(item.replies)} replies`}
      >
        <span aria-hidden="true">💬</span> {formatCount(item.replies)}
      </button>
      <button
        onClick={toggleBoost}
        aria-label={`Boost — ${formatCount(boosts)} boosts`}
        aria-pressed={boosted}
        className={`flex items-center gap-[5px] px-3 py-[6px] rounded-full text-[12px] transition-all
          ${boosted ? 'text-wp-green' : 'text-wp-text3 hover:text-wp-green hover:bg-[rgba(0,230,118,0.1)]'}`}
      >
        <span aria-hidden="true">🔁</span> {formatCount(boosts)}
      </button>
      <button
        onClick={toggleLike}
        aria-label={liked ? `Unlike — ${formatCount(likes)} likes` : `Like — ${formatCount(likes)} likes`}
        aria-pressed={liked}
        className={`flex items-center gap-[5px] px-3 py-[6px] rounded-full text-[12px] transition-all
          ${liked ? 'text-wp-red' : 'text-wp-text3 hover:text-wp-red hover:bg-[rgba(255,59,92,0.1)]'}`}
      >
        <span aria-hidden="true">❤️</span> {formatCount(likes)}
      </button>
      <button
        onClick={toggleBookmark}
        aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark signal'}
        aria-pressed={bookmarked}
        className={`flex items-center gap-[5px] px-3 py-[6px] rounded-full text-[12px] transition-all
          ${bookmarked ? 'text-wp-amber' : 'text-wp-text3 hover:text-wp-amber hover:bg-[rgba(245,166,35,0.1)]'}`}
      >
        <span aria-hidden="true">{bookmarked ? '🔖' : '🔖'}</span>
      </button>
      <button
        onClick={async () => {
          const base = typeof window !== 'undefined' ? window.location.origin : 'https://world-pulse.io'
          const url  = item.type === 'signal' ? `${base}/signals/${item.id}` : `${base}/posts/${item.id}`
          const title = item.event?.title ?? item.content?.slice(0, 80) ?? 'WorldPulse Signal'
          if (typeof navigator !== 'undefined' && navigator.share) {
            try { await navigator.share({ title, url }) } catch { /* cancelled */ }
          } else {
            try {
              await navigator.clipboard.writeText(url)
              toast('Link copied to clipboard', 'success')
            } catch {
              // Clipboard API unavailable (non-HTTPS or permission denied) — use prompt fallback
              window.prompt('Copy this link:', url)
            }
          }
        }}
        className="flex items-center gap-[5px] px-3 py-[6px] rounded-full text-[12px] text-wp-text3 hover:text-wp-amber hover:bg-[rgba(245,166,35,0.1)] transition-all"
        aria-label="Share post"
      >
        <span aria-hidden="true">📤</span>
      </button>
      {item.type === 'signal' && (
        <button
          onClick={() => setFlagModalOpen(true)}
          className="flex items-center gap-[5px] px-3 py-[6px] rounded-full text-[12px] text-wp-text3 hover:text-wp-red hover:bg-[rgba(255,59,92,0.08)] transition-all"
          aria-label="Flag signal"
          title="Flag this signal"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
          </svg>
        </button>
      )}
      {item.reliability != null && (
        <div className="ml-auto">
          <ReliabilityDots
            score={item.reliability}
            label
            sourceCount={item.sourceCount}
            crossCheckStatus={item.crossCheckStatus}
            communityFlagCount={item.communityFlagCount}
          />
        </div>
      )}
      {flagModalOpen && (
        <FlagModal signalId={item.id} onClose={() => setFlagModalOpen(false)} />
      )}
    </div>
  )
}

function FeedSkeleton() {
  return (
    <div>
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="flex gap-3 px-5 py-4 border-b border-[rgba(255,255,255,0.05)]">
          {/* Avatar */}
          <div className="w-[42px] h-[42px] rounded-full shimmer flex-shrink-0" />
          <div className="flex-1 space-y-2 min-w-0">
            {/* Name + handle row */}
            <div className="flex items-center gap-2">
              <div className="h-[13px] w-28 rounded shimmer" />
              <div className="h-[10px] w-16 rounded shimmer" />
              <div className="h-[10px] w-10 rounded shimmer ml-auto" />
            </div>
            {/* Signal card */}
            <div className="rounded-[10px] shimmer h-[90px]" />
            {/* Tags */}
            <div className="flex gap-2">
              <div className="h-[18px] w-16 rounded-full shimmer" />
              <div className="h-[18px] w-20 rounded-full shimmer" />
              <div className="h-[18px] w-14 rounded-full shimmer" />
            </div>
            {/* Action bar */}
            <div className="flex gap-2 mt-1">
              <div className="h-[28px] w-14 rounded-full shimmer" />
              <div className="h-[28px] w-14 rounded-full shimmer" />
              <div className="h-[28px] w-14 rounded-full shimmer" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function FeedEmptyState({ tab }: { tab: string }) {
  if (tab === 'following') {
    return (
      <EmptyState
        icon="👥"
        headline="Your following feed is empty"
        message="Follow people and sources to see their signals and posts here."
        cta={{ label: 'Explore people to follow', href: '/explore' }}
      />
    )
  }
  return (
    <EmptyState
      icon="📡"
      headline="No signals yet"
      message="The scraper is collecting and verifying intelligence signals. Check back shortly."
      cta={{ label: 'Refresh feed', href: '/' }}
    />
  )
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export function FeedList({ tab, category }: { tab: string; category: string }) {
  const router = useRouter()
  const [items, setItems]     = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [cursor, setCursor]   = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const fetchFeed = useCallback(async (nextCursor?: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('wp_access_token') : null

    const params = new URLSearchParams()
    if (category && category !== 'all') params.set('category', category)
    if (nextCursor) params.set('cursor', nextCursor)

    let url: string
    if (tab === 'following') {
      url = `${API_URL}/api/v1/feed/following?${params}`
    } else if (tab === 'verified' || tab === 'global' || tab === 'digest') {
      url = `${API_URL}/api/v1/feed/signals?${params}`
    } else {
      url = `${API_URL}/api/v1/feed/signals?${params}`
    }

    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    try {
      const res = await fetch(url, { headers })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()

      // feed/signals returns { items, cursor, hasMore }
      // feed/following returns { items, cursor, hasMore }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawItems: any[] = data.items ?? []
      const mapped: FeedItem[] = rawItems.map(item => {
        // Signals have 'status' field; posts have 'postType'
        if ('status' in item && !('postType' in item)) {
          return adaptSignal(item)
        }
        return adaptPost(item as Post)
      })

      if (nextCursor) {
        setItems(prev => [...prev, ...mapped])
      } else {
        setItems(mapped)
      }
      setCursor(data.cursor ?? null)
      setHasMore(data.hasMore ?? false)
    } catch (err) {
      console.error('[FeedList] fetch failed:', err)
    }
  }, [tab, category])

  useEffect(() => {
    setLoading(true)
    setItems([])
    setCursor(null)
    fetchFeed().finally(() => setLoading(false))
  }, [fetchFeed])

  async function loadMore() {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    await fetchFeed(cursor)
    setLoadingMore(false)
  }

  if (loading) return <FeedSkeleton />
  if (items.length === 0) return <FeedEmptyState tab={tab} />

  return (
    <div>
      {items.map(item => (
        <article
          key={item.id}
          role="article"
          aria-label={
            item.event
              ? item.event.title
              : item.content
                ? item.content.slice(0, 80)
                : `Post by ${item.author.name}`
          }
          onClick={(e) => {
            // Only block navigation when clicking interactive controls
            if ((e.target as HTMLElement).closest('button, a, input, [data-no-nav]')) return
            router.push(item.type === 'signal' ? `/signals/${item.id}` : `/posts/${item.id}`)
          }}
          className={`flex gap-3 px-5 py-4 border-b border-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.015)] transition-colors cursor-pointer animate-fade-in
            ${item.type === 'signal' ? SEVERITY_BORDER[item.severity ?? ''] ?? '' : ''}`}
        >
          {/* Avatar */}
          <div className={`w-[42px] h-[42px] rounded-full bg-gradient-to-br ${item.author.color} flex items-center justify-center font-bold text-[14px] text-white flex-shrink-0`}>
            {item.author.initials}
          </div>

          {/* Body */}
          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-center gap-[6px] mb-1 flex-wrap">
              <span className="font-semibold text-[14px] text-wp-text">{item.author.name}</span>
              {item.author.verified && <span className="text-wp-cyan text-[13px]">✓</span>}
              {item.sourceBadge && (
                <span className={`source-badge ${SOURCE_BADGES[item.sourceBadge] ?? ''}`}>
                  {SOURCE_LABELS[item.sourceBadge] ?? item.sourceBadge.toUpperCase()}
                </span>
              )}
              {item.author.badge && (
                <span className="source-badge badge-community">{item.author.badge}</span>
              )}
              {item.type === 'ai_digest' && (
                <span className="source-badge badge-ai">AI SYNTHESIS</span>
              )}
              {item.breaking && (
                <span className="source-badge bg-wp-red text-white animate-flash-tag">⚡ BREAKING</span>
              )}
              {item.contested && (
                <span className="source-badge bg-[rgba(245,166,35,0.15)] text-wp-amber border border-[rgba(245,166,35,0.4)]">⚠ CONTESTED</span>
              )}
              {/* NEW flash for signals under 5 minutes old */}
              {item.time === 'now' || item.time.endsWith('m') && parseInt(item.time) <= 5 ? (
                <span className="source-badge bg-[rgba(0,230,118,0.15)] text-wp-green border border-[rgba(0,230,118,0.3)] text-[9px] animate-flash-tag">NEW</span>
              ) : null}
              <span className="ml-auto font-mono text-[12px] text-wp-text3 flex-shrink-0">{item.time} ago</span>
            </div>

            {/* Event card for signals */}
            {item.event && (
              <div className="bg-wp-s2 border border-[rgba(255,255,255,0.07)] rounded-[10px] p-3 mb-[10px] relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-[2px]"
                  style={{ background: `linear-gradient(to right, ${item.event.impactColor}, transparent)` }} />
                <div className="flex items-center gap-2 mb-[6px] flex-wrap">
                  <span className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase">{item.event.category}</span>
                  {item.event.location && (
                    <span className="font-mono text-[10px] text-wp-text2">{item.event.location}</span>
                  )}
                  {item.event.isLive && (
                    <span className="ml-auto tag-pill tag-technology text-[8px]">LIVE RESULTS</span>
                  )}
                </div>
                <div className="font-semibold text-[14px] text-wp-text mb-1 leading-[1.4]">{item.event.title}</div>
                {item.event.summary && (
                  <div className="text-[12px] text-wp-text2 leading-[1.5] mb-2">{item.event.summary}</div>
                )}
                {/* Source badges + source count */}
                {(item.event.sources.length > 0 || (item.sourceCount ?? 0) > 0) && (
                  <div className="flex items-center gap-1 flex-wrap mb-2">
                    {item.event.sources.map(s => (
                      <span key={s} className={`source-badge ${SOURCE_BADGES[s] ?? SOURCE_BADGES.wp}`}>
                        {SOURCE_LABELS[s] ?? s.toUpperCase()}
                      </span>
                    ))}
                    {/* Ground-News-style source count pill */}
                    {(item.sourceCount ?? 0) > item.event.sources.length && (
                      <span
                        title={`${item.sourceCount} sources confirmed this signal`}
                        className={`source-badge text-[9px] font-mono
                          ${(item.sourceCount ?? 0) >= 5
                            ? 'bg-[rgba(0,230,118,0.15)] text-wp-green border border-[rgba(0,230,118,0.3)]'
                            : 'bg-[rgba(0,212,255,0.1)] text-wp-cyan border border-[rgba(0,212,255,0.2)]'
                          }`}
                      >
                        {(item.sourceCount ?? 0) >= 5 ? '🔥 ' : ''}{item.sourceCount} sources
                      </span>
                    )}
                    {/* Trending indicator */}
                    {(item.sourceCount ?? 0) >= 8 && (
                      <span className="source-badge bg-[rgba(255,59,92,0.15)] text-wp-red border border-[rgba(255,59,92,0.3)] text-[9px] font-mono tracking-wider">
                        TRENDING
                      </span>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2 pt-2 border-t border-[rgba(255,255,255,0.05)]">
                  <span className="font-mono text-[9px] text-wp-text3">RELIABILITY</span>
                  <div className="flex-1 h-1 bg-wp-s3 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-1000"
                      style={{ width: `${item.event.impact}%`, background: item.event.impactColor }} />
                  </div>
                  <span className="font-mono text-[9px] text-wp-text3">{item.event.impact}%</span>
                </div>
              </div>
            )}

            {/* Post content */}
            {item.content && (() => {
              const text = item.content.replace(/\*\*(.*?)\*\*/g, '$1')
              const embedUrl = extractFirstEmbedUrl(text)
              return (
                <>
                  <div className="text-[14px] text-wp-text leading-[1.6] mb-[10px] whitespace-pre-line">
                    {text}
                  </div>
                  {embedUrl && (
                    <div className="mb-[10px]">
                      <RichMediaEmbed url={embedUrl} />
                    </div>
                  )}
                  {item.mediaUrls && item.mediaUrls.length > 0 && (
                    <div className="mb-[10px]">
                      <ImageGallery urls={item.mediaUrls} types={item.mediaTypes} />
                    </div>
                  )}
                </>
              )
            })()}

            {/* Poll */}
            {item.pollData && (
              <PollDisplay poll={item.pollData} pollId={item.pollId} />
            )}

            {/* Tags */}
            {item.tags && item.tags.length > 0 && (
              <TagPills tags={item.tags} types={item.tagTypes} />
            )}

            {/* Actions */}
            <ActionBar item={item} />
          </div>
        </article>
      ))}

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center py-6">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-6 py-[10px] rounded-full border border-[rgba(255,255,255,0.1)] text-[13px] text-wp-text2 hover:border-wp-amber hover:text-wp-amber hover:bg-[rgba(245,166,35,0.05)] transition-all font-medium disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load more signals'}
          </button>
        </div>
      )}
    </div>
  )
}
