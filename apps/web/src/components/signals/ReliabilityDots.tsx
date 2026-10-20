'use client'

import type { CrossCheckStatus } from '@worldpulse/types'

interface ReliabilityDotsProps {
  /** Raw reliability score 0.0 – 1.0 */
  score: number
  sourceCount?: number
  crossCheckStatus?: CrossCheckStatus
  aiVerified?: boolean | null
  communityFlagCount?: number
  /** Show "Reliability" label to the left */
  label?: boolean
  /** Classes for the "Reliability" word (e.g. hide it on phones, where the row is tight) */
  labelClassName?: string
  /** Dot size variant */
  size?: 'sm' | 'md'
  /** Where the explainer opens: above the dots (default) or below them, near the top of a page */
  placement?: 'above' | 'below'
}

// ── Score bands (5-dot system) ────────────────────────────────────────────────
// What the score is, as the scraper computes it (checked Oct 20, 2026, H-0025:
// apps/scraper/src/pipeline/reliability-score.ts and correlate.ts). The bands
// said "Fully Verified: multi-source confirmed, AI-verified, cross-checked"
// for any score of 80% or more, so one report from a highly rated outlet read
// as fully verified; and the factors named AI checks and reader flags, which
// don't move the score. Verified is a separate rule (two or more independent
// outlets and at least 65%).
export const SCORE_TIERS = [
  {
    dots: 5,
    range: '80–100%',
    label: 'Very high',
    color: '#00e676',
    desc: 'A highly rated outlet, or several independent outlets',
  },
  {
    dots: 4,
    range: '60–79%',
    label: 'High',
    color: '#00c85a',
    desc: 'One well-rated outlet so far',
  },
  {
    dots: 3,
    range: '40–59%',
    label: 'Moderate',
    color: '#f5a623',
    desc: 'A lower-rated or state-run outlet, or one report of something serious',
  },
  {
    dots: 2,
    range: '20–39%',
    label: 'Low',
    color: '#fbbf24',
    desc: 'A low-rated outlet on a serious or sensitive story',
  },
  {
    dots: 1,
    range: '0–19%',
    label: 'Very low',
    color: '#ff3b5c',
    desc: 'Treat it as unconfirmed',
  },
] as const

// ── What moves the score ──────────────────────────────────────────────────────
export const SCORE_FACTORS = [
  { icon: '◎', label: 'Outlet rating', desc: 'The outlet’s rating in WorldPulse’s list of sources starts the score' },
  { icon: '⇄', label: 'Independent outlets', desc: 'Each further outlet that reports the story closes 40% of the gap to 98%' },
  { icon: '±', label: 'Report details', desc: 'A few points either way: a summary and a place add a little; state-run outlets on conflict, politics or security, and single reports marked high or critical, lose some; a little random spread keeps reports from tying' },
] as const

/** The band a score (0–1) falls in */
export function scoreBand(score: number): (typeof SCORE_TIERS)[number] {
  const pct = Math.round(Math.max(0, Math.min(1, Number(score) || 0)) * 100)
  return SCORE_TIERS.find(t => pct >= parseInt(t.range)) ?? SCORE_TIERS[4]
}

/** Under the factors: what isn't in the score, and what verified means */
export const SCORE_NOTE = 'Not in the score: AI checks and reader flags. Verified is separate: two or more independent outlets and a score of at least 65%.'

/** The status row's words */
const STATUS_WORD: Record<string, string> = { confirmed: 'verified', contested: 'disputed', unconfirmed: 'not yet verified' }

export function ReliabilityDots({
  score,
  sourceCount,
  crossCheckStatus,
  aiVerified,
  communityFlagCount,
  label = false,
  labelClassName,
  size = 'sm',
  placement = 'above',
}: ReliabilityDotsProps) {
  const s5      = Math.max(0, Math.min(5, score * 5))
  const filled  = Math.floor(s5)
  const partial = s5 % 1 >= 0.5 ? 1 : 0
  const empty   = 5 - filled - partial

  /** Percentage representation (0–100) used in tooltip */
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100)

  const dotClass = size === 'md'
    ? 'w-[7px] h-[7px] rounded-full'
    : 'w-[5px] h-[5px] rounded-full'

  const crossColor =
    crossCheckStatus === 'confirmed'   ? '#00e676' :
    crossCheckStatus === 'contested'   ? '#ff3b5c' :
    crossCheckStatus === 'unconfirmed' ? '#f5a623' :
    '#8892a4'

  /** Score-bar and percentage colour: green ≥80 · amber ≥60 · yellow ≥40 · red <40 */
  const scoreColor =
    pct >= 80 ? '#00e676' :
    pct >= 60 ? '#f5a623' :
    pct >= 40 ? '#fbbf24' :
    '#ff3b5c'

  /** Active tier for this signal's current score */
  const activeTier = scoreBand(score)

  return (
    <div className="relative group/rdots inline-flex items-center gap-1 font-mono text-[10px] text-wp-text3">
      {label && <span className={labelClassName}>Reliability</span>}
      <div className="flex gap-[2px]">
        {Array(filled).fill(0).map((_, i) => (
          <div key={`f${i}`} className={`${dotClass} bg-wp-green`} />
        ))}
        {Array(partial).fill(0).map((_, i) => (
          <div key={`p${i}`} className={`${dotClass} bg-wp-amber`} />
        ))}
        {Array(empty).fill(0).map((_, i) => (
          <div key={`e${i}`} className={`${dotClass} bg-wp-s3`} />
        ))}
      </div>

      {/* Tooltip — shown on hover */}
      <div
        className={`absolute ${placement === 'below' ? 'top-full mt-2' : 'bottom-full mb-2'} right-0 z-50 w-[260px] rounded-xl border border-white/[0.10] bg-[#0d1117] shadow-xl pointer-events-none opacity-0 group-hover/rdots:opacity-100 transition-opacity duration-150 overflow-hidden`}
        role="tooltip"
        aria-label={`Reliability score: ${pct}% — ${activeTier.label}`}
      >
        {/* ── Header: label + percentage + tier badge ── */}
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[9px] tracking-widest uppercase text-wp-text3">
              Reliability Score
            </span>
            <span className="font-mono text-[10px]" style={{ color: activeTier.color }}>
              {activeTier.label}
            </span>
          </div>
          <span className="font-mono text-[16px] font-bold leading-none" style={{ color: scoreColor }}>
            {pct}%
          </span>
        </div>

        {/* ── Score bar ── */}
        <div className="w-full h-[3px] bg-wp-s3 mx-0 mb-3">
          <div
            className="h-full"
            style={{ width: `${pct}%`, backgroundColor: scoreColor }}
          />
        </div>

        {/* ── Signal-specific breakdown (if data available) ── */}
        {(sourceCount != null || crossCheckStatus != null || aiVerified != null || communityFlagCount != null) && (
          <div className="px-3 pb-2 space-y-1.5 text-[11px] border-b border-white/[0.06]">
            {sourceCount != null && (
              <div className="flex items-center justify-between">
                <span className="text-wp-text3">Independent outlets</span>
                <span className="font-mono text-wp-text2">{sourceCount}</span>
              </div>
            )}
            {crossCheckStatus != null && (
              <div className="flex items-center justify-between">
                <span className="text-wp-text3">Status</span>
                <span className="font-mono" style={{ color: crossColor }}>
                  {STATUS_WORD[crossCheckStatus] ?? crossCheckStatus}
                </span>
              </div>
            )}
            {aiVerified != null && (
              <div className="flex items-center justify-between">
                <span className="text-wp-text3">AI check</span>
                <span className="font-mono" style={{ color: aiVerified ? '#00e676' : '#8892a4' }}>
                  {aiVerified ? 'done' : 'none yet'}
                </span>
              </div>
            )}
            {communityFlagCount != null && (
              <div className="flex items-center justify-between">
                <span className="text-wp-text3">Community flags</span>
                <span
                  className="font-mono"
                  style={{ color: communityFlagCount > 0 ? '#f5a623' : '#8892a4' }}
                >
                  {communityFlagCount}
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── 5-dot tier explainer ── */}
        <div className="px-3 py-2.5 border-b border-white/[0.06]">
          <p className="font-mono text-[9px] tracking-widest uppercase text-wp-text3 mb-2">
            Score bands
          </p>
          <div className="space-y-1.5">
            {SCORE_TIERS.map(tier => {
              const isActive = tier.dots === activeTier.dots
              return (
                <div
                  key={tier.dots}
                  className={`flex items-start gap-2 rounded-md px-1.5 py-1 transition-colors ${
                    isActive ? 'bg-white/[0.05]' : ''
                  }`}
                >
                  {/* Mini dot row */}
                  <div className="flex gap-[2px] mt-[3px] shrink-0">
                    {Array(5).fill(0).map((_, di) => (
                      <div
                        key={di}
                        className="w-[4px] h-[4px] rounded-full"
                        style={{ backgroundColor: di < tier.dots ? tier.color : '#2a3142' }}
                      />
                    ))}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="font-mono text-[10px] font-semibold leading-tight"
                        style={{ color: isActive ? tier.color : '#8892a4' }}
                      >
                        {tier.label}
                      </span>
                      <span className="font-mono text-[9px] text-wp-text3 shrink-0">
                        {tier.range}
                      </span>
                    </div>
                    <span className="text-[10px] text-wp-text3 leading-tight mt-0.5">
                      {tier.desc}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Scoring factors ── */}
        <div className="px-3 py-2.5">
          <p className="font-mono text-[9px] tracking-widest uppercase text-wp-text3 mb-2">
            What moves the score
          </p>
          <div className="space-y-1.5">
            {SCORE_FACTORS.map(f => (
              <div key={f.label} className="flex items-start gap-1.5">
                <span className="text-[10px] text-wp-text3 mt-px leading-none shrink-0">
                  {f.icon}
                </span>
                <div className="flex flex-col">
                  <span className="text-[10px] text-wp-text2 leading-tight font-medium">
                    {f.label}
                  </span>
                  <span className="text-[9px] text-wp-text3 leading-tight">
                    {f.desc}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-wp-text3 leading-tight mt-2">{SCORE_NOTE}</p>
        </div>
      </div>
    </div>
  )
}
