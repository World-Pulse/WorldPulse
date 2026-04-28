'use client'

import { useState, useEffect, useCallback } from 'react'
import { Video } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ─── Types ───────────────────────────────────────────────────────────────────

type VideoClaimType = 'factual' | 'statistical' | 'attribution' | 'causal' | 'predictive' | 'visual' | 'chyron' | 'opinion'
type VideoClaimStatus = 'verified' | 'disputed' | 'unverified' | 'mixed' | 'opinion' | 'retracted'
type VideoSourceType = 'youtube' | 'news_broadcast' | 'political_debate' | 'press_conference' | 'un_session' | 'direct_url' | 'live_stream'

interface VideoClaim {
  id: string
  source_id: string
  text: string
  type: VideoClaimType
  confidence: number
  verification_score: number | null
  status: VideoClaimStatus
  speaker: string | null
  timestamp_start_s: number
  timestamp_end_s: number
  entities: string[]
  extracted_at: string
}

interface VideoStats {
  sources: number
  claims: number
  transcripts: number
  total_duration_hours: number
  monitored_channels: number
  supported_languages: number
  by_claim_type: { type: string; count: string }[]
  by_claim_status: { status: string; count: string }[]
  by_language: { language: string; count: string }[]
  by_source_type: { type: string; count: string }[]
}

interface MonitoredChannel {
  name: string
  type: VideoSourceType
  url: string
  language: string
  country: string
  category: string
  update_frequency: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CLAIM_TYPE_COLORS: Record<VideoClaimType, string> = {
  factual: '#3b82f6',
  statistical: '#8b5cf6',
  attribution: '#06b6d4',
  causal: '#f59e0b',
  predictive: '#ec4899',
  visual: '#10b981',
  chyron: '#14b8a6',
  opinion: '#6b7280',
}

const CLAIM_TYPE_LABELS: Record<VideoClaimType, string> = {
  factual: 'Factual',
  statistical: 'Statistical',
  attribution: 'Attribution',
  causal: 'Causal',
  predictive: 'Predictive',
  visual: 'Visual',
  chyron: 'Chyron',
  opinion: 'Opinion',
}

const STATUS_COLORS: Record<VideoClaimStatus, string> = {
  verified: '#10b981',
  disputed: '#ef4444',
  unverified: '#f59e0b',
  mixed: '#8b5cf6',
  opinion: '#6b7280',
  retracted: '#dc2626',
}

const SOURCE_TYPE_ICONS: Record<VideoSourceType, string> = {
  youtube: '▶️',
  news_broadcast: '📺',
  political_debate: '🏛️',
  press_conference: '🎤',
  un_session: '🇺🇳',
  direct_url: '🔗',
  live_stream: '🔴',
}

const LANGUAGE_FLAGS: Record<string, string> = {
  en: '🇬🇧', es: '🇪🇸', fr: '🇫🇷', ar: '🇸🇦', zh: '🇨🇳', ru: '🇷🇺',
  de: '🇩🇪', pt: '🇧🇷', ja: '🇯🇵', ko: '🇰🇷', hi: '🇮🇳', tr: '🇹🇷',
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function VideoClaimsPage() {
  const [stats, setStats] = useState<VideoStats | null>(null)
  const [claims, setClaims] = useState<VideoClaim[]>([])
  const [channels, setChannels] = useState<MonitoredChannel[]>([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<VideoClaimType | ''>('')
  const [statusFilter, setStatusFilter] = useState<VideoClaimStatus | ''>('')
  const [channelCategory, setChannelCategory] = useState('')
  const [expandedClaim, setExpandedClaim] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (typeFilter) params.set('type', typeFilter)
      if (statusFilter) params.set('status', statusFilter)
      params.set('limit', '20')

      const [statsRes, claimsRes, channelsRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/video-claims/stats`),
        fetch(`${API_URL}/api/v1/video-claims/claims?${params}`),
        fetch(`${API_URL}/api/v1/video-claims/channels${channelCategory ? `?category=${channelCategory}` : ''}`),
      ])

      if (statsRes.ok) setStats(await statsRes.json())
      if (claimsRes.ok) {
        const data = await claimsRes.json()
        setClaims(data.data ?? [])
      }
      if (channelsRes.ok) {
        const data = await channelsRes.json()
        setChannels(data.channels ?? [])
      }
    } catch {
      // Graceful degradation
    } finally {
      setLoading(false)
    }
  }, [search, typeFilter, statusFilter, channelCategory])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white">
      {/* Hero */}
      <div className="border-b border-white/10 bg-gradient-to-r from-[#0a0e1a] via-[#1a1040] to-[#0a0e1a]">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="flex items-center gap-3 mb-2">
            <Video className="w-8 h-8 text-red-400" />
            <h1 className="text-3xl font-bold tracking-tight">Video Intelligence</h1>
            <span className="ml-2 rounded-full bg-red-500/20 px-3 py-0.5 text-xs font-semibold text-red-300 border border-red-500/30">NEW</span>
          </div>
          <p className="text-sm text-white/50 max-w-2xl">
            Real-time claim extraction from video content — news broadcasts, political debates,
            press conferences, and YouTube channels. Multi-language transcription with speaker
            diarization and visual context analysis. Counters Factiverse Gather &amp; GDELT TV.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: 'Video Sources', value: stats?.sources ?? 0, icon: '📺' },
            { label: 'Claims Extracted', value: stats?.claims ?? 0, icon: '🔍' },
            { label: 'Hours Analyzed', value: stats?.total_duration_hours ?? 0, icon: '⏱️' },
            { label: 'Transcripts', value: stats?.transcripts ?? 0, icon: '📝' },
            { label: 'Channels Monitored', value: stats?.monitored_channels ?? 25, icon: '📡' },
            { label: 'Languages', value: stats?.supported_languages ?? 12, icon: '🌐' },
          ].map((stat, i) => (
            <div key={i} className="rounded-lg border border-white/10 bg-white/5 p-4 text-center">
              <div className="text-2xl mb-1">{stat.icon}</div>
              <div className="text-xl font-bold text-white">{stat.value.toLocaleString()}</div>
              <div className="text-xs text-white/40 mt-1">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Claim Type Distribution */}
        <div className="rounded-lg border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold mb-4">Claim Type Distribution</h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(CLAIM_TYPE_LABELS).map(([type, label]) => {
              const count = stats?.by_claim_type?.find(t => t.type === type)?.count ?? '0'
              return (
                <button
                  key={type}
                  onClick={() => setTypeFilter(typeFilter === type ? '' : type as VideoClaimType)}
                  className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm border transition-all ${
                    typeFilter === type
                      ? 'border-white/40 bg-white/10'
                      : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CLAIM_TYPE_COLORS[type as VideoClaimType] }} />
                  <span>{label}</span>
                  <span className="text-white/40">{parseInt(count, 10).toLocaleString()}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search claims..."
            className="flex-1 min-w-[200px] rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder-white/30 focus:border-blue-500/50 focus:outline-none"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as VideoClaimStatus | '')}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white focus:outline-none"
          >
            <option value="">All Statuses</option>
            {Object.entries(STATUS_COLORS).map(([status]) => (
              <option key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</option>
            ))}
          </select>
        </div>

        {/* Claims List */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">
            Extracted Claims {claims.length > 0 && <span className="text-white/40 text-sm ml-2">({claims.length})</span>}
          </h2>

          {loading ? (
            <div className="text-center py-12 text-white/30">Loading video intelligence...</div>
          ) : claims.length === 0 ? (
            <div className="text-center py-12 text-white/30">
              <Video className="w-10 h-10 text-white/30 mx-auto mb-3" />
              <p>No video claims found. The pipeline is monitoring {channels.length} channels.</p>
              <p className="text-xs mt-2">Claims will appear as videos are processed and analyzed.</p>
            </div>
          ) : (
            claims.map((claim) => (
              <div
                key={claim.id}
                className="rounded-lg border border-white/10 bg-white/5 p-4 hover:bg-white/8 cursor-pointer transition-all"
                onClick={() => setExpandedClaim(expandedClaim === claim.id ? null : claim.id)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: CLAIM_TYPE_COLORS[claim.type] }}
                      />
                      <span className="text-xs font-medium" style={{ color: CLAIM_TYPE_COLORS[claim.type] }}>
                        {CLAIM_TYPE_LABELS[claim.type]}
                      </span>
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: `${STATUS_COLORS[claim.status]}20`, color: STATUS_COLORS[claim.status] }}
                      >
                        {claim.status}
                      </span>
                      {claim.speaker && (
                        <span className="text-xs text-white/40">🎤 {claim.speaker}</span>
                      )}
                    </div>
                    <p className="text-sm text-white/80 leading-relaxed">{claim.text}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-xs text-white/30">{formatTimestamp(claim.timestamp_start_s)}</span>
                    <div className="flex items-center gap-1">
                      <div className="w-12 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.round(claim.confidence * 100)}%`,
                            backgroundColor: claim.confidence > 0.7 ? '#10b981' : claim.confidence > 0.5 ? '#f59e0b' : '#ef4444',
                          }}
                        />
                      </div>
                      <span className="text-xs text-white/30">{Math.round(claim.confidence * 100)}%</span>
                    </div>
                  </div>
                </div>

                {expandedClaim === claim.id && (
                  <div className="mt-3 pt-3 border-t border-white/10 text-xs space-y-2">
                    {claim.entities.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {claim.entities.map((e, i) => (
                          <span key={i} className="rounded bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-blue-300">{e}</span>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-4 text-white/30">
                      <span>Source: {claim.source_id}</span>
                      <span>Time: {formatTimestamp(claim.timestamp_start_s)} – {formatTimestamp(claim.timestamp_end_s)}</span>
                      <span>Extracted: {timeAgo(claim.extracted_at)}</span>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Monitored Channels */}
        <div className="rounded-lg border border-white/10 bg-white/5 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Monitored Video Channels ({channels.length})</h2>
            <select
              value={channelCategory}
              onChange={(e) => setChannelCategory(e.target.value)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white focus:outline-none"
            >
              <option value="">All Categories</option>
              <option value="News Broadcast">News Broadcast</option>
              <option value="Political Debate">Political Debate</option>
              <option value="Press Conference">Press Conference</option>
              <option value="UN Session">UN Session</option>
              <option value="Investigative">Investigative</option>
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {channels.map((ch, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
                <span className="text-lg">{SOURCE_TYPE_ICONS[ch.type] ?? '📺'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{ch.name}</div>
                  <div className="text-xs text-white/40 flex items-center gap-2">
                    <span>{LANGUAGE_FLAGS[ch.language] ?? '🌐'} {ch.language.toUpperCase()}</span>
                    <span>•</span>
                    <span>{ch.country}</span>
                    <span>•</span>
                    <span>{ch.update_frequency}</span>
                  </div>
                </div>
                <span className="text-xs text-white/20 px-2 py-0.5 rounded border border-white/10">{ch.category}</span>
              </div>
            ))}
          </div>
        </div>

        {/* How It Works */}
        <div className="rounded-lg border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold mb-4">How Video Intelligence Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { step: '1', title: 'Video Ingestion', desc: 'Monitor 25+ channels across YouTube, news broadcasts, parliamentary debates, and press conferences in 12 languages.', icon: '📺' },
              { step: '2', title: 'Transcription & Diarization', desc: 'Multi-provider speech-to-text (Whisper, Deepgram, AssemblyAI) with speaker identification and scene segmentation.', icon: '📝' },
              { step: '3', title: 'Claim Extraction', desc: 'NLP-based extraction of 8 claim types: factual, statistical, attribution, causal, predictive, visual, chyron, and opinion.', icon: '🔍' },
              { step: '4', title: 'Verification', desc: 'Cross-reference against WorldPulse knowledge graph, 700+ RSS sources, and existing verified signals.', icon: '✅' },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="text-3xl mb-2">{item.icon}</div>
                <div className="text-sm font-semibold mb-1">{item.title}</div>
                <p className="text-xs text-white/40 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Verification Status */}
        <div className="rounded-lg border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold mb-4">Verification Status Breakdown</h2>
          <div className="space-y-3">
            {Object.entries(STATUS_COLORS).map(([status, color]) => {
              const count = parseInt(stats?.by_claim_status?.find(s => s.status === status)?.count ?? '0', 10)
              const total = stats?.claims ?? 1
              const pct = total > 0 ? Math.round((count / total) * 100) : 0
              return (
                <div key={status} className="flex items-center gap-3">
                  <span className="w-24 text-sm capitalize">{status}</span>
                  <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                  </div>
                  <span className="text-xs text-white/40 w-16 text-right">{count.toLocaleString()} ({pct}%)</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Data Sources */}
        <div className="rounded-lg border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold mb-3">Data Sources &amp; Methodology</h2>
          <p className="text-xs text-white/40 leading-relaxed">
            Video Intelligence monitors 25+ channels across 12 languages using multi-provider
            speech-to-text transcription (OpenAI Whisper, Deepgram, AssemblyAI, Google STT).
            Claims are extracted using NLP pattern matching tuned for spoken language, with
            debate-specific and broadcast-specific classifiers. Visual context from chyrons and
            on-screen graphics supplements audio analysis. Cross-referencing uses WorldPulse's
            700+ RSS sources, knowledge graph (entity resolution + relationship inference), and
            semantic claim verification engine. Sources: YouTube Data API, C-SPAN archives,
            UK Parliament TV, European Parliament Multimedia, UN Web TV, major news broadcaster
            YouTube channels (BBC, CNN, Al Jazeera, DW, France 24, NHK, WION).
          </p>
        </div>

        {/* Pro CTA */}
        <div className="rounded-lg bg-gradient-to-r from-purple-900/40 to-blue-900/40 border border-purple-500/20 p-6 text-center">
          <h3 className="text-lg font-semibold mb-2">WorldPulse Pro — Video Intelligence</h3>
          <p className="text-sm text-white/50 mb-4 max-w-lg mx-auto">
            Unlock real-time video monitoring, automated debate fact-checking, speaker
            identification, and full transcript search across all 25+ channels.
          </p>
          <button className="rounded-lg bg-purple-600 hover:bg-purple-500 px-6 py-2 text-sm font-semibold transition-colors">
            Upgrade to Pro
          </button>
        </div>
      </div>
    </div>
  )
}
