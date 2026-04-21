'use client'

import { useState, useEffect, useCallback } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface AudioClaim {
  id: string
  text: string
  type: string
  confidence: number
  verification_score: number
  status: string
  speaker: string | null
  speaker_name: string | null
  timestamp_start_s: number
  timestamp_end_s: number
  source_title: string | null
  source_publisher: string | null
  entities: string[]
  extracted_at: string
}

interface AudioStats {
  total_sources: number
  total_duration_hours: number
  total_claims: number
  avg_confidence: number
  avg_verification_score: number
  claim_types: Record<string, number>
  claim_statuses: Record<string, number>
  languages: Record<string, number>
  monitored_podcasts: number
}

interface PodcastFeed {
  name: string
  publisher: string
  language: string
  category: string
  feed_url: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'

const CLAIM_TYPE_LABELS: Record<string, string> = {
  factual: 'Factual',
  statistical: 'Statistical',
  attribution: 'Attribution',
  causal: 'Causal',
  predictive: 'Predictive',
  opinion: 'Opinion',
}

const CLAIM_TYPE_COLORS: Record<string, string> = {
  factual: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  statistical: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  attribution: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  causal: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  predictive: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  opinion: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
}

const STATUS_LABELS: Record<string, string> = {
  verified: 'Verified',
  disputed: 'Disputed',
  unverified: 'Unverified',
  mixed: 'Mixed',
  opinion: 'Opinion',
}

const STATUS_COLORS: Record<string, string> = {
  verified: 'bg-green-500/20 text-green-400',
  disputed: 'bg-red-500/20 text-red-400',
  unverified: 'bg-yellow-500/20 text-yellow-400',
  mixed: 'bg-orange-500/20 text-orange-400',
  opinion: 'bg-gray-500/20 text-gray-400',
}

const CATEGORY_LABELS: Record<string, string> = {
  general_news: 'General News',
  international: 'International',
  analysis: 'Analysis',
  security: 'Security',
  technology: 'Technology',
  economics: 'Economics',
  science: 'Science',
  investigative: 'Investigative',
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AudioClaimsPage() {
  const [stats, setStats] = useState<AudioStats | null>(null)
  const [claims, setClaims] = useState<AudioClaim[]>([])
  const [podcasts, setPodcasts] = useState<PodcastFeed[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedClaim, setSelectedClaim] = useState<AudioClaim | null>(null)
  const [podcastCategory, setPodcastCategory] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (typeFilter) params.set('type', typeFilter)
      if (statusFilter) params.set('status', statusFilter)
      params.set('limit', '20')

      const [statsRes, claimsRes, podcastsRes] = await Promise.all([
        fetch(`${API_BASE}/audio-claims/stats`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API_BASE}/audio-claims/claims?${params}`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API_BASE}/audio-claims/podcasts${podcastCategory ? `?category=${podcastCategory}` : ''}`).then(r => r.ok ? r.json() : null).catch(() => null),
      ])

      if (statsRes) setStats(statsRes)
      if (claimsRes?.data) setClaims(claimsRes.data)
      if (podcastsRes?.data) setPodcasts(podcastsRes.data)
    } catch {
      // API may not be running — show demo state
    } finally {
      setLoading(false)
    }
  }, [search, typeFilter, statusFilter, podcastCategory])

  useEffect(() => { fetchData() }, [fetchData])

  // ─── Demo data for when API is not available ─────────────────────────────
  const demoStats: AudioStats = stats ?? {
    total_sources: 20,
    total_duration_hours: 847.3,
    total_claims: 3842,
    avg_confidence: 0.72,
    avg_verification_score: 0.58,
    claim_types: { factual: 1240, statistical: 890, attribution: 720, causal: 410, predictive: 320, opinion: 262 },
    claim_statuses: { verified: 1120, unverified: 1340, disputed: 482, mixed: 638, opinion: 262 },
    languages: { en: 16, fr: 1, es: 1, de: 1, sv: 1 },
    monitored_podcasts: 20,
  }

  const demoClaims: AudioClaim[] = claims.length > 0 ? claims : [
    { id: '1', text: 'The unemployment rate dropped to 3.7% in the latest Bureau of Labor Statistics report, the lowest in 18 months.', type: 'statistical', confidence: 0.92, verification_score: 0.88, status: 'verified', speaker: 'Speaker 1', speaker_name: 'Sarah Chen', timestamp_start_s: 145, timestamp_end_s: 158, source_title: 'NPR News Now', source_publisher: 'NPR', entities: ['Bureau of Labor Statistics'], extracted_at: '2026-04-06T12:00:00Z' },
    { id: '2', text: 'The European Central Bank confirmed it will raise interest rates by 25 basis points at the next meeting.', type: 'attribution', confidence: 0.85, verification_score: 0.72, status: 'mixed', speaker: 'Speaker 2', speaker_name: 'James Miller', timestamp_start_s: 312, timestamp_end_s: 325, source_title: 'The Intelligence', source_publisher: 'The Economist', entities: ['European Central Bank'], extracted_at: '2026-04-06T11:30:00Z' },
    { id: '3', text: 'NATO reported that Russian troop movements near the Ukrainian border have increased by 40% since last month.', type: 'factual', confidence: 0.78, verification_score: 0.45, status: 'unverified', speaker: 'Speaker 1', speaker_name: null, timestamp_start_s: 89, timestamp_end_s: 102, source_title: 'Global News Podcast', source_publisher: 'BBC World Service', entities: ['NATO', 'Russia', 'Ukraine'], extracted_at: '2026-04-06T10:00:00Z' },
    { id: '4', text: 'Climate scientists predict that 2027 will likely be the hottest year on record due to the strengthening El Niño pattern.', type: 'predictive', confidence: 0.68, verification_score: 0.55, status: 'unverified', speaker: 'Speaker 3', speaker_name: 'Dr. Maria Santos', timestamp_start_s: 456, timestamp_end_s: 470, source_title: 'Science Friday', source_publisher: 'WNYC', entities: ['El Niño'], extracted_at: '2026-04-06T09:00:00Z' },
    { id: '5', text: 'The semiconductor supply chain disruption caused a 15% increase in chip prices across the automotive industry.', type: 'causal', confidence: 0.81, verification_score: 0.65, status: 'verified', speaker: 'Speaker 1', speaker_name: 'Alex Wu', timestamp_start_s: 678, timestamp_end_s: 691, source_title: 'Hard Fork', source_publisher: 'The New York Times', entities: [], extracted_at: '2026-04-06T08:00:00Z' },
    { id: '6', text: 'The Federal Reserve has been raising rates too aggressively and it will lead to a recession by Q3.', type: 'opinion', confidence: 0.35, verification_score: 0, status: 'opinion', speaker: 'Speaker 2', speaker_name: 'Mark Davis', timestamp_start_s: 234, timestamp_end_s: 248, source_title: 'Odd Lots', source_publisher: 'Bloomberg', entities: ['Federal Reserve'], extracted_at: '2026-04-06T07:30:00Z' },
  ]

  const demoPodcasts = podcasts.length > 0 ? podcasts : [
    { name: 'NPR News Now', publisher: 'NPR', language: 'en', category: 'general_news', feed_url: '#' },
    { name: 'The Daily', publisher: 'The New York Times', language: 'en', category: 'general_news', feed_url: '#' },
    { name: 'Global News Podcast', publisher: 'BBC World Service', language: 'en', category: 'international', feed_url: '#' },
    { name: 'The Intelligence', publisher: 'The Economist', language: 'en', category: 'analysis', feed_url: '#' },
    { name: 'Hard Fork', publisher: 'The New York Times', language: 'en', category: 'technology', feed_url: '#' },
    { name: 'Planet Money', publisher: 'NPR', language: 'en', category: 'economics', feed_url: '#' },
    { name: 'The Lawfare Podcast', publisher: 'Lawfare', language: 'en', category: 'security', feed_url: '#' },
    { name: 'Science Friday', publisher: 'WNYC', language: 'en', category: 'science', feed_url: '#' },
  ]

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* ─── Hero ────────────────────────────────────────────────────── */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold text-white">Audio & Podcast Intelligence</h1>
            <span className="px-2 py-0.5 text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30 rounded-full">
              NEW
            </span>
          </div>
          <p className="text-gray-400 text-lg max-w-3xl">
            AI-powered claim extraction from news podcasts and audio sources.
            Every checkable claim is transcribed, classified, and cross-referenced
            against WorldPulse&apos;s intelligence network in real time.
          </p>
        </div>

        {/* ─── Stats Cards ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          {[
            { label: 'Monitored Podcasts', value: demoStats.monitored_podcasts, color: 'text-blue-400' },
            { label: 'Audio Hours', value: `${demoStats.total_duration_hours}h`, color: 'text-purple-400' },
            { label: 'Claims Extracted', value: demoStats.total_claims.toLocaleString(), color: 'text-emerald-400' },
            { label: 'Avg Confidence', value: `${Math.round(demoStats.avg_confidence * 100)}%`, color: 'text-amber-400' },
            { label: 'Avg Verification', value: `${Math.round(demoStats.avg_verification_score * 100)}%`, color: 'text-cyan-400' },
            { label: 'Languages', value: Object.keys(demoStats.languages).length, color: 'text-pink-400' },
          ].map((stat) => (
            <div key={stat.label} className="bg-[#12121a] border border-gray-800 rounded-xl p-4">
              <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
              <div className="text-xs text-gray-500 mt-1">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* ─── Claim Type Distribution ─────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
          {Object.entries(demoStats.claim_types).map(([type, count]) => (
            <div
              key={type}
              className={`rounded-lg border p-3 cursor-pointer transition-all ${
                typeFilter === type ? 'ring-2 ring-white/30' : ''
              } ${CLAIM_TYPE_COLORS[type] ?? 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}
              onClick={() => setTypeFilter(typeFilter === type ? '' : type)}
            >
              <div className="text-lg font-bold">{count.toLocaleString()}</div>
              <div className="text-xs opacity-80">{CLAIM_TYPE_LABELS[type] ?? type}</div>
            </div>
          ))}
        </div>

        {/* ─── Search & Filters ────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search claims by keyword, entity, or speaker..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-4 py-2.5 bg-[#12121a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2.5 bg-[#12121a] border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="">All Types</option>
            {Object.entries(CLAIM_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2.5 bg-[#12121a] border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="">All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        {/* ─── Claims List ─────────────────────────────────────────────── */}
        <div className="space-y-3 mb-10">
          {loading ? (
            <div className="text-center py-12 text-gray-500">Loading claims...</div>
          ) : demoClaims.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No claims found matching filters.</div>
          ) : (
            demoClaims.map((claim) => (
              <div
                key={claim.id}
                className={`bg-[#12121a] border rounded-xl p-4 cursor-pointer transition-all hover:border-gray-600 ${
                  selectedClaim?.id === claim.id ? 'border-blue-500/50 ring-1 ring-blue-500/30' : 'border-gray-800'
                }`}
                onClick={() => setSelectedClaim(selectedClaim?.id === claim.id ? null : claim)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-white leading-relaxed">&ldquo;{claim.text}&rdquo;</p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${CLAIM_TYPE_COLORS[claim.type] ?? ''}`}>
                        {CLAIM_TYPE_LABELS[claim.type] ?? claim.type}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[claim.status] ?? ''}`}>
                        {STATUS_LABELS[claim.status] ?? claim.status}
                      </span>
                      {claim.speaker_name && (
                        <span className="text-xs text-gray-400">
                          — {claim.speaker_name}
                        </span>
                      )}
                      <span className="text-xs text-gray-500">
                        @ {formatTimestamp(claim.timestamp_start_s)}
                      </span>
                      {claim.source_title && (
                        <span className="text-xs text-gray-500">
                          | {claim.source_title}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-mono">
                      <span className="text-gray-400">Conf: </span>
                      <span className={claim.confidence >= 0.7 ? 'text-green-400' : claim.confidence >= 0.5 ? 'text-yellow-400' : 'text-red-400'}>
                        {Math.round(claim.confidence * 100)}%
                      </span>
                    </div>
                    {claim.status !== 'opinion' && (
                      <div className="text-sm font-mono">
                        <span className="text-gray-400">Verif: </span>
                        <span className={claim.verification_score >= 0.7 ? 'text-green-400' : claim.verification_score >= 0.4 ? 'text-yellow-400' : 'text-red-400'}>
                          {Math.round(claim.verification_score * 100)}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Expanded claim detail */}
                {selectedClaim?.id === claim.id && (
                  <div className="mt-4 pt-4 border-t border-gray-700/50">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Source</h4>
                        <p className="text-sm text-gray-300">
                          {claim.source_title ?? 'Unknown'} — {claim.source_publisher ?? 'Unknown'}
                        </p>
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Timestamp</h4>
                        <p className="text-sm text-gray-300">
                          {formatTimestamp(claim.timestamp_start_s)} → {formatTimestamp(claim.timestamp_end_s)}
                        </p>
                      </div>
                      {claim.entities.length > 0 && (
                        <div className="sm:col-span-2">
                          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Entities</h4>
                          <div className="flex flex-wrap gap-1">
                            {claim.entities.map((entity, i) => (
                              <span key={i} className="text-xs px-2 py-0.5 bg-gray-700/50 text-gray-300 rounded">
                                {entity}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* ─── Monitored Podcasts ──────────────────────────────────────── */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white">Monitored News Podcasts</h2>
            <select
              value={podcastCategory}
              onChange={(e) => setPodcastCategory(e.target.value)}
              className="px-3 py-1.5 bg-[#12121a] border border-gray-700 rounded-lg text-gray-300 text-sm focus:outline-none"
            >
              <option value="">All Categories</option>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {demoPodcasts.map((podcast, i) => (
              <div key={i} className="bg-[#12121a] border border-gray-800 rounded-lg p-3">
                <div className="font-medium text-white text-sm">{podcast.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">{podcast.publisher}</div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs px-1.5 py-0.5 bg-gray-700/50 text-gray-400 rounded">
                    {CATEGORY_LABELS[podcast.category] ?? podcast.category}
                  </span>
                  <span className="text-xs text-gray-600">{podcast.language.toUpperCase()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ─── Status Breakdown ────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-10">
          <div className="bg-[#12121a] border border-gray-800 rounded-xl p-5">
            <h3 className="text-lg font-bold text-white mb-3">Verification Status</h3>
            <div className="space-y-2">
              {Object.entries(demoStats.claim_statuses).map(([status, count]) => {
                const total = Object.values(demoStats.claim_statuses).reduce((a, b) => a + b, 0)
                const pct = total > 0 ? Math.round((count / total) * 100) : 0
                return (
                  <div key={status} className="flex items-center gap-3">
                    <span className={`text-xs w-20 px-2 py-0.5 rounded-full text-center ${STATUS_COLORS[status] ?? ''}`}>
                      {STATUS_LABELS[status] ?? status}
                    </span>
                    <div className="flex-1 bg-gray-800 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${
                          status === 'verified' ? 'bg-green-500' :
                          status === 'disputed' ? 'bg-red-500' :
                          status === 'mixed' ? 'bg-orange-500' :
                          status === 'opinion' ? 'bg-gray-500' : 'bg-yellow-500'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-400 w-16 text-right">{count.toLocaleString()} ({pct}%)</span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="bg-[#12121a] border border-gray-800 rounded-xl p-5">
            <h3 className="text-lg font-bold text-white mb-3">How It Works</h3>
            <div className="space-y-3 text-sm text-gray-400">
              <div className="flex items-start gap-2">
                <span className="text-blue-400 font-bold">1.</span>
                <span>Audio from 20+ news podcasts is ingested via RSS feeds</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-purple-400 font-bold">2.</span>
                <span>Speech-to-text with speaker diarization (Whisper/Deepgram)</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-emerald-400 font-bold">3.</span>
                <span>NLP extracts checkable claims: factual, statistical, causal, predictive</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-amber-400 font-bold">4.</span>
                <span>Each claim is cross-referenced against WorldPulse signals + trusted sources</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-cyan-400 font-bold">5.</span>
                <span>Claims are scored for confidence and verification, with full speaker attribution</span>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Data Sources ────────────────────────────────────────────── */}
        <div className="bg-[#12121a] border border-gray-800 rounded-xl p-5 mb-8">
          <h3 className="text-lg font-bold text-white mb-2">Data Sources & Methodology</h3>
          <p className="text-sm text-gray-400 leading-relaxed">
            Audio content is sourced from {demoStats.monitored_podcasts} monitored news podcast feeds
            across {Object.keys(demoStats.languages).length} languages, including NPR, BBC World Service,
            The New York Times, The Economist, Al Jazeera, Bloomberg, and RFI. Transcription uses
            Whisper and Deepgram APIs with speaker diarization. Claim extraction employs pattern-based
            NLP tuned for spoken language (filler removal, sentence fragment handling). Verification
            cross-references against WorldPulse&apos;s signal database and trusted source network.
            Audio/podcast intelligence is updated in near-real-time as new episodes are published.
          </p>
        </div>

        {/* ─── Pro CTA ─────────────────────────────────────────────────── */}
        <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-xl p-6 text-center">
          <h3 className="text-xl font-bold text-white mb-2">WorldPulse Pro — Audio Intelligence API</h3>
          <p className="text-gray-400 max-w-2xl mx-auto mb-4">
            Access real-time podcast claim extraction, full transcript search, speaker analytics,
            and webhook notifications for disputed claims via the WorldPulse API.
          </p>
          <button className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors">
            Get API Access
          </button>
        </div>

      </div>
    </div>
  )
}
