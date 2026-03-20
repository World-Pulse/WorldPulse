'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const CATEGORIES = [
  'breaking', 'conflict', 'geopolitics', 'climate', 'health',
  'economy', 'technology', 'science', 'elections', 'culture',
  'disaster', 'security', 'sports', 'space', 'other',
]

const CATEGORY_ICONS: Record<string, string> = {
  breaking: '🚨', conflict: '⚔️', geopolitics: '🌐', climate: '🌡️', health: '🏥',
  economy: '📈', technology: '💻', science: '🔬', elections: '🗳️', culture: '🎭',
  disaster: '🌊', security: '🔒', sports: '⚽', space: '🚀', other: '🌍',
}

const SORT_OPTIONS = [
  { value: 'members',  label: 'Most members' },
  { value: 'posts',    label: 'Most posts' },
  { value: 'trending', label: 'Trending' },
  { value: 'newest',   label: 'Newest' },
]

interface Community {
  id:          string
  slug:        string
  name:        string
  description: string | null
  avatarUrl:   string | null
  categories:  string[]
  memberCount: number
  postCount:   number
  recentPosts: number
  isMember:    boolean
  viewerRole:  string | null
  createdAt:   string
}

// Demo data
const DEMO_COMMUNITIES: Community[] = [
  { id: '1', slug: 'climate-watch', name: 'Climate Watch', description: 'Tracking climate events, policy and science worldwide', avatarUrl: null, categories: ['climate', 'science'], memberCount: 12400, postCount: 8900, recentPosts: 42, isMember: false, viewerRole: null, createdAt: new Date().toISOString() },
  { id: '2', slug: 'conflict-monitor', name: 'Conflict Monitor', description: 'Global conflict tracking and analysis', avatarUrl: null, categories: ['conflict', 'geopolitics'], memberCount: 9800, postCount: 14200, recentPosts: 87, isMember: true, viewerRole: 'member', createdAt: new Date().toISOString() },
  { id: '3', slug: 'tech-regulation', name: 'Tech & Regulation', description: 'AI governance, tech policy, and digital rights', avatarUrl: null, categories: ['technology', 'geopolitics'], memberCount: 7300, postCount: 5400, recentPosts: 23, isMember: false, viewerRole: null, createdAt: new Date().toISOString() },
  { id: '4', slug: 'election-watchers', name: 'Election Watchers', description: 'Democratic elections, voter rights, and electoral integrity', avatarUrl: null, categories: ['elections'], memberCount: 6100, postCount: 9800, recentPosts: 156, isMember: false, viewerRole: null, createdAt: new Date().toISOString() },
  { id: '5', slug: 'global-health', name: 'Global Health', description: 'WHO alerts, disease outbreaks, healthcare policy', avatarUrl: null, categories: ['health'], memberCount: 5900, postCount: 4100, recentPosts: 18, isMember: true, viewerRole: 'moderator', createdAt: new Date().toISOString() },
  { id: '6', slug: 'disaster-response', name: 'Disaster Response', description: 'Natural disasters and emergency response coordination', avatarUrl: null, categories: ['disaster', 'climate'], memberCount: 4200, postCount: 3200, recentPosts: 31, isMember: false, viewerRole: null, createdAt: new Date().toISOString() },
  { id: '7', slug: 'space-news', name: 'Space News', description: 'Space exploration, astronomy, and aerospace', avatarUrl: null, categories: ['space', 'science'], memberCount: 3800, postCount: 2900, recentPosts: 9, isMember: false, viewerRole: null, createdAt: new Date().toISOString() },
  { id: '8', slug: 'economy-brief', name: 'Economy Brief', description: 'Markets, trade, inflation, and global economics', avatarUrl: null, categories: ['economy'], memberCount: 8100, postCount: 6700, recentPosts: 44, isMember: false, viewerRole: null, createdAt: new Date().toISOString() },
]

function ActivityDot({ count }: { count: number }) {
  if (count === 0) return <span className="w-[6px] h-[6px] rounded-full bg-wp-s3" />
  if (count < 10) return <span className="w-[6px] h-[6px] rounded-full bg-wp-amber" />
  if (count < 50) return <span className="w-[6px] h-[6px] rounded-full bg-wp-green animate-pulse" />
  return <span className="w-[6px] h-[6px] rounded-full bg-wp-red animate-pulse" />
}

function CommunityCard({
  community,
  onJoin,
  onClick,
}: {
  community: Community
  onJoin: (id: string) => void
  onClick: (slug: string) => void
}) {
  return (
    <div
      onClick={() => onClick(community.slug)}
      className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-4 hover:border-[rgba(255,255,255,0.15)] transition-all cursor-pointer group"
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-wp-amber to-orange-700 flex items-center justify-center font-bold text-[16px] flex-shrink-0">
          {CATEGORY_ICONS[community.categories[0]] ?? '🌍'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[14px] text-wp-text group-hover:text-wp-amber transition-colors truncate">
            {community.name}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <ActivityDot count={community.recentPosts} />
            <span className="font-mono text-[10px] text-wp-text3">
              {community.recentPosts > 0 ? `${community.recentPosts} posts today` : 'Quiet today'}
            </span>
          </div>
        </div>
        {community.viewerRole === 'admin' && (
          <span className="font-mono text-[9px] px-2 py-0.5 rounded border border-wp-amber text-wp-amber bg-[rgba(245,166,35,0.08)]">
            ADMIN
          </span>
        )}
        {community.viewerRole === 'moderator' && (
          <span className="font-mono text-[9px] px-2 py-0.5 rounded border border-wp-cyan text-wp-cyan bg-[rgba(0,212,255,0.08)]">
            MOD
          </span>
        )}
      </div>

      {/* Description */}
      {community.description && (
        <p className="text-[12px] text-wp-text2 leading-relaxed mb-3 line-clamp-2">{community.description}</p>
      )}

      {/* Categories */}
      <div className="flex flex-wrap gap-1 mb-3">
        {community.categories.map(cat => (
          <span key={cat} className="font-mono text-[10px] px-2 py-0.5 rounded bg-[rgba(245,166,35,0.07)] border border-[rgba(245,166,35,0.15)] text-wp-amber">
            {cat}
          </span>
        ))}
      </div>

      {/* Stats + join */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 font-mono text-[11px] text-wp-text3">
          <span>👥 {community.memberCount.toLocaleString()}</span>
          <span>💬 {community.postCount.toLocaleString()}</span>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onJoin(community.id) }}
          className={`px-3 py-[5px] rounded-full text-[12px] font-medium border transition-all
            ${community.isMember
              ? 'border-[rgba(255,255,255,0.12)] text-wp-text2 hover:border-wp-red hover:text-wp-red'
              : 'border-wp-amber text-wp-amber hover:bg-[rgba(245,166,35,0.1)]'}`}
        >
          {community.isMember ? 'Leave' : 'Join'}
        </button>
      </div>
    </div>
  )
}

export default function CommunitiesPage() {
  const router = useRouter()
  const [communities, setCommunities] = useState<Community[]>([])
  const [featured, setFeatured]       = useState<Community[]>([])
  const [trending, setTrending]       = useState<Community[]>([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [category, setCategory]       = useState('')
  const [sort, setSort]               = useState('members')
  const [view, setView]               = useState<'grid' | 'grouped'>('grid')

  const fetchCommunities = useCallback(async (s: string, cat: string, srt: string) => {
    setLoading(true)
    const token = typeof window !== 'undefined' ? localStorage.getItem('wp_token') : null
    const params = new URLSearchParams({ sort: srt, limit: '100' })
    if (s)   params.set('search', s)
    if (cat) params.set('category', cat)

    try {
      const res = await fetch(`${API_URL}/api/v1/communities?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const data = await res.json() as {
        success: boolean
        data: { communities: Community[]; featured: Community[]; trending: Community[] }
      }
      if (data.success) {
        setCommunities(data.data.communities)
        setFeatured(data.data.featured)
        setTrending(data.data.trending)
      } else {
        throw new Error('API failed')
      }
    } catch {
      // API unavailable — show empty state
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCommunities(search, category, sort)
  }, []) // eslint-disable-line

  const handleJoin = async (communityId: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('wp_token') : null
    if (!token) { alert('Please log in to join communities.'); return }

    try {
      const res = await fetch(`${API_URL}/api/v1/communities/${communityId}/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json() as { success: boolean; data: { joined: boolean } }
        const joined = data.data?.joined
        setCommunities(prev => prev.map(c =>
          c.id === communityId
            ? { ...c, isMember: joined, memberCount: c.memberCount + (joined ? 1 : -1) }
            : c
        ))
        setFeatured(prev => prev.map(c => c.id === communityId ? { ...c, isMember: joined } : c))
        setTrending(prev => prev.map(c => c.id === communityId ? { ...c, isMember: joined } : c))
      }
    } catch { /* silent */ }
  }

  const handleSearch = (s: string) => {
    setSearch(s)
    fetchCommunities(s, category, sort)
  }

  const handleCategoryFilter = (cat: string) => {
    const next = category === cat ? '' : cat
    setCategory(next)
    fetchCommunities(search, next, sort)
  }

  const handleSort = (s: string) => {
    setSort(s)
    fetchCommunities(search, category, s)
  }

  const navigateToCommunity = (slug: string) => router.push(`/communities/${slug}`)

  // Group by primary category
  const byCategory: Record<string, Community[]> = {}
  for (const c of communities) {
    const primary = c.categories[0] ?? 'other'
    if (!byCategory[primary]) byCategory[primary] = []
    byCategory[primary].push(c)
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-wp-text">Communities</h1>
          <p className="text-[13px] text-wp-text3 mt-0.5">Join conversations around the topics you care about</p>
        </div>
        <button
          onClick={() => router.push('/communities/new')}
          className="px-4 py-2 rounded-lg bg-wp-amber text-black text-[13px] font-bold hover:bg-[#ffb84d] transition-all"
        >
          + New
        </button>
      </div>

      {/* Trending section */}
      {trending.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <span className="font-mono text-[11px] tracking-[2px] text-wp-red uppercase">Trending now</span>
            <div className="flex-1 h-px bg-[rgba(255,255,255,0.05)]" />
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {trending.map(c => (
              <div
                key={c.id}
                onClick={() => navigateToCommunity(c.slug)}
                className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-wp-s2 border border-[rgba(255,59,92,0.2)] rounded-lg cursor-pointer hover:border-wp-red transition-all"
              >
                <span className="text-[16px]">{CATEGORY_ICONS[c.categories[0]] ?? '🌍'}</span>
                <div>
                  <div className="text-[13px] font-semibold text-wp-text">{c.name}</div>
                  <div className="font-mono text-[10px] text-wp-red">{c.recentPosts} posts today</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Featured section */}
      {featured.length > 0 && !search && !category && (
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <span className="font-mono text-[11px] tracking-[2px] text-wp-amber uppercase">Featured communities</span>
            <div className="flex-1 h-px bg-[rgba(255,255,255,0.05)]" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {featured.map(c => (
              <div
                key={c.id}
                onClick={() => navigateToCommunity(c.slug)}
                className="flex flex-col items-center gap-2 px-3 py-4 bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl cursor-pointer hover:border-wp-amber transition-all text-center group"
              >
                <div className="text-[24px]">{CATEGORY_ICONS[c.categories[0]] ?? '🌍'}</div>
                <div className="text-[12px] font-semibold text-wp-text group-hover:text-wp-amber transition-colors line-clamp-1">{c.name}</div>
                <div className="font-mono text-[11px] text-wp-text3">{c.memberCount.toLocaleString()} members</div>
                <button
                  onClick={e => { e.stopPropagation(); handleJoin(c.id) }}
                  className={`w-full text-[11px] py-1 rounded-full border transition-all
                    ${c.isMember
                      ? 'border-wp-green text-wp-green bg-[rgba(0,230,118,0.08)]'
                      : 'border-wp-amber text-wp-amber hover:bg-[rgba(245,166,35,0.1)]'}`}
                >
                  {c.isMember ? 'Joined' : 'Join'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search + filters */}
      <div className="flex flex-col gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2 bg-wp-s2 border border-[rgba(255,255,255,0.08)] rounded-xl px-3 py-2.5 focus-within:border-wp-amber transition-colors">
            <span className="text-wp-text3">🔍</span>
            <input
              type="text"
              value={search}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search communities…"
              className="flex-1 bg-transparent border-none outline-none text-[14px] text-wp-text placeholder-wp-text3 caret-wp-amber"
            />
          </div>

          {/* Sort dropdown */}
          <select
            value={sort}
            onChange={e => handleSort(e.target.value)}
            className="bg-wp-s2 border border-[rgba(255,255,255,0.08)] rounded-xl px-3 py-2.5 text-[13px] text-wp-text focus:outline-none focus:border-wp-amber"
          >
            {SORT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {/* View toggle */}
          <div className="flex border border-[rgba(255,255,255,0.08)] rounded-xl overflow-hidden">
            <button
              onClick={() => setView('grid')}
              className={`px-3 py-2.5 text-[13px] transition-all ${view === 'grid' ? 'bg-wp-s3 text-wp-amber' : 'text-wp-text3 hover:text-wp-text'}`}
            >
              ▦
            </button>
            <button
              onClick={() => setView('grouped')}
              className={`px-3 py-2.5 text-[13px] transition-all ${view === 'grouped' ? 'bg-wp-s3 text-wp-amber' : 'text-wp-text3 hover:text-wp-text'}`}
            >
              ≡
            </button>
          </div>
        </div>

        {/* Category filter chips */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => handleCategoryFilter('')}
            className={`flex-shrink-0 font-mono text-[11px] px-3 py-1 rounded-full border transition-all
              ${!category ? 'border-wp-amber text-wp-amber bg-[rgba(245,166,35,0.1)]' : 'border-[rgba(255,255,255,0.08)] text-wp-text3 hover:border-wp-amber hover:text-wp-amber'}`}
          >
            All
          </button>
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => handleCategoryFilter(cat)}
              className={`flex-shrink-0 flex items-center gap-1 font-mono text-[11px] px-3 py-1 rounded-full border transition-all
                ${category === cat ? 'border-wp-amber text-wp-amber bg-[rgba(245,166,35,0.1)]' : 'border-[rgba(255,255,255,0.08)] text-wp-text3 hover:border-wp-amber hover:text-wp-amber'}`}
            >
              {CATEGORY_ICONS[cat]} {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="h-36 rounded-xl shimmer" />)}
        </div>
      )}

      {/* Results — grid view */}
      {!loading && view === 'grid' && communities.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {communities.map(c => (
            <CommunityCard key={c.id} community={c} onJoin={handleJoin} onClick={navigateToCommunity} />
          ))}
        </div>
      )}

      {/* Results — grouped by category */}
      {!loading && view === 'grouped' && (
        <div className="space-y-6">
          {Object.entries(byCategory).map(([cat, items]) => (
            <div key={cat}>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-[18px]">{CATEGORY_ICONS[cat] ?? '🌍'}</span>
                <span className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase">{cat}</span>
                <span className="font-mono text-[10px] text-wp-amber bg-[rgba(245,166,35,0.1)] border border-[rgba(245,166,35,0.2)] px-2 py-0.5 rounded-full">{items.length}</span>
                <div className="flex-1 h-px bg-[rgba(255,255,255,0.05)]" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {items.map(c => (
                  <CommunityCard key={c.id} community={c} onJoin={handleJoin} onClick={navigateToCommunity} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && communities.length === 0 && (
        <div className="text-center py-16">
          <div className="text-[48px] mb-4">🌐</div>
          <div className="text-[18px] font-semibold text-wp-text mb-2">No communities found</div>
          <div className="text-wp-text3 text-[14px]">Try different search terms or be the first to create one.</div>
          <button
            onClick={() => router.push('/communities/new')}
            className="mt-4 px-5 py-2 rounded-lg bg-wp-amber text-black font-bold text-[13px] hover:bg-[#ffb84d] transition-all"
          >
            Create community
          </button>
        </div>
      )}
    </div>
  )
}
