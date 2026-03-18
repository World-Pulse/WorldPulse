'use client'

import { useState, useEffect } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface AnalyticsData {
  overview: {
    totalPosts:           number
    totalLikesReceived:   number
    totalBoostsReceived:  number
    totalRepliesReceived: number
    totalViews:           number
    followerCount:        number
    followingCount:       number
    signalCount:          number
    engagementRate:       number
  }
  signals: {
    submitted:        number
    verified:         number
    verificationRate: number
  }
  postsPerDay: Array<{ date: string; count: number }>
  topPosts: Array<{
    id:              string
    content:         string
    postType:        string
    likeCount:       number
    boostCount:      number
    replyCount:      number
    viewCount:       number
    engagementTotal: number
    createdAt:       string
  }>
}

// Demo data for unauthenticated view
const DEMO_DATA: AnalyticsData = {
  overview: {
    totalPosts: 47, totalLikesReceived: 3240, totalBoostsReceived: 891,
    totalRepliesReceived: 412, totalViews: 52400, followerCount: 1830,
    followingCount: 294, signalCount: 12, engagementRate: 0.0786,
  },
  signals: { submitted: 12, verified: 9, verificationRate: 0.75 },
  postsPerDay: Array.from({ length: 30 }, (_, i) => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - (29 - i))
    return { date: d.toISOString().slice(0, 10), count: Math.floor(Math.random() * 5) }
  }),
  topPosts: [
    { id: '1', content: 'Breaking: Manila earthquake M5.8 — full thread on structural implications', postType: 'thread', likeCount: 1240, boostCount: 380, replyCount: 112, viewCount: 18400, engagementTotal: 1732, createdAt: new Date().toISOString() },
    { id: '2', content: 'EU AI directive emergency clause — what it means for frontier labs in practice', postType: 'deep_dive', likeCount: 870, boostCount: 260, replyCount: 89, viewCount: 12100, engagementTotal: 1219, createdAt: new Date().toISOString() },
    { id: '3', content: 'Arctic sea ice data — 940k km² below previous record. Feedback loops accelerating beyond IPCC projections', postType: 'signal', likeCount: 620, boostCount: 190, replyCount: 54, viewCount: 9300, engagementTotal: 864, createdAt: new Date().toISOString() },
    { id: '4', content: 'South Korea election analysis — demographic shifts in rural precincts driving unexpected results', postType: 'report', likeCount: 310, boostCount: 61, replyCount: 44, viewCount: 5800, engagementTotal: 415, createdAt: new Date().toISOString() },
    { id: '5', content: 'Gaza humanitarian corridor update — UN convoy status and access timeline', postType: 'signal', likeCount: 200, boostCount: 0, replyCount: 113, viewCount: 6700, engagementTotal: 313, createdAt: new Date().toISOString() },
  ],
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-4 flex flex-col gap-1">
      <span className="font-mono text-[10px] tracking-[2px] text-wp-text3 uppercase">{label}</span>
      <span className={`text-[24px] font-bold leading-none ${color ?? 'text-wp-text'}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
      {sub && <span className="font-mono text-[11px] text-wp-text3">{sub}</span>}
    </div>
  )
}

// Simple SVG line chart — no external dependency
function LineChart({ data }: { data: Array<{ date: string; count: number }> }) {
  const W = 560
  const H = 120
  const PAD = { top: 12, right: 12, bottom: 28, left: 28 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom

  const maxVal = Math.max(...data.map(d => d.count), 1)

  const points = data.map((d, i) => ({
    x: PAD.left + (i / (data.length - 1)) * chartW,
    y: PAD.top + chartH - (d.count / maxVal) * chartH,
    ...d,
  }))

  const polyline = points.map(p => `${p.x},${p.y}`).join(' ')

  // Fill area path
  const areaPath = [
    `M ${points[0].x},${PAD.top + chartH}`,
    ...points.map(p => `L ${p.x},${p.y}`),
    `L ${points[points.length - 1].x},${PAD.top + chartH}`,
    'Z',
  ].join(' ')

  // X-axis labels — show every 7th day
  const xLabels = points.filter((_, i) => i % 7 === 0 || i === data.length - 1)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f5a623" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#f5a623" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
        const y = PAD.top + t * chartH
        return (
          <line key={i} x1={PAD.left} y1={y} x2={PAD.left + chartW} y2={y}
            stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        )
      })}

      {/* Y-axis labels */}
      {[0, Math.ceil(maxVal / 2), maxVal].map((v, i) => {
        const y = PAD.top + chartH - (v / maxVal) * chartH
        return (
          <text key={i} x={PAD.left - 6} y={y + 4} textAnchor="end"
            fontSize="9" fill="rgba(255,255,255,0.3)" fontFamily="monospace">
            {v}
          </text>
        )
      })}

      {/* Area fill */}
      <path d={areaPath} fill="url(#chartFill)" />

      {/* Line */}
      <polyline points={polyline} fill="none" stroke="#f5a623" strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" />

      {/* Data point dots */}
      {points.filter(p => p.count > 0).map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill="#f5a623" />
      ))}

      {/* X-axis labels */}
      {xLabels.map((p, i) => (
        <text key={i} x={p.x} y={H - 4} textAnchor="middle"
          fontSize="9" fill="rgba(255,255,255,0.3)" fontFamily="monospace">
          {p.date.slice(5)} {/* MM-DD */}
        </text>
      ))}
    </svg>
  )
}

function EngagementFunnel({ views, likes, boosts }: { views: number; likes: number; boosts: number }) {
  const max = Math.max(views, 1)
  const bars = [
    { label: 'Views',  value: views,  pct: 100,                       color: 'bg-wp-cyan' },
    { label: 'Likes',  value: likes,  pct: (likes  / max) * 100,     color: 'bg-wp-amber' },
    { label: 'Boosts', value: boosts, pct: (boosts / max) * 100,     color: 'bg-wp-green' },
  ]
  return (
    <div className="space-y-3">
      {bars.map(bar => (
        <div key={bar.label}>
          <div className="flex items-center justify-between mb-1">
            <span className="font-mono text-[11px] text-wp-text3 uppercase">{bar.label}</span>
            <span className="font-mono text-[11px] text-wp-text2">{bar.value.toLocaleString()}</span>
          </div>
          <div className="h-[6px] bg-wp-s3 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ${bar.color}`}
              style={{ width: `${bar.pct.toFixed(1)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function AnalyticsPage() {
  const [data, setData]     = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [isDemo, setIsDemo] = useState(false)

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('wp_token') : null
    if (!token) {
      setData(DEMO_DATA)
      setIsDemo(true)
      setLoading(false)
      return
    }

    fetch(`${API_URL}/api/v1/analytics/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then((d: { success: boolean; data: AnalyticsData }) => {
        if (d.success) setData(d.data)
        else { setData(DEMO_DATA); setIsDemo(true) }
      })
      .catch(() => { setData(DEMO_DATA); setIsDemo(true) })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-4">
        <div className="h-8 w-48 rounded-lg shimmer" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="h-20 rounded-xl shimmer" />)}
        </div>
        <div className="h-48 rounded-xl shimmer" />
      </div>
    )
  }

  if (!data) return null

  const { overview, signals, postsPerDay, topPosts } = data

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-wp-text">Your Analytics</h1>
          <p className="text-[13px] text-wp-text3 mt-0.5">Last 30 days · All time stats</p>
        </div>
        {isDemo && (
          <span className="font-mono text-[11px] px-3 py-1 rounded-full border border-wp-amber text-wp-amber bg-[rgba(245,166,35,0.08)]">
            Demo data
          </span>
        )}
      </div>

      {/* Stats cards row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Posts"    value={overview.totalPosts}          color="text-wp-text" />
        <StatCard label="Likes Received" value={overview.totalLikesReceived}  color="text-wp-red" />
        <StatCard label="Boosts"         value={overview.totalBoostsReceived} color="text-wp-green" />
        <StatCard label="Followers"      value={overview.followerCount}       color="text-wp-amber" />
      </div>

      {/* Activity chart */}
      <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <span className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase">Posts per day — last 30 days</span>
          <span className="font-mono text-[11px] text-wp-text2">
            {postsPerDay.reduce((s, d) => s + d.count, 0)} total
          </span>
        </div>
        <LineChart data={postsPerDay} />
      </div>

      {/* Signal contribution + Engagement funnel */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Signal contribution */}
        <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-5">
          <span className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase block mb-4">Signal Contributions</span>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-[rgba(255,255,255,0.05)]">
              <span className="text-[13px] text-wp-text2">Signals submitted</span>
              <span className="font-mono text-[14px] font-bold text-wp-text">{signals.submitted}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-[rgba(255,255,255,0.05)]">
              <span className="text-[13px] text-wp-text2">Signals verified</span>
              <span className="font-mono text-[14px] font-bold text-wp-green">{signals.verified}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-[13px] text-wp-text2">Verification rate</span>
              <span className="font-mono text-[14px] font-bold text-wp-amber">
                {(signals.verificationRate * 100).toFixed(0)}%
              </span>
            </div>
          </div>
          {/* Mini verification bar */}
          <div className="mt-3 h-[6px] bg-wp-s3 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-wp-green transition-all duration-700"
              style={{ width: `${(signals.verificationRate * 100).toFixed(1)}%` }} />
          </div>
        </div>

        {/* Engagement funnel */}
        <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase">Engagement Funnel</span>
            <span className="font-mono text-[11px] text-wp-amber">
              {(overview.engagementRate * 100).toFixed(1)}% rate
            </span>
          </div>
          <EngagementFunnel
            views={overview.totalViews}
            likes={overview.totalLikesReceived}
            boosts={overview.totalBoostsReceived}
          />
        </div>
      </div>

      {/* Top posts table */}
      <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[rgba(255,255,255,0.05)] flex items-center justify-between">
          <span className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase">Top Posts by Engagement</span>
          <span className="font-mono text-[11px] text-wp-text3">All time</span>
        </div>
        <div>
          {topPosts.map((post, idx) => (
            <div key={post.id}
              className="flex items-start gap-3 px-5 py-4 border-b border-[rgba(255,255,255,0.04)] last:border-0 hover:bg-[rgba(255,255,255,0.02)] transition-colors">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-wp-s3 flex items-center justify-center font-mono text-[11px] text-wp-text3 mt-0.5">
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-wp-text leading-snug line-clamp-2">{post.content}</p>
                <div className="flex items-center gap-3 mt-1.5 font-mono text-[11px] text-wp-text3">
                  <span className="text-wp-red">❤ {post.likeCount.toLocaleString()}</span>
                  <span className="text-wp-green">🔁 {post.boostCount.toLocaleString()}</span>
                  <span className="text-wp-cyan">💬 {post.replyCount.toLocaleString()}</span>
                  <span className="ml-auto text-wp-amber font-bold">{post.engagementTotal.toLocaleString()} eng.</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Extra stats row */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total Views"   value={overview.totalViews.toLocaleString()}           sub="across all posts" />
        <StatCard label="Replies Rcvd"  value={overview.totalRepliesReceived.toLocaleString()}  sub="on your posts" />
        <StatCard label="Following"     value={overview.followingCount.toLocaleString()}        sub={`${overview.followerCount.toLocaleString()} followers`} />
      </div>

    </div>
  )
}
