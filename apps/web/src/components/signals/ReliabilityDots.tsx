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

  const dotClass = size === 'md'
    ? 'w-[7px] h-[7px] rounded-full'
    : 'w-[5px] h-[5px] rounded-full'

  const hasTooltip =
    sourceCount        != null ||
    crossCheckStatus   != null ||
    aiVerified         != null ||
    communityFlagCount != null

  const crossColor =
    crossCheckStatus === 'confirmed'   ? '#00e676' :
    crossCheckStatus === 'contested'   ? '#ff3b5c' :
    crossCheckStatus === 'unconfirmed' ? '#f5a623' :
    '#8892a4'

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

      {hasTooltip && (
        <div
          className="absolute bottom-full right-0 mb-2 z-50 w-[210px] rounded-xl border border-white/[0.10] bg-[#0d1117] shadow-xl p-3 space-y-1.5 pointer-events-none opacity-0 group-hover/rdots:opacity-100 transition-opacity duration-150"
          role="tooltip"
        >
          <div className="font-mono text-[9px] tracking-widest uppercase text-wp-text3 mb-1.5">
            Reliability breakdown
          </div>
          <div className="space-y-1.5 text-[11px]">
            {sourceCount != null && (
              <div className="flex items-center justify-between">
                <span className="text-wp-text3">Sources</span>
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
        </div>
      )}
    </div>
  )
}
