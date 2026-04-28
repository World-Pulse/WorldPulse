'use client'

import type { Verification } from '@/app/signals/[id]/page'

// ─── Exported mapping helpers (also used in tests) ────────────────────────────

export const RESULT_COLOR: Record<string, string> = {
  confirmed:  '#00e676',
  pass:       '#00e676',
  verified:   '#00e676',
  refuted:    '#ff3b5c',
  fail:       '#ff3b5c',
  failed:     '#ff3b5c',
  unverified: '#f5a623',
  warn:       '#f5a623',
  warning:    '#f5a623',
  pending:    '#f5a623',
}

export const CHECK_TYPE_ICON: Record<string, string> = {
  ai_analysis:          '🤖',
  ai_check:             '🤖',
  ai_summary:           '🤖',
  source_check:         '🔍',
  source_verification:  '🔍',
  cross_reference:      '🔗',
  cross_check:          '🔗',
  corroboration:        '🔗',
  human_review:         '👤',
  editorial_review:     '👤',
  geo_verify:           '📍',
  geolocation:          '📍',
  location_check:       '📍',
}

export function getResultColor(result: string): string {
  return RESULT_COLOR[result.toLowerCase()] ?? '#8892a4'
}

export function getCheckTypeIcon(checkType: string): string {
  return CHECK_TYPE_ICON[checkType.toLowerCase()] ?? '✓'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(d: string | null | undefined): string {
  if (!d) return ''
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

function ResultBadge({ result }: { result: string }) {
  const color = getResultColor(result)
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full font-mono text-[9px] uppercase tracking-wider"
      style={{
        color,
        background: `${color}18`,
        border: `1px solid ${color}40`,
      }}
    >
      {result}
    </span>
  )
}

// ─── Aggregate score bar ──────────────────────────────────────────────────────

function AggregateScoreBar({ verifications }: { verifications: Verification[] }) {
  if (verifications.length === 0) return null

  // Weighted average of confidence scores, penalising refuted results
  const total = verifications.reduce((sum, v) => {
    const c = Math.max(0, Math.min(1, v.confidence))
    const result = v.result.toLowerCase()
    if (RESULT_COLOR[result] === RESULT_COLOR['refuted']) return sum - c * 0.5
    return sum + c
  }, 0)
  const score = Math.max(0, Math.min(1, total / verifications.length))
  const pct   = Math.round(score * 100)
  const color = score >= 0.7 ? '#00e676' : score >= 0.4 ? '#f5a623' : '#ff3b5c'

  return (
    <div className="mb-4 p-3 rounded-lg border border-white/[0.07] bg-white/[0.02]">
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-mono text-[10px] text-wp-text3 uppercase tracking-wider">
          Aggregate reliability
        </span>
        <span className="font-mono text-[13px] font-bold" style={{ color }}>
          {pct}%
        </span>
      </div>
      <div className="h-1.5 bg-white/[0.07] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <p className="font-mono text-[9px] text-wp-text3 mt-1">
        Based on {verifications.length} check{verifications.length !== 1 ? 's' : ''}
      </p>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  verifications: Verification[]
}

export function VerificationTimeline({ verifications }: Props) {
  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">
          Verification Log
        </span>
        {verifications.length > 0 && (
          <span
            className="inline-flex items-center justify-center w-4 h-4 rounded-full font-mono text-[9px]"
            style={{ background: 'rgba(0,230,118,0.12)', color: '#00e676', border: '1px solid rgba(0,230,118,0.25)' }}
          >
            {verifications.length}
          </span>
        )}
      </div>

      {/* Aggregate score bar */}
      <AggregateScoreBar verifications={verifications} />

      {/* Empty state */}
      {verifications.length === 0 && (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-6 flex flex-col items-center gap-2 text-center">
          <span className="text-[20px]" aria-hidden="true">🔍</span>
          <p className="font-mono text-[11px] text-wp-text3">No verification data yet</p>
          <p className="font-mono text-[10px] text-wp-text3/60">
            Checks run automatically as new sources are ingested.
          </p>
        </div>
      )}

      {/* Timeline panel */}
      {verifications.length > 0 && (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
          <div className="relative">
            {/* Vertical connector line */}
            {verifications.length > 1 && (
              <div
                className="absolute left-[5px] top-[8px] w-[2px] rounded-full"
                style={{
                  height: `calc(100% - 20px)`,
                  background: 'rgba(255,255,255,0.06)',
                }}
                aria-hidden="true"
              />
            )}

            <div className="space-y-0">
              {verifications.map((v, i) => {
                const color = getResultColor(v.result)
                const icon  = getCheckTypeIcon(v.check_type)
                const label = v.check_type.replace(/_/g, ' ')

                return (
                  <div key={i} className="relative flex gap-4 py-3 last:pb-0 first:pt-0">
                    {/* Timeline dot */}
                    <div className="flex-shrink-0 flex flex-col items-center pt-[3px]">
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0 ring-2 ring-wp-bg"
                        style={{ background: color }}
                        aria-hidden="true"
                      />
                    </div>

                    {/* Entry content */}
                    <div className="min-w-0 flex-1 pb-3 last:pb-0 border-b border-white/[0.04] last:border-0">
                      {/* Top row: icon + label + result badge + confidence */}
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-[12px]" aria-hidden="true">{icon}</span>
                        <span className="font-mono text-[10px] text-wp-text2 capitalize">{label}</span>
                        <ResultBadge result={v.result} />
                        <span
                          className="font-mono text-[10px] ml-auto flex-shrink-0"
                          style={{ color }}
                          title={`${Math.round(v.confidence * 100)}% confidence`}
                        >
                          {Math.round(v.confidence * 100)}%
                        </span>
                      </div>

                      {/* Confidence bar */}
                      <div className="h-0.5 bg-white/[0.06] rounded-full overflow-hidden mb-1">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.round(v.confidence * 100)}%`, background: color }}
                        />
                      </div>

                      {/* Notes */}
                      {v.notes && (
                        <p className="text-[12px] text-wp-text2 leading-[1.5] mb-1">
                          {v.notes}
                        </p>
                      )}

                      {/* Timestamp */}
                      <span className="font-mono text-[10px] text-wp-text3">
                        {timeAgo(v.created_at)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="mt-3 pt-3 border-t border-white/[0.04] flex justify-end">
            <span className="font-mono text-[9px] text-wp-text3/50">
              Powered by WorldPulse Verification Engine
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
