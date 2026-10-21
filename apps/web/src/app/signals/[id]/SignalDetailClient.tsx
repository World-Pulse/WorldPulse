'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import type { Signal, Post, CrossCheckStatus } from '@worldpulse/types'
import type { SignalDetail } from './page'
import { DiscussionThread } from './DiscussionThread'
import { BriefingSignup } from '@/components/briefing/BriefingSignup'

const SignalMap = dynamic(
  () => import('./SignalMap').then(m => ({ default: m.SignalMap })),
  { ssr: false, loading: () => <div className="h-[200px] bg-wp-s2 rounded-xl animate-pulse" /> },
)
import { FlagModal } from '@/components/signals/FlagModal'
import { ReliabilityDots, scoreBand } from '@/components/signals/ReliabilityDots'
import { BiasCorrectionPanel } from '@/components/sources/BiasCorrectionPanel'
import { AISummary } from '@/components/signals/AISummary'
import { RiskScoreGauge } from '@/components/signals/RiskScoreGauge'
import { ConnectionWeb } from './ConnectionWeb'
import { CIBWarningBadge } from '@/components/signals/CIBWarningBadge'
import { VerificationTimeline } from '@/components/signals/VerificationTimeline'
import { VerificationBadge, buildVerificationSummary } from '@/components/signals/VerificationBadge'
import { ViralityBadge } from '@/components/signals/ViralityBadge'
import { RichMediaEmbed, extractFirstEmbedUrl } from '@/components/RichMediaEmbed'
import { SignalMedia } from '@/components/signals/SignalMedia'
import { SourceChain, distinctOutlets } from '@/components/signals/SourceChain'
import { StoryMembers } from './StoryMembers'
import { PredictionMarkets } from '@/components/signals/PredictionMarkets'
import { ShareMenu } from '@/components/signals/ShareMenu'
import { displaySummary, isStateMedia, STATE_MEDIA_NOTE, storyTags } from '@/lib/signal-text'
import { storyCountsOf, type StoryOutletCounts } from '@/lib/story-count'
import { howSure } from '@/lib/how-sure'
import { HowSureBlock } from '@/components/signals/HowSureBlock'
import { FollowStory } from '@/components/signals/FollowStory'
import { ReaderFlags } from '@/components/signals/ReaderFlags'
import { outletLine, type CountryStory } from '@/components/countries/CountryTopStories'

// ─── Constants ────────────────────────────────────────────────────────────────

const SEV_COLOR: Record<string, string> = {
  critical: '#ff3b5c',
  high:     '#f5a623',
  medium:   '#fbbf24',
  low:      '#8892a4',
  info:     '#5a6477',
}

const SEV_BG: Record<string, string> = {
  critical: 'rgba(255,59,92,0.12)',
  high:     'rgba(245,166,35,0.12)',
  medium:   'rgba(251,191,36,0.12)',
  low:      'rgba(136,146,164,0.12)',
  info:     'rgba(90,100,119,0.12)',
}

const CAT_ICON: Record<string, string> = {
  breaking:    '🚨', conflict: '⚔️', geopolitics: '🌐', climate: '🌡️',
  health:      '🏥', economy:  '📈', technology:  '💻', science: '🔬',
  elections:   '🗳️', culture:  '🎭', disaster:    '🌊', security: '🔒',
  sports:      '⚽', space:    '🚀', other:       '🌍',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(d: string | null | undefined): string {
  if (!d) return ''
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

// VerificationRow replaced by VerificationTimeline component (P2-4b)

// One other story, with its outlet count (lib/related-stories.ts). No time:
// the server's HTML and the browser's must match.
function RelatedCard({ story }: { story: CountryStory }) {
  const color = SEV_COLOR[story.severity] ?? '#8892a4'
  return (
    <Link
      href={`/signals/${story.leadId}`}
      className="block p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] transition-all group"
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="font-mono text-[9px] uppercase tracking-widest" style={{ color }}>{story.severity}</span>
        <span className={`font-mono text-[9px] ml-auto ${story.verifiedAt ? 'text-wp-green' : 'text-wp-text3'}`}>{outletLine(story)}</span>
      </div>
      <p className="text-[12px] text-wp-text2 group-hover:text-wp-text leading-[1.5] line-clamp-2 transition-colors">
        {story.title}
      </p>
    </Link>
  )
}

// Reliability sidebar widget — uses shared ReliabilityDots for consistent dot+tooltip rendering
function ReliabilityScore({ signal }: { signal: SignalDetail }) {
  const score = signal.reliabilityScore ?? 0
  const hasAI = signal.verifications.some(v => v.check_type.toLowerCase().includes('ai'))
  const band = scoreBand(score)
  const crossCheckStatus: CrossCheckStatus =
    signal.status === 'verified' ? 'confirmed' :
    signal.status === 'disputed' ? 'contested' : 'unconfirmed'

  return (
    <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] space-y-3">
      <div className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">Reliability</div>

      <div className="flex items-center justify-between">
        <ReliabilityDots
          score={score}
          size="md"
          placement="below"
          sourceCount={signal.sourceCount}
          crossCheckStatus={crossCheckStatus}
          aiVerified={hasAI}
          communityFlagCount={signal.communityFlagCount}
        />
        {/* coloured by its band (it was green whatever the number) */}
        <span className="font-mono text-[18px] font-bold" style={{ color: band.color }}>
          {Math.round(score * 100)}%
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-white/[0.07] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.round(score * 100)}%`, backgroundColor: band.color }}
        />
      </div>

      {/* The band in words, and where the score is explained (phones have no hover) */}
      <p className="font-mono text-[10px] text-wp-text3">
        <span style={{ color: band.color }}>{band.label}</span>
        {' · '}
        <Link href="/how-we-count#score" className="text-wp-amber hover:underline">How we score this</Link>
      </p>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[10px] text-wp-text3">
        <div>
          <div className="text-wp-text2">{signal.viewCount.toLocaleString()}</div>
          <div>views</div>
        </div>
        <div>
          <div className="text-wp-text2">{signal.postCount.toLocaleString()}</div>
          <div>posts</div>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  signal:       SignalDetail
  /** Other stories, one row each (lib/related-stories.ts) */
  related:      CountryStory[]
  initialPosts: Post[]
  postsTotal:   number
  /** Outlets that carried this report's story, from the server (null: the API couldn't say) */
  initialStoryCounts?: StoryOutletCounts | null
}

// ─── AI Slop Badge ────────────────────────────────────────────────────────────
function AISlopBadge({ signalId }: { signalId: string }) {
  const [isSlop, setIsSlop] = useState<boolean | null>(null)

  useEffect(() => {
    // Admin-only endpoint: it needs the signed-in user's token (cookies aren't used)
    let token: string | null = null
    try { token = localStorage.getItem('wp_access_token') } catch { /* storage blocked */ }
    if (!token) return
    const API_BASE = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/v1`
    fetch(`${API_BASE}/signals/${encodeURIComponent(signalId)}/slop-score`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then((data: { isSlop?: boolean } | null) => {
        if (data?.isSlop === true) setIsSlop(true)
      })
      .catch(() => { /* non-fatal */ })
  }, [signalId])

  if (!isSlop) return null

  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-mono"
      style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24' }}
      title="Heuristic analysis suggests this content may be AI-generated or from a low-quality content farm. Manual verification recommended."
    >
      <span>⚠</span>
      <span>AI-generated content suspected</span>
    </div>
  )
}

interface CIBStatus {
  detected: boolean
  confidence: number
  label: string
}

export function SignalDetailClient({ signal, related, initialPosts, postsTotal, initialStoryCounts = null }: Props) {
  const color      = SEV_COLOR[signal.severity] ?? '#8892a4'
  const bg         = SEV_BG[signal.severity]    ?? 'rgba(136,146,164,0.12)'
  const srcUrl     = signal.originalUrls?.[0] ?? null
  const [flagOpen, setFlagOpen] = useState(false)
  const [cibResult, setCibResult] = useState<CIBStatus | null>(null)

  useEffect(() => {
    const API_BASE = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/v1`
    fetch(`${API_BASE}/signals/${encodeURIComponent(signal.id)}/cib-check`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { success?: boolean; data?: CIBStatus } | null) => {
        if (data?.success && data.data && data.data.label !== 'CLEAN') {
          setCibResult(data.data)
        }
      })
      .catch(() => { /* non-fatal */ })
  }, [signal.id])
  let srcDomain: string | null = null
  try { srcDomain = srcUrl ? new URL(srcUrl).hostname.replace(/^www\./, '') : null } catch { /* noop */ }

  const ageMs       = Date.now() - new Date(signal.createdAt).getTime()
  const isBreaking  = signal.isBreaking === true && ageMs < 30 * 60_000
  const flagCount   = signal.communityFlagCount ?? 0
  const isContested = signal.status === 'disputed' || flagCount >= 3
  const summaryText = displaySummary(signal.summary, signal.title)
  const tags        = storyTags(signal.tags, `${signal.title} ${summaryText ?? ''}`)

  // One outlet number for the page (reading audit P9): the outlets that carried
  // this report's story, as the home page and the story timeline count them.
  // Until it's known (or if the API can't say), this report's own outlets.
  // The server asks first, so the page's first HTML (what search engines and
  // link previews read) has the story's count: it showed this report's own 9
  // outlets for a story of 87 (Oct 20, 2026), until the browser had asked.
  // The count covers the story's last two days; one that has run longer also
  // says how many have reported it since it began (lib/story-count.ts)
  const [storyCounts, setStoryCounts] = useState<StoryOutletCounts | null>(initialStoryCounts)
  const [storyAsked, setStoryAsked] = useState(initialStoryCounts !== null)
  useEffect(() => {
    if (initialStoryCounts !== null) return
    let cancelled = false
    const API_BASE = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/v1`
    fetch(`${API_BASE}/stories/outlets?ids=${encodeURIComponent(signal.id)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((json: { data?: { stories?: Record<string, unknown> } } | null) => {
        const counts = storyCountsOf(json?.data?.stories?.[signal.id])
        if (!cancelled && counts) setStoryCounts(counts)
      })
      .catch(() => { /* this report's own outlets stand in */ })
      .finally(() => { if (!cancelled) setStoryAsked(true) })
    return () => { cancelled = true }
  }, [signal.id, initialStoryCounts])
  const ownOutlets = distinctOutlets(signal.originalUrls ?? []).length
  const outletCount = storyCounts ? storyCounts.outlets : ownOutlets
  // since it began: this report's own outlets are among them, however old it is
  const outletsAll = Math.max(storyCounts?.outletsAll ?? 0, ownOutlets, outletCount)
  // What the count means (plan P2, step 1): the story is verified when any of its reports is
  const sure = howSure({
    verified: storyCounts?.verified === true || signal.status === 'verified',
    outlets: outletCount,
    outletsAll,
    firstReportAt: storyCounts?.firstReportAt,
  })

  return (
    <div className="min-h-screen bg-wp-bg text-wp-text">
      <div className="max-w-4xl mx-auto px-4 py-8">

        {/* Breadcrumb + share */}
        <div className="flex items-center justify-between gap-2 mb-6">
          {/* Links are 44px tall on phones (tap targets): their text is centred so it lines up with the slashes */}
          <nav className="flex items-center gap-2 font-mono text-[11px] text-wp-text3 min-w-0 flex-1" aria-label="Breadcrumb">
            <Link href="/" className="inline-flex items-center hover:text-wp-text transition-colors flex-shrink-0">Home</Link>
            <span className="flex-shrink-0">/</span>
            <Link href="/map" className="inline-flex items-center hover:text-wp-text transition-colors flex-shrink-0">Map</Link>
            <span className="flex-shrink-0">/</span>
            <span className="text-wp-text2 truncate max-w-[120px] sm:max-w-[200px]">{signal.title}</span>
          </nav>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setFlagOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-full border border-white/10 font-mono text-[10px] text-wp-text3 hover:border-wp-red/40 hover:text-wp-red transition-all min-h-[44px]"
              aria-label="Flag this signal"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
              </svg>
              Flag
            </button>
            <ShareMenu title={signal.title} embedId={signal.id} />
          </div>
        </div>
        {flagOpen && <FlagModal signalId={signal.id} onClose={() => setFlagOpen(false)} />}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">

          {/* ── Main content ── */}
          <div className="space-y-5">

            {/* Header badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-semibold uppercase tracking-wider"
                style={{ background: bg, color, border: `1px solid ${color}40` }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />
                {signal.severity}
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-white/10 text-[11px] font-mono text-wp-text2">
                <span aria-hidden="true">{CAT_ICON[signal.category] ?? ''}</span>{' '}
                {signal.category}
              </span>
              {/* Verification badge — derived from verification_log */}
              {(() => {
                const summary = buildVerificationSummary(signal.verifications, signal.status)
                return (
                  <VerificationBadge
                    status={summary.status}
                    summary={{ confirmed_checks: summary.confirmed_checks, total_checks: summary.total_checks }}
                    size="md"
                  />
                )
              })()}
              {/* Virality badge — surfaces corroboration velocity */}
              {signal.sourceCount >= 3 && (
                <ViralityBadge
                  sourceCount={signal.sourceCount}
                  lastCorroboratedAt={signal.lastCorroboratedAt}
                  lastUpdated={signal.lastUpdated}
                  size="md"
                  showCount
                />
              )}
              {isBreaking && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-wp-red text-white text-[11px] font-mono font-semibold animate-flash-tag">
                  BREAKING
                </span>
              )}
              {isContested && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-wp-amber/40 bg-wp-amber/10 text-[11px] font-mono text-wp-amber">
                  CONTESTED
                </span>
              )}
            </div>

            {/* Title */}
            <h1 className="text-[22px] lg:text-[26px] font-bold leading-[1.3] text-wp-text">
              {signal.title}
            </h1>

            {/* Meta row */}
            <div className="flex items-center gap-3 font-mono text-[11px] text-wp-text3 flex-wrap">
              {signal.locationName && (
                <>
                  <span>📍 {signal.locationName}{signal.countryCode ? `, ${signal.countryCode}` : ''}</span>
                  <span>·</span>
                </>
              )}
              <span>🕐 {timeAgo(signal.firstReported)}</span>
              {storyAsked && outletCount > 0 && (
                <>
                  <span>·</span>
                  <span>{outletCount} outlet{outletCount !== 1 ? 's' : ''}</span>
                </>
              )}
            </div>

            {/* Follow the story, and what changed since the last visit (plan 8) */}
            <FollowStory signalId={signal.id} />

            {/* How many readers flagged this report, and why (plan C5) */}
            <ReaderFlags signalId={signal.id} count={flagCount} />

            {/* Summary (without the outlet note RSS used to add, and not a repeat of the headline) */}
            {summaryText && (
              <p
                className="text-[15px] text-wp-text2 leading-[1.7] border-l-2 pl-4"
                style={{ borderColor: `${color}66` }}
              >
                {summaryText}
              </p>
            )}
            {isStateMedia(signal.tags) && (
              <p className="font-mono text-[11px] text-wp-amber">⚠ {STATE_MEDIA_NOTE}</p>
            )}

            {/* How sure are we: the story's count and what it means (P2, step 1) */}
            {storyAsked && outletCount > 0 && <HowSureBlock sure={sure} />}

            {/* Body */}
            {signal.body && (
              <div className="prose prose-invert prose-sm max-w-none text-wp-text2">
                <p className="text-[14px] leading-[1.8]">{signal.body}</p>
              </div>
            )}

            {/* Multimedia — YouTube + podcast enrichment (closes Ground News v4.27 'Podcasts & Opinions' gap) */}
            <SignalMedia items={(signal as Signal).media ?? []} />

            {/* Prediction Markets — Polymarket odds for geopolitical signals (counters WorldMonitor prediction feature) */}
            <PredictionMarkets
              signalId={signal.id}
              category={signal.category}
              title={signal.title}
            />

            {/* TV clips and news images left the page Oct 12, 2026 (plan 0p): GDELT's TV
                API returns nothing without a station, and its image search allows one
                request per 5 s for the whole server, so both always came back empty. Each
                showed a grey placeholder on the first screen for ~5 s, then vanished and
                the page jumped, and every visit spent GDELT requests the scraper needs. */}

            {/* Source chain — all sources with trust scores and article links */}
            <SourceChain
              sources={signal.sources}
              sourceUrl={signal.originalUrls?.[0] ?? null}
              originalUrls={signal.originalUrls ?? []}
              storyOutlets={storyCounts ? outletsAll : null}
            />

            {/* Also reported by — the other reports of this story (plan 12c) */}
            <StoryMembers signalId={signal.id} />

            {/* AI Summary — WorldPulse differentiator vs Ground News Ground Summary */}
            <AISummary
              signalId={signal.id}
              aiSummary={(signal as Signal).aiSummary}
            />

            {/* AI Slop Badge — admin-only heuristic warning for AI-generated content */}
            <AISlopBadge signalId={signal.id} />

            {/* CIB Warning Badge — coordinated narrative detection */}
            {cibResult && <CIBWarningBadge cibStatus={cibResult} />}

            {/* Tags: only those the story's own words use. The rest describe the feed
                (#rss, #fr, #france24) or repeat the badges (#disaster, #critical), and put
                #france #europe on a boat wreck off Djibouti. */}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map(tag => (
                  <Link
                    key={tag}
                    href={`/search?q=${encodeURIComponent(tag)}&type=tags`}
                    className="px-2.5 py-1 rounded-full border border-white/10 font-mono text-[10px] text-wp-text3 hover:border-white/20 hover:text-wp-text2 transition-all"
                  >
                    #{tag}
                  </Link>
                ))}
              </div>
            )}

            {/* Map */}
            {signal.location && (
              <div>
                <div className="font-mono text-[10px] tracking-widest uppercase text-wp-text3 mb-2">Location</div>
                <SignalMap
                  lat={signal.location.lat}
                  lng={signal.location.lng}
                  title={signal.title}
                  severity={signal.severity}
                />
              </div>
            )}

            {/* Verification Log Timeline (P2-4b) — scrollable on mobile if content overflows */}
            <div className="overflow-x-auto">
              <VerificationTimeline verifications={signal.verifications} />
            </div>

            {/* "Event timeline" left the page Oct 12, 2026: it listed the signal's
                correlation cluster, which joins anything that arrived in the same hour in
                "linked" categories (a Djibouti boat wreck with a Brussels climate march and
                the economics Nobel), and every row read "Invalid Date". The story timeline
                above (StoryMembers) shows how the story developed, from its own reports. */}

            {/* Source Media — embedded player + source link */}
            {(srcUrl || (signal.media_urls?.length ?? 0) > 0) && (() => {
              const embeddable = srcUrl ? extractFirstEmbedUrl(srcUrl) : null
              const mediaUrls  = signal.media_urls ?? []

              return (
                <div>
                  <div className="font-mono text-[10px] tracking-widest uppercase text-wp-text3 mb-3">
                    Source Media
                  </div>

                  {/* Embeddable source URL player */}
                  {embeddable && (
                    <RichMediaEmbed url={embeddable} className="mb-3" />
                  )}

                  {/* Additional media_urls embeds */}
                  {mediaUrls.length > 0 && (
                    <div className="space-y-3 mb-3">
                      {mediaUrls.map((url, i) => (
                        <RichMediaEmbed key={i} url={url} />
                      ))}
                    </div>
                  )}

                  {/* Source link — prominent button if no embed, subdued attribution if embedded */}
                  {srcUrl && (
                    embeddable ? (
                      <a
                        href={srcUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 font-mono text-[11px] text-wp-text3 hover:text-wp-text transition-colors"
                      >
                        {srcDomain ?? srcUrl}
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                          <path d="M2 10L10 2M10 2H5M10 2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </a>
                    ) : (
                      <a
                        href={srcUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all"
                        style={{ background: bg, color, border: `1px solid ${color}40` }}
                      >
                        View original source →
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 10L10 2M10 2H5M10 2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </a>
                    )
                  )}
                </div>
              )
            })()}

            {/* The 7 AM email briefing (plan G4; shows once email can be sent) */}
            <BriefingSignup source="/signals" compact />

            {/* Discussion thread */}
            <div className="pt-2">
              <DiscussionThread
                initialPosts={initialPosts}
                signalId={signal.id}
                totalCount={postsTotal}
              />
            </div>
          </div>

          {/* ── Sidebar ── */}
          <div className="space-y-4 lg:sticky lg:top-20 self-start">

            {/* Reliability score with tooltip */}
            <ReliabilityScore signal={signal} />

            {/* Geopolitical risk score gauge */}
            {(signal as unknown as { riskScore?: { score: number; level: string; label: string } }).riskScore && (() => {
              const rs = (signal as unknown as { riskScore: { score: number; level: string; label: string } }).riskScore
              return (
                <RiskScoreGauge score={rs.score} level={rs.level} label={rs.label} size="md" />
              )
            })()}

            {/* Intelligence Web — recent stories naming the same people, places and organisations */}
            <ConnectionWeb signalId={signal.id} />

            {/* (The "Related signals" panel read the same correlation cluster as the old
                event timeline, so it went with it.) */}

            {/* Sources list with trust scores */}
            {signal.sources.length > 0 && (
              <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] space-y-3">
                <div className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">
                  Source chain
                </div>
                <div className="space-y-3">
                  {signal.sources.map(src => (
                    <div key={src.id}>
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-[12px] text-wp-text2 hover:text-wp-text transition-colors group mb-1"
                      >
                        <span className="font-mono text-[9px] uppercase text-wp-text3 border border-white/10 rounded px-1 shrink-0">
                          {src.tier}
                        </span>
                        <span className="truncate group-hover:underline">{src.name}</span>
                        <span className="font-mono text-[10px] text-wp-text3 shrink-0 ml-auto">
                          {Math.round(src.trustScore * 100)}%
                        </span>
                      </a>
                      {/* Trust score bar */}
                      <div className="h-0.5 bg-white/[0.06] rounded-full overflow-hidden ml-[calc(theme(spacing.6)+theme(spacing.2))]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.round(src.trustScore * 100)}%`,
                            background: src.trustScore >= 0.8
                              ? '#00e676'
                              : src.trustScore >= 0.5
                                ? '#f5a623'
                                : '#ff3b5c',
                          }}
                        />
                      </div>
                      {src.activeAt && (
                        <div className="font-mono text-[9px] text-wp-text3 mt-0.5 ml-[calc(theme(spacing.6)+theme(spacing.2))]">
                          {timeAgo(src.activeAt)}
                        </div>
                      )}
                      {src.articleUrl && (
                        <a
                          href={src.articleUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 mt-1.5 ml-[calc(theme(spacing.6)+theme(spacing.2))] px-2 py-0.5 rounded-full text-[10px] font-mono font-medium transition-colors"
                          style={{ background: 'rgba(0,210,210,0.1)', color: '#00d2d2', border: '1px solid rgba(0,210,210,0.25)' }}
                        >
                          View original article →
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Community bias corrections — shown when signal has at least one source */}
            {signal.sources.length > 0 && signal.sources[0] != null && (
              <BiasCorrectionPanel
                sourceId={signal.sources[0].id}
                currentBiasLabel={null}
              />
            )}

            {/* Related signals */}
            {related.length > 0 && (
              <div className="space-y-2">
                <div className="font-mono text-[10px] tracking-widest uppercase text-wp-text3 px-1">Related</div>
                {related.map(s => <RelatedCard key={s.id} story={s} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
