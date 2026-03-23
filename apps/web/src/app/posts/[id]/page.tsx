'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ReliabilityDots } from '@/components/signals/ReliabilityDots'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface PostAuthor {
  id: string
  handle: string
  displayName: string
  verified: boolean
  accountType: string
  trustScore: number
  avatarUrl: string | null
}

interface PostSignal {
  id: string
  title: string
  category: string
  severity: string
  reliabilityScore: number
  locationName: string | null
  sourceUrl: string | null
}

interface PostDetail {
  id: string
  content: string
  postType: string
  author: PostAuthor
  signal: PostSignal | null
  likeCount: number
  boostCount: number
  replyCount: number
  reliabilityScore: number | null
  tags: string[] | null
  createdAt: string
  updatedAt: string
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-900/30 text-red-400 border border-red-700/40',
  high:     'bg-orange-900/30 text-orange-400 border border-orange-700/40',
  medium:   'bg-yellow-900/30 text-yellow-400 border border-yellow-700/40',
  low:      'bg-slate-800/50 text-slate-400 border border-slate-700/40',
}

export default function PostDetailPage() {
  const params  = useParams()
  const router  = useRouter()
  const postId  = params?.id as string

  const [post, setPost]       = useState<PostDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!postId) return
    const token = typeof window !== 'undefined' ? localStorage.getItem('wp_access_token') : null
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    fetch(`${API_URL}/api/v1/posts/${postId}`, { headers })
      .then(res => {
        if (res.status === 404) { setNotFound(true); return null }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(data => {
        if (data) setPost(data.data ?? data)
      })
      .catch(err => {
        console.error('[PostDetail] fetch failed:', err)
        setNotFound(true)
      })
      .finally(() => setLoading(false))
  }, [postId])

  const authorInitial = post
    ? (post.author.displayName || post.author.handle).charAt(0).toUpperCase()
    : '?'

  if (loading) {
    return (
      <div className="min-h-screen bg-wp-bg flex items-center justify-center">
        <div className="text-wp-text3 text-sm animate-pulse">Loading post…</div>
      </div>
    )
  }

  if (notFound || !post) {
    return (
      <div className="min-h-screen bg-wp-bg flex flex-col items-center justify-center gap-4">
        <div className="text-wp-text3 text-sm">Post not found.</div>
        <Link href="/" className="text-wp-cyan text-sm hover:underline">← Back to feed</Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-wp-bg">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-wp-bg/90 backdrop-blur border-b border-[rgba(255,255,255,0.06)] px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-full hover:bg-[rgba(255,255,255,0.06)] transition-colors text-wp-text2"
          aria-label="Go back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="font-semibold text-[15px] text-wp-text">Post</span>
      </div>

      {/* Post content */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Author */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-[46px] h-[46px] rounded-full bg-gradient-to-br from-wp-cyan to-wp-green flex items-center justify-center font-bold text-[16px] text-white flex-shrink-0">
            {authorInitial}
          </div>
          <div>
            <div className="flex items-center gap-1">
              <span className="font-semibold text-[15px] text-wp-text">{post.author.displayName || post.author.handle}</span>
              {post.author.verified && <span className="text-wp-cyan text-[13px]">✓</span>}
            </div>
            <div className="text-[13px] text-wp-text3">@{post.author.handle} · {timeAgo(post.createdAt)}</div>
          </div>
        </div>

        {/* Content */}
        <div className="text-[16px] text-wp-text leading-[1.7] mb-4 whitespace-pre-line">
          {post.content}
        </div>

        {/* Tags */}
        {post.tags && post.tags.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-4">
            {post.tags.map(tag => (
              <span key={tag} className="px-2 py-1 rounded-full text-[11px] bg-[rgba(255,255,255,0.05)] text-wp-text3 border border-[rgba(255,255,255,0.08)]">
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Signal context */}
        {post.signal && (
          <div className="bg-wp-s2 border border-[rgba(255,255,255,0.07)] rounded-[12px] p-4 mb-4">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase">{post.signal.category}</span>
              {post.signal.locationName && (
                <span className="font-mono text-[11px] text-wp-text2">{post.signal.locationName}</span>
              )}
              <span className={`ml-auto px-2 py-0.5 rounded text-[10px] font-mono ${SEVERITY_COLORS[post.signal.severity] ?? SEVERITY_COLORS.low}`}>
                {post.signal.severity.toUpperCase()}
              </span>
            </div>
            <Link href={`/signals/${post.signal.id}`} className="font-semibold text-[14px] text-wp-text hover:text-wp-cyan transition-colors block mb-2 leading-[1.4]">
              {post.signal.title}
            </Link>
            <div className="flex items-center gap-3">
              <ReliabilityDots score={post.signal.reliabilityScore} label />
              {post.signal.sourceUrl && (
                <a
                  href={post.signal.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] text-wp-cyan hover:underline ml-auto"
                >
                  View original source →
                </a>
              )}
            </div>
          </div>
        )}

        {/* Stats bar */}
        <div className="flex items-center gap-5 py-3 border-t border-b border-[rgba(255,255,255,0.06)] mb-4 text-[14px] text-wp-text2">
          <span><strong className="text-wp-text">{post.likeCount}</strong> likes</span>
          <span><strong className="text-wp-text">{post.boostCount}</strong> boosts</span>
          <span><strong className="text-wp-text">{post.replyCount}</strong> replies</span>
          {post.reliabilityScore != null && (
            <div className="ml-auto">
              <ReliabilityDots score={post.reliabilityScore} label />
            </div>
          )}
        </div>

        {/* Back to feed */}
        <Link href="/" className="text-[13px] text-wp-text3 hover:text-wp-cyan transition-colors">
          ← Back to feed
        </Link>
      </div>
    </div>
  )
}
