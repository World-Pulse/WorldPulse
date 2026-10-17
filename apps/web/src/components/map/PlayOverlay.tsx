'use client'

import type { PlayCaption } from '@/lib/map-play'

const SEV_DOT: Record<string, string> = {
  critical: '#ff3b5c', high: '#ff9f43', medium: '#f5a623', low: '#00d4aa',
}

interface PlayOverlayProps {
  caption: PlayCaption | null
  timeLabel: string
  /** 0–1 */
  progress: number
  finished: boolean
  signalCount: number
  /** e.g. "LAST 24H" */
  windowLabel: string
}

/** Captions, the WorldPulse mark and a progress line over the map while /map?play= plays (plan G9) */
export function PlayOverlay({ caption, timeLabel, progress, finished, signalCount, windowLabel }: PlayOverlayProps) {
  return (
    <>
      <div className="absolute top-4 left-4 right-4 z-20 flex items-start justify-between pointer-events-none">
        <div className="font-display font-bold tracking-[3px] text-[15px] text-wp-text drop-shadow">
          WORLD<span className="text-wp-amber">PULSE</span>
          <div className="font-mono text-[10px] tracking-wider text-wp-text opacity-70 mt-0.5">world-pulse.io</div>
        </div>
        <div className="text-right font-mono text-[11px] text-wp-text">
          <div className="tracking-wider">{finished ? `${windowLabel} · LIVE MAP` : timeLabel}</div>
          <div className="opacity-70 mt-0.5">{signalCount.toLocaleString()} signals</div>
        </div>
      </div>

      <div className="absolute left-4 right-4 bottom-8 z-20 pointer-events-none" aria-live="polite">
        {caption && !finished && (
          <div className="bg-[rgba(6,7,13,0.82)] border border-[rgba(255,255,255,0.12)] rounded-xl px-4 py-3 backdrop-blur-xl max-w-[640px] mx-auto">
            <div className="flex items-center gap-2 font-mono text-[10px] tracking-wider mb-1" style={{ color: SEV_DOT[caption.severity] ?? '#8892a4' }}>
              <span className="w-2 h-2 rounded-full" style={{ background: SEV_DOT[caption.severity] ?? '#8892a4' }} />
              {caption.severity.toUpperCase()}{caption.verified ? ' · VERIFIED' : ''}
            </div>
            <div className="text-[15px] leading-snug text-wp-text font-semibold">{caption.title}</div>
          </div>
        )}
        <div className="mt-3 h-[3px] rounded bg-[rgba(255,255,255,0.15)] overflow-hidden max-w-[640px] mx-auto">
          <div className="h-full bg-wp-amber" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </div>
    </>
  )
}
