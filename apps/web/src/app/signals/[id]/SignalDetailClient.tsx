'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import type { Signal, Post, CrossCheckStatus } from '@worldpulse/types'
import type { SignalDetail, Verification } from './page'
import { DiscussionThread } from './DiscussionThread'

const SignalMap = dynamic(
  () => import('./SignalMap').then(m => ({ default: m.SignalMap })),
  { ssr: false, loading: () => <div className="h-[200px] bg-wp-s2 rounded-xl animate-pulse" /> },
)
import { FlagModal } from '@/components/signals/FlagModal'
import { ReliabilityDots } from '@/components/signals/ReliabilityDots'
import { AISummary } from '@/components/signals/AISummary'
import { RiskScoreGauge } from '@/components/signals/RiskScoreGauge'
import { RelatedSignals } from './RelatedSignals'

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

function VerificationRow({ v }: { v: Verification }) {
  const color = v.result === 'confirmed' ? '#00e676' : v.result === 'refuted' ? '#ff3b5c' : '#f5a623'
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-white/5 last:border-0">
      <div className="w-1.5 h-1.5 rounded-full mt-[5px] flex-shrink-0" style={{ background: color }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mono text-[10px] tracking-widest uppercase" style={{ color }}>{v.result}</span>
          <span className="font-mono text-[10px] text-wp-text3">·</span>
          <span className="font-mono text-[10px] text-wp-text3 capitalize">{v.check_type.replace(/_/g, ' ')}</span>
          <span className="font-mono text-[10px] text-wp-text3 ml-auto">{Math.round(v.confidence * 100)}%</span>
        </div>
        {v.notes && (
          <p className="text-[12px] text-wp-text2 leading-[1.5]">{v.notes}</p>
        )}
        <span className="font-mono text-[10px] text-wp-text3">{timeAgo(v.created_at)}</span>
      </div>
    </div>
  )
}

function RelatedCard({ signal }: { signal: Signal }) {
  const color = SEV_COLOR[signal.severity] ?? '#8892a4'
  return (
    <Link
      href={`/signals/${signal.id}`}
      className="block p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] transition-all group"
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="font-mono text-[9px] uppercase tracking-widest" style={{ color }}>{signal.severity}</span>
        <span className="font-mono text-[9px] text-wp-text3 ml-auto">{timeAgo(signal.firstReported)}</span>
      </div>
      <p className="text-[12px] text-wp-text2 group-hover:text-wp-text leading-[1.5] line-clamp-2 transition-colors">
        {signal.title}
      </p>
    </Link>
  )
}

// Reliability sidebar widget — uses shared ReliabilityDots for consistent dot+tooltip rendering
function ReliabilityScore({ signal }: { signal: SignalDetail }) {
  const score = signal.reliabilityScore ?? 0
  const hasAI = signal.verifications.some(v => v.check_type.toLowerCase().includes('ai'))
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
          sourceCount={signal.sourceCount}
          crossCheckStatus={crossCheckStatus}
          aiVerified={hasAI}
          communityFlagCount={signal.communityFlagCount}
        />
        <span className="font-mono text-[18px] font-bold text-wp-green">
          {Math.round(score * 100)}%
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-white/[0.07] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#00e676] to-[#00c853] transition-all"
          style={{ width: `${Math.round(score * 100)}%` }}
        />
      </div>

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

// Share button — copies current URL to clipboard
function ShareButton() {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback: select a hidden input
      const input = document.createElement('input')
      input.value = window.location.href
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-white/10 font-mono text-[10px] text-wp-text3 hover:border-white/20 hover:text-wp-text2 transition-all"
      aria-label="Copy link to this signal"
    >
      {copied ? (
        <>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#00e676" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span style={{ color: '#00e676' }}>Copied</span>
        </>
      ) : (
        <>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          Share
        </>
      )}
    </button>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  signal:       SignalDetail
  related:      Signal[]
  initialPosts: Post[]
  postsTotal:   number
}

// ─── AI Slop Badge ────────────────────────────────────────────────────────────
function AISlopBadge({ signalId }: { signalId: string }) {
  const [isSlop, setIsSlop] = useState<boolean | null>(null)

  useEffect(() => {
    const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1'
    fetch(`${API_BASE}/signals/${encodeURIComponent(signalId)}/slop-score`, {
      credentials: 'include',
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

export function SignalDetailClient({ signal, related, initialPosts, postsTotal }: Props) {
  const color      = SEV_COLOR[signal.severity] ?? '#8892a4'
  const bg         = SEV_BG[signal.severity]    ?? 'rgba(136,146,164,0.12)'
  const srcUrl     = signal.originalUrls?.[0] ?? null
  const [flagOpen, setFlagOpen] = useState(false)
  let srcDomain: string | null = null
  try { srcDomain = srcUrl ? new URL(srcUrl).hostname.replace(/^www\./, '') : null } catch { /* noop */ }

  const ageMs       = Date.now() - new Date(signal.createdAt).getTime()
  const isBreaking  = signal.isBreaking === true && ageMs < 30 * 60_000
  const flagCount   = signal.communityFlagCount ?? 0
  const isContested = signal.status === 'disputed' || flagCount >= 3

  return (
    <div className="min-h-screen bg-wp-bg text-wp-text">
      <div className="max-w-4xl mx-auto px-4 py-8">

        {/* Breadcrumb + share */}
        <div className="flex items-center justify-between mb-6">
          <nav className="flex items-center gap-2 font-mono text-[11px] text-wp-text3" aria-label="Breadcrumb">
            <Link href="/" className="hover:text-wp-text transition-colors">Home</Link>
            <span>/</span>
            <Link href="/map" className="hover:text-wp-text transition-colors">Map</Link>
            <span>/</span>
            <span className="text-wp-text2 truncate max-w-[200px]">{signal.title}</span>
          </nav>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFlagOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-white/10 font-mono text-[10px] text-wp-text3 hover:border-wp-red/40 hover:text-wp-red transition-all"
              aria-label="Flag this signal"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
              </svg>
              Flag
            </button>
            <ShareButton />
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
              {signal.status === 'verified' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-wp-green/30 bg-wp-green/10 text-[11px] font-mono text-wp-green">
                  ✓ Verified
                </span>
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
              {signal.sourceCount > 0 && (
                <>
                  <span>·</span>
                  <span>{signal.sourceCount} source{signal.sourceCount !== 1 ? 's' : ''}</span>
                </>
              )}
            </div>

            {/* Summary */}
            {signal.summary && (
              <p
                className="text-[15px] text-wp-text2 leading-[1.7] border-l-2 pl-4"
                style={{ borderColor: `${color}66` }}
              >
                {signal.summary}
              </p>
            )}

            {/* Body */}
            {signal.body && (
              <div className="prose prose-invert prose-sm max-w-none text-wp-text2">
                <p className="text-[14px] leading-[1.8]">{signal.body}</p>
              </div>
            )}

            {/* AI Summary — WorldPulse differentiator vs Ground News Ground Summary */}
            <AISummary
              signalId={signal.id}
              aiSummary={(signal as Signal).aiSummary}
            />

            {/* AI Slop Badge — admin-only heuristic warning for AI-generated content */}
            <AISlopBadge signalId={signal.id} />

            {/* Tags */}
            {signal.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {signal.tags.map(tag => (
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

            {/* Verifications */}
            {signal.verifications.length > 0 && (
              <div>
                <div className="font-mono text-[10px] tracking-widest uppercase text-wp-text3 mb-3">
                  Verification checks ({signal.verifications.length})
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] divide-y divide-white/5 px-4">
                  {signal.verifications.map((v, i) => (
                    <VerificationRow key={i} v={v} />
                  ))}
                </div>
              </div>
            )}

            {/* Source link */}
            {srcUrl && (
              <a
                href={srcUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all"
                style={{ background: bg, color, border: `1px solid ${color}40` }}
              >
                Source: {srcDomain ?? srcUrl}
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 10L10 2M10 2H5M10 2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </a>
            )}

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

            {/* Related signals from event cluster */}
            <RelatedSignals signalId={signal.id} />

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
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Related signals */}
            {related.length > 0 && (
              <div className="space-y-2">
                <div className="font-mono text-[10px] tracking-widest uppercase text-wp-text3 px-1">Related</div>
                {related.map(s => <RelatedCard key={s.id} signal={s} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
