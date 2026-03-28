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
  /** Dot size variant */
  size?: 'sm' | 'md'
}

// ── Scoring tier definitions (5-dot system) ───────────────────────────────────
const SCORE_TIERS = [
  {
    dots: 5,
    range: '80–100%',
    label: 'Fully Verified',
    color: '#00e676',
    desc: 'Multi-source confirmed, AI-verified, cross-checked',
  },
  {
    dots: 4,
    range: '60–79%',
    label: 'High Confidence',
    color: '#00c85a',
    desc: 'Multiple independent sources, no contradictions',
  },
  {
    dots: 3,
    range: '40–59%',
    label: 'Moderate',
    color: '#f5a623',
    desc: 'Single vetted source, partial cross-check',
  },
  {
    dots: 2,
    range: '20–39%',
    label: 'Low Confidence',
    color: '#fbbf24',
    desc: 'Unverified or community-flagged content',
  },
  {
    dots: 1,
    range: '0–19%',
    label: 'Unverified',
    color: '#ff3b5c',
    desc: 'No corroboration; treat as unconfirmed',
  },
] as const

// ── Score factor descriptions ─────────────────────────────────────────────────
const SCORE_FACTORS = [
  { icon: '◎', label: 'Source reputation', desc: 'Publisher tier & track record' },
  { icon: '⇄', label: 'Cross-check', desc: 'Agreement across independent sources' },
  { icon: '◈', label: 'AI verification', desc: 'Automated fact & geo validation' },
  { icon: '⚑', label: 'Community flags', desc: 'Reader-reported inaccuracies' },
] as const

export function ReliabilityDots({
  score,
  sourceCount,
  crossCheckStatus,
  aiVerified,
  communityFlagCount,
  label = false,
  size = 'sm',
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
  const activeTier = SCORE_TIERS.find(t => pct >= parseInt(t.range)) ?? SCORE_TIERS[4]

  return (
    <div className="relative group/rdots inline-flex items-center gap-1 font-mono text-[10px] text-wp-text3">
      {label && <span>Reliability</span>}
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
        className="absolute bottom-full right-0 mb-2 z-50 w-[260px] rounded-xl border border-white/[0.10] bg-[#0d1117] shadow-xl pointer-events-none opacity-0 group-hover/rdots:opacity-100 transition-opacity duration-150 overflow-hidden"
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
                <span className="text-wp-text3">Sources verified</span>
                <span className="font-mono text-wp-text2">{sourceCount}</span>
              </div>
            )}
            {crossCheckStatus != null && (
              <div className="flex items-center justify-between">
                <span className="text-wp-text3">Cross-check</span>
                <span className="font-mono capitalize" style={{ color: crossColor }}>
                  {crossCheckStatus}
                </span>
              </div>
            )}
            {aiVerified != null && (
              <div className="flex items-center justify-between">
                <span className="text-wp-text3">AI verified</span>
                <span className="font-mono" style={{ color: aiVerified ? '#00e676' : '#8892a4' }}>
                  {aiVerified ? 'yes' : 'no'}
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
            Score tiers
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
            What affects the score
          </p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
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
        </div>
      </div>
    </div>
  )
}
