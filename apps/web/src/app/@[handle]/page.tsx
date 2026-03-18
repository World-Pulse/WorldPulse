'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface UserProfile {
  id:             string
  handle:         string
  displayName:    string
  bio:            string | null
  avatarUrl:      string | null
  location:       string | null
  website:        string | null
  accountType:    string
  trustScore:     number
  followerCount:  number
  followingCount: number
  signalCount:    number
  verified:       boolean
  createdAt:      string
  isFollowing:    boolean
}

const ACCOUNT_TYPE_ICONS: Record<string, string> = {
  official:   '🏛️',
  journalist: '✅',
  expert:     '🔬',
  ai:         '🤖',
  community:  '👤',
}

export default function ProfilePage() {
  const params = useParams<{ handle: string }>()
  const handle = params.handle?.replace('%40', '') ?? ''

  const [user, setUser]         = useState<UserProfile | null>(null)
  const [loading, setLoading]   = useState(true)
  const [following, setFollowing] = useState(false)
  const [activeTab, setActiveTab] = useState<'posts'|'signals'|'likes'>('posts')

  useEffect(() => {
    async function fetchProfile() {
      try {
        const res  = await fetch(`${API_URL}/api/v1/users/${handle}`)
        const data = await res.json() as { success: boolean; data: UserProfile }
        if (data.success) {
          setUser(data.data)
          setFollowing(data.data.isFollowing)
        }
      } catch {
        // Demo profile
        setUser({
          id: '1', handle, displayName: handle.charAt(0).toUpperCase() + handle.slice(1),
          bio: 'WorldPulse community member', avatarUrl: null, location: 'Global',
          website: null, accountType: 'community', trustScore: 0.72,
          followerCount: 1240, followingCount: 380, signalCount: 847,
          verified: false, createdAt: '2026-01-01T00:00:00Z', isFollowing: false,
        })
      } finally {
        setLoading(false)
      }
    }
    if (handle) fetchProfile()
  }, [handle])

  const toggleFollow = async () => {
    setFollowing(f => !f)
    try {
      await fetch(`${API_URL}/api/v1/users/${handle}/follow`, { method: 'POST' })
    } catch { setFollowing(f => !f) }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="h-32 rounded-xl shimmer mb-4" />
        <div className="h-12 w-48 rounded-xl shimmer" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <div className="text-[48px] mb-4">👤</div>
        <div className="text-[18px] font-semibold text-wp-text mb-2">User not found</div>
        <div className="text-wp-text3">@{handle} doesn't exist on WorldPulse</div>
      </div>
    )
  }

  const trustPct  = Math.round(user.trustScore * 100)
  const joinDate  = new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const typeIcon  = ACCOUNT_TYPE_ICONS[user.accountType] ?? '👤'

  return (
    <div className="max-w-2xl mx-auto">

      {/* Banner */}
      <div className="h-40 bg-gradient-to-br from-wp-s2 via-wp-s3 to-wp-bg relative overflow-hidden">
        <div className="absolute inset-0" style={{
          background: `radial-gradient(ellipse at 30% 50%, rgba(245,166,35,0.1) 0%, transparent 60%),
                       radial-gradient(ellipse at 70% 50%, rgba(0,212,255,0.05) 0%, transparent 60%)`,
        }} />
      </div>

      <div className="px-5 pb-5">
        {/* Avatar + Follow */}
        <div className="flex items-end justify-between -mt-10 mb-4">
          <div className="w-[80px] h-[80px] rounded-full bg-gradient-to-br from-wp-amber to-orange-600 flex items-center justify-center font-bold text-[28px] text-black border-4 border-wp-bg">
            {user.displayName.charAt(0).toUpperCase()}
          </div>
          <button
            onClick={toggleFollow}
            className={`px-5 py-[8px] rounded-full font-semibold text-[13px] transition-all
              ${following
                ? 'bg-wp-s2 border border-[rgba(255,255,255,0.15)] text-wp-text2 hover:border-wp-red hover:text-wp-red'
                : 'bg-wp-amber text-black hover:bg-[#ffb84d]'
              }`}
          >
            {following ? 'Following' : 'Follow'}
          </button>
        </div>

        {/* Name + handle */}
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-[22px] font-bold text-wp-text">{user.displayName}</h1>
            {user.verified && <span className="text-wp-cyan text-[16px]">✓</span>}
            <span className="text-[18px]">{typeIcon}</span>
          </div>
          <div className="font-mono text-[14px] text-wp-text3">@{user.handle}</div>
        </div>

        {/* Bio */}
        {user.bio && <p className="text-[14px] text-wp-text2 leading-relaxed mb-3">{user.bio}</p>}

        {/* Meta */}
        <div className="flex flex-wrap gap-4 text-[13px] text-wp-text3 mb-4">
          {user.location && <span>📍 {user.location}</span>}
          {user.website  && <a href={user.website} className="text-wp-cyan hover:underline">🔗 {user.website}</a>}
          <span>📅 Joined {joinDate}</span>
        </div>

        {/* Trust Score */}
        <div className="flex items-center gap-3 mb-5 bg-wp-s2 rounded-xl p-3 border border-[rgba(255,255,255,0.07)]">
          <div className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase whitespace-nowrap">Trust Score</div>
          <div className="flex-1 h-[6px] bg-wp-s3 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-1000"
              style={{
                width: `${trustPct}%`,
                background: trustPct >= 85 ? '#00e676' : trustPct >= 70 ? '#f5a623' : '#ff3b5c',
              }}
            />
          </div>
          <div className={`font-mono text-[13px] font-bold ${trustPct >= 85 ? 'text-wp-green' : trustPct >= 70 ? 'text-wp-amber' : 'text-wp-red'}`}>
            {trustPct}%
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { value: user.signalCount.toLocaleString(),   label: 'Signals' },
            { value: user.followerCount.toLocaleString(),  label: 'Followers' },
            { value: user.followingCount.toLocaleString(), label: 'Following' },
          ].map(stat => (
            <div key={stat.label} className="bg-wp-s2 rounded-xl p-4 text-center border border-[rgba(255,255,255,0.07)]">
              <div className="font-display text-[22px] text-wp-amber tracking-wide leading-none mb-1">{stat.value}</div>
              <div className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Content tabs */}
        <div className="flex gap-0 border-b border-[rgba(255,255,255,0.07)] mb-4">
          {(['posts', 'signals', 'likes'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-[10px] text-[13px] font-medium border-b-2 capitalize transition-all
                ${activeTab === tab ? 'text-wp-amber border-wp-amber' : 'text-wp-text3 border-transparent hover:text-wp-text2'}`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Empty state for tabs */}
        <div className="text-center py-12">
          <div className="text-[40px] mb-3">📡</div>
          <div className="text-wp-text2 text-[14px]">
            {activeTab === 'posts'   && `@${user.handle} hasn't posted yet`}
            {activeTab === 'signals' && `No signals from @${user.handle}`}
            {activeTab === 'likes'   && 'Liked posts are private'}
          </div>
        </div>
      </div>
    </div>
  )
}
