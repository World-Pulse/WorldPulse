'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface CommunityDetail {
  id:          string
  slug:        string
  name:        string
  description: string | null
  avatarUrl:   string | null
  bannerUrl:   string | null
  categories:  string[]
  memberCount: number
  postCount:   number
  public:      boolean
  createdAt:   string
  viewerRole:  'admin' | 'moderator' | 'member' | null
  isMember:    boolean
  pinnedPosts: Array<{
    id:                  string
    content:             string
    post_type:           string
    like_count:          number
    boost_count:         number
    reply_count:         number
    created_at:          string
    author_handle:       string
    author_display_name: string
  }>
}

const DEMO: CommunityDetail = {
  id: '1', slug: 'climate-watch', name: 'Climate Watch',
  description: 'Tracking climate events, policy and science worldwide. Join thousands monitoring the planet.',
  avatarUrl: null, bannerUrl: null,
  categories: ['climate', 'science'],
  memberCount: 12400, postCount: 8900, public: true,
  createdAt: new Date().toISOString(),
  viewerRole: 'member', isMember: true,
  pinnedPosts: [
    {
      id: 'p1',
      content: '📌 PINNED: Community guidelines — please read before posting. Signal quality and source attribution are required for all reports.',
      post_type: 'thread', like_count: 342, boost_count: 89, reply_count: 12,
      created_at: new Date().toISOString(),
      author_handle: 'climatemod', author_display_name: 'Climate Watch Mod',
    },
  ],
}

export default function CommunityDetailPage() {
  const { slug } = useParams() as { slug: string }
  const router = useRouter()
  const [community, setCommunity] = useState<CommunityDetail | null>(null)
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('wp_token') : null
    fetch(`${API_URL}/api/v1/communities/${slug}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then((d: { success: boolean; data: CommunityDetail }) => {
        if (d.success) setCommunity(d.data)
        else setCommunity(DEMO)
      })
      .catch(() => setCommunity(DEMO))
      .finally(() => setLoading(false))
  }, [slug])

  const handleJoinLeave = async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('wp_token') : null
    if (!token) { alert('Please log in to join communities.'); return }
    if (!community) return

    try {
      const res = await fetch(`${API_URL}/api/v1/communities/${community.id}/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json() as { success: boolean; data: { joined: boolean } }
        const joined = data.data?.joined
        setCommunity(prev => prev ? {
          ...prev,
          isMember: joined,
          viewerRole: joined ? 'member' : null,
          memberCount: prev.memberCount + (joined ? 1 : -1),
        } : prev)
      }
    } catch { /* silent */ }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        <div className="h-28 rounded-xl shimmer" />
        <div className="h-16 rounded-xl shimmer" />
        <div className="h-36 rounded-xl shimmer" />
      </div>
    )
  }

  if (!community) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <div className="text-[48px] mb-4">🌐</div>
        <div className="text-[18px] font-semibold text-wp-text">Community not found</div>
        <button onClick={() => router.push('/communities')} className="mt-4 text-wp-amber hover:underline text-[14px]">
          Browse communities
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      {/* Community header */}
      <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl overflow-hidden mb-4">
        {/* Banner */}
        <div className="h-24 bg-gradient-to-r from-[#1a1f35] to-[#0d1018] relative">
          <div className="absolute inset-0 opacity-20"
            style={{ background: 'radial-gradient(ellipse at 30% 50%, #f5a623 0%, transparent 60%)' }} />
        </div>

        {/* Info */}
        <div className="px-5 pb-5">
          <div className="flex items-end justify-between -mt-6 mb-3">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-wp-amber to-orange-700 flex items-center justify-center text-[24px] border-2 border-wp-bg">
              {community.categories[0] === 'climate' ? '🌡️'
               : community.categories[0] === 'conflict' ? '⚔️'
               : community.categories[0] === 'technology' ? '💻'
               : '🌍'}
            </div>
            <div className="flex items-center gap-2">
              {(community.viewerRole === 'admin' || community.viewerRole === 'moderator') && (
                <span className="font-mono text-[10px] px-2 py-1 rounded border border-wp-amber text-wp-amber bg-[rgba(245,166,35,0.08)]">
                  {community.viewerRole.toUpperCase()}
                </span>
              )}
              <button
                onClick={handleJoinLeave}
                className={`px-4 py-2 rounded-lg text-[13px] font-semibold border transition-all
                  ${community.isMember
                    ? 'border-[rgba(255,255,255,0.12)] text-wp-text2 hover:border-wp-red hover:text-wp-red'
                    : 'bg-wp-amber border-wp-amber text-black hover:bg-[#ffb84d]'}`}
              >
                {community.isMember ? 'Leave community' : 'Join community'}
              </button>
            </div>
          </div>

          <h1 className="text-[20px] font-bold text-wp-text mb-1">{community.name}</h1>
          {community.description && (
            <p className="text-[13px] text-wp-text2 leading-relaxed mb-3">{community.description}</p>
          )}

          <div className="flex items-center gap-4 font-mono text-[12px] text-wp-text3">
            <span>👥 {community.memberCount.toLocaleString()} members</span>
            <span>💬 {community.postCount.toLocaleString()} posts</span>
            <span className="ml-auto">Since {new Date(community.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
          </div>

          {community.categories.length > 0 && (
            <div className="flex gap-2 mt-3">
              {community.categories.map(cat => (
                <span key={cat} className="font-mono text-[10px] px-2 py-0.5 rounded bg-[rgba(245,166,35,0.07)] border border-[rgba(245,166,35,0.15)] text-wp-amber">
                  {cat}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pinned posts */}
      {community.pinnedPosts.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-wp-amber text-[14px]">📌</span>
            <span className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase">Pinned posts</span>
            <div className="flex-1 h-px bg-[rgba(255,255,255,0.05)]" />
          </div>
          <div className="space-y-2">
            {community.pinnedPosts.map(post => (
              <div key={post.id}
                className="bg-wp-surface border border-[rgba(245,166,35,0.2)] rounded-xl p-4 relative">
                <div className="absolute top-3 right-3 text-wp-amber text-[12px]">📌</div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-wp-amber to-orange-700 flex items-center justify-center font-bold text-[10px] text-black">
                    {post.author_handle.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-semibold text-[13px] text-wp-text">{post.author_display_name}</span>
                  <span className="font-mono text-[11px] text-wp-text3">@{post.author_handle}</span>
                </div>
                <p className="text-[13px] text-wp-text2 leading-relaxed">{post.content}</p>
                <div className="flex items-center gap-3 mt-2 font-mono text-[11px] text-wp-text3">
                  <span>❤ {post.like_count}</span>
                  <span>🔁 {post.boost_count}</span>
                  <span>💬 {post.reply_count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Placeholder community feed */}
      <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-5 text-center">
        <div className="text-[32px] mb-3">💬</div>
        <div className="text-[15px] font-semibold text-wp-text mb-1">Community feed coming soon</div>
        <p className="text-[13px] text-wp-text3">
          {community.isMember
            ? "You're a member! Posts for this community will appear here."
            : 'Join to see and participate in community discussions.'}
        </p>
      </div>
    </div>
  )
}
