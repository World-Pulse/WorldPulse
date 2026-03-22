'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { Post } from '@worldpulse/types'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAuthToken(): string | null {
  try {
    return localStorage.getItem('wp_access_token')
  } catch {
    return null
  }
}

function timeAgo(d: string): string {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

const ACCT_COLOR: Record<string, string> = {
  journalist: '#00b4d8',
  official:   '#4ade80',
  expert:     '#a78bfa',
  ai:         '#f472b6',
  admin:      '#fb923c',
  community:  '#8892a4',
  bot:        '#64748b',
}

// ─── Compose / Reply form ─────────────────────────────────────────────────────

interface ComposeFormProps {
  signalId:    string
  parentId?:   string
  onSubmitted: (post: Post) => void
  onCancel?:   () => void
  placeholder?: string
}

function ComposeForm({ signalId, parentId, onSubmitted, onCancel, placeholder }: ComposeFormProps) {
  const [text, setText]           = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const token = getAuthToken()
    if (!token || !text.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/v1/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          postType: 'thread',
          content:  text.trim(),
          signalId,
          parentId: parentId ?? null,
        }),
      })
      if (!res.ok) {
        const json = await res.json() as { error?: string }
        setError(json.error ?? 'Failed to post')
        return
      }
      const json = await res.json() as { data?: Post }
      if (json.data) {
        onSubmitted(json.data)
        setText('')
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={placeholder ?? 'Add to the discussion…'}
        rows={3}
        className="w-full rounded-lg bg-white/[0.04] border border-white/10 text-[13px] text-wp-text placeholder-wp-text3 px-3 py-2.5 resize-none focus:outline-none focus:border-white/20 transition-colors"
      />
      {error && <p className="text-[11px] text-[#ff3b5c]">{error}</p>}
      <div className="flex items-center gap-2 justify-end">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-[12px] text-wp-text3 hover:text-wp-text transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={submitting || !text.trim()}
          className="px-4 py-1.5 rounded-lg text-[12px] font-semibold bg-white/[0.08] hover:bg-white/[0.12] text-wp-text disabled:opacity-40 transition-all"
        >
          {submitting ? 'Posting…' : 'Post'}
        </button>
      </div>
    </form>
  )
}

// ─── Post card ────────────────────────────────────────────────────────────────

interface PostCardProps {
  post:        Post
  signalId:    string
  onNewReply:  (parentId: string, newPost: Post) => void
}

function PostCard({ post, signalId, onNewReply }: PostCardProps) {
  const [liked,      setLiked]      = useState(post.hasLiked   ?? false)
  const [likeCount,  setLikeCount]  = useState(post.likeCount)
  const [boosted,    setBoosted]    = useState(post.hasBoosted  ?? false)
  const [boostCount, setBoostCount] = useState(post.boostCount)
  const [replyCount, setReplyCount] = useState(post.replyCount)
  const [showReply,  setShowReply]  = useState(false)
  const [isActing,   setIsActing]   = useState(false)

  const acctColor = ACCT_COLOR[post.author.accountType] ?? '#8892a4'
  const initial   = post.author.displayName.charAt(0).toUpperCase()

  async function handleLike() {
    const token = getAuthToken()
    if (!token || isActing) return
    const wasLiked = liked
    setLiked(!wasLiked)
    setLikeCount(c => wasLiked ? c - 1 : c + 1)
    setIsActing(true)
    try {
      await fetch(`${API_BASE}/api/v1/posts/${post.id}/like`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {
      setLiked(wasLiked)
      setLikeCount(c => wasLiked ? c + 1 : c - 1)
    } finally {
      setIsActing(false)
    }
  }

  async function handleBoost() {
    const token = getAuthToken()
    if (!token || boosted || isActing) return
    setBoosted(true)
    setBoostCount(c => c + 1)
    setIsActing(true)
    try {
      await fetch(`${API_BASE}/api/v1/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ postType: 'boost', boostOfId: post.id, signalId, content: '' }),
      })
    } catch {
      setBoosted(false)
      setBoostCount(c => c - 1)
    } finally {
      setIsActing(false)
    }
  }

  function handleReplied(newPost: Post) {
    setShowReply(false)
    setReplyCount(c => c + 1)
    onNewReply(post.id, newPost)
  }

  return (
    <div className="py-4 border-b border-white/[0.06] last:border-0">
      <div className="flex gap-3">
        {/* Avatar */}
        <div className="flex-shrink-0 mt-0.5">
          {post.author.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.author.avatarUrl}
              alt={post.author.displayName}
              width={32}
              height={32}
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-[12px] select-none"
              style={{ background: `${acctColor}1a`, color: acctColor, border: `1px solid ${acctColor}33` }}
            >
              {initial}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Author row */}
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <Link
              href={`/users/${post.author.handle}`}
              className="text-[13px] font-semibold text-wp-text hover:underline leading-none"
            >
              {post.author.displayName}
            </Link>
            <span
              className="font-mono text-[9px] uppercase tracking-widest"
              style={{ color: acctColor }}
            >
              {post.author.accountType}
            </span>
            {post.author.verified && (
              <span className="text-wp-green text-[10px] leading-none" aria-label="Verified">
                ✓
              </span>
            )}
            <span className="font-mono text-[10px] text-wp-text3 ml-auto shrink-0">
              {timeAgo(post.createdAt)}
            </span>
          </div>

          {/* Content */}
          <p className="text-[13px] text-wp-text2 leading-[1.7] whitespace-pre-wrap break-words mb-2.5">
            {post.content}
          </p>

          {/* Actions */}
          <div className="flex items-center gap-5">
            {/* Like */}
            <button
              onClick={handleLike}
              className="flex items-center gap-1.5 group"
              aria-label={liked ? 'Unlike' : 'Like'}
            >
              <svg
                width="13" height="13" viewBox="0 0 24 24"
                fill={liked ? '#ff3b5c' : 'none'}
                stroke={liked ? '#ff3b5c' : 'currentColor'}
                strokeWidth="2"
                className="text-wp-text3 group-hover:text-[#ff3b5c] transition-colors"
              >
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              <span
                className="font-mono text-[10px] transition-colors"
                style={{ color: liked ? '#ff3b5c' : undefined }}
              >
                {likeCount}
              </span>
            </button>

            {/* Reply */}
            <button
              onClick={() => setShowReply(r => !r)}
              className="flex items-center gap-1.5 group"
              aria-label="Reply"
            >
              <svg
                width="13" height="13" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2"
                className="text-wp-text3 group-hover:text-wp-text2 transition-colors"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span className="font-mono text-[10px] text-wp-text3 group-hover:text-wp-text2 transition-colors">
                {replyCount}
              </span>
            </button>

            {/* Boost */}
            <button
              onClick={handleBoost}
              disabled={boosted}
              className="flex items-center gap-1.5 group disabled:cursor-default"
              aria-label="Boost"
            >
              <svg
                width="13" height="13" viewBox="0 0 24 24"
                fill="none"
                stroke={boosted ? '#00e676' : 'currentColor'}
                strokeWidth="2"
                className={boosted ? '' : 'text-wp-text3 group-hover:text-wp-green transition-colors'}
              >
                <polyline points="17 1 21 5 17 9" />
                <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                <polyline points="7 23 3 19 7 15" />
                <path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
              <span
                className="font-mono text-[10px] transition-colors"
                style={{ color: boosted ? '#00e676' : undefined }}
              >
                {boostCount}
              </span>
            </button>
          </div>

          {/* Inline reply form */}
          {showReply && (
            <div className="mt-3 pl-3 border-l-2 border-white/10">
              <ComposeForm
                signalId={signalId}
                parentId={post.id}
                onSubmitted={handleReplied}
                onCancel={() => setShowReply(false)}
                placeholder={`Reply to ${post.author.displayName}…`}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

interface Props {
  initialPosts: Post[]
  signalId:     string
  totalCount:   number
}

export function DiscussionThread({ initialPosts, signalId, totalCount }: Props) {
  const [posts,     setPosts]     = useState<Post[]>(initialPosts)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [sort,      setSort]      = useState<'recent' | 'top'>('recent')

  useEffect(() => {
    setIsLoggedIn(!!getAuthToken())
  }, [])

  function handleNewPost(post: Post) {
    setPosts(prev => [post, ...prev])
  }

  function handleNewReply(_parentId: string, newPost: Post) {
    setPosts(prev => [...prev, newPost])
  }

  const liveTotal  = totalCount + (posts.length - initialPosts.length)
  const sorted     = sort === 'top'
    ? [...posts].sort((a, b) => (b.likeCount + b.boostCount) - (a.likeCount + a.boostCount))
    : posts

  return (
    <section aria-label="Signal discussion">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">
          Discussion ({liveTotal})
        </div>
        <div className="flex items-center gap-0.5 bg-white/[0.04] rounded-lg p-0.5">
          {(['recent', 'top'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className="px-3 py-1 rounded-md font-mono text-[10px] uppercase tracking-wider transition-all"
              style={{
                background: sort === s ? 'rgba(255,255,255,0.08)' : 'transparent',
                color:      sort === s ? 'var(--color-wp-text, #e2e6f0)' : 'var(--color-wp-text3, #64748b)',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Compose box */}
      {isLoggedIn ? (
        <div className="mb-5 p-4 rounded-xl border border-white/[0.07] bg-white/[0.02]">
          <ComposeForm
            signalId={signalId}
            onSubmitted={handleNewPost}
            placeholder="Share your analysis or context on this signal…"
          />
        </div>
      ) : (
        <div className="mb-5 p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] text-center">
          <p className="text-[12px] text-wp-text3 mb-3">Sign in to join the discussion</p>
          <div className="flex justify-center gap-2">
            <Link
              href="/auth/login"
              className="px-4 py-1.5 rounded-lg text-[12px] font-semibold bg-white/[0.08] hover:bg-white/[0.12] text-wp-text transition-all"
            >
              Sign in
            </Link>
            <Link
              href="/auth/register"
              className="px-4 py-1.5 rounded-lg text-[12px] font-semibold bg-wp-green/10 hover:bg-wp-green/20 text-wp-green border border-wp-green/20 transition-all"
            >
              Join free
            </Link>
          </div>
        </div>
      )}

      {/* Posts */}
      {sorted.length === 0 ? (
        <div className="text-center py-10 rounded-xl border border-white/[0.05]">
          <p className="text-[13px] text-wp-text3">
            No discussion yet — be the first to add context.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-4">
          {sorted.map(post => (
            <PostCard
              key={post.id}
              post={post}
              signalId={signalId}
              onNewReply={handleNewReply}
            />
          ))}
        </div>
      )}
    </section>
  )
}
