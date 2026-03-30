'use client'

import type { Source } from '@worldpulse/types'

// ─── Pure helpers (exported for tests) ───────────────────────────────────────

export function reliabilityBarColor(score: number): string {
  if (score >= 0.8) return '#00e676'
  if (score >= 0.6) return '#f5a623'
  return '#ff3b5c'
}

export type SourceChainMode = 'hidden' | 'cta_only' | 'list'

export function computeSourceChainMode(
  sources: Source[],
  sourceUrl?: string | null,
): SourceChainMode {
  if (sources.length > 0) return 'list'
  if (sourceUrl) return 'cta_only'
  return 'hidden'
}

/** Returns true when sourceUrl should be shown as a standalone CTA
 *  (i.e. it exists and isn't already linked via an articleUrl in the list). */
export function showPrimarySourceCTA(
  sources: Source[],
  sourceUrl?: string | null,
): boolean {
  if (!sourceUrl) return false
  return !sources.some(s => s.articleUrl === sourceUrl)
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  sources:   Source[]
  sourceUrl?: string | null
}

function SourceDomain({ url }: { url: string }) {
  try {
    return <>{new URL(url).hostname.replace(/^www\./, '')} ↗</>
  } catch {
    return <>{url} ↗</>
  }
}

export function SourceChain({ sources, sourceUrl }: Props) {
  const mode = computeSourceChainMode(sources, sourceUrl)
  if (mode === 'hidden') return null

  return (
    <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02] space-y-4">
      <div className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">
        🔗 Source Intelligence
      </div>

      {mode === 'cta_only' && (
        <a
          href={sourceUrl!}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold border border-white/10 text-wp-text2 hover:text-wp-text hover:border-white/20 transition-all"
        >
          View original source →
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2 10L10 2M10 2H5M10 2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </a>
      )}

      {mode === 'list' && (
        <div className="space-y-4">
          {sources.map(src => {
            const pct   = Math.round(src.trustScore * 100)
            const color = reliabilityBarColor(src.trustScore)
            return (
              <div key={src.id} className="space-y-1.5">
                {/* Name + score */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-wp-text truncate">
                    {src.name}
                  </span>
                  <span
                    className="font-mono text-[11px] shrink-0 font-semibold tabular-nums"
                    style={{ color }}
                  >
                    {pct}%
                  </span>
                </div>

                {/* Reliability bar */}
                <div className="h-1 bg-white/[0.07] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, background: color }}
                  />
                </div>

                {/* Links */}
                <div className="flex items-center gap-2 flex-wrap">
                  {src.articleUrl && (
                    <a
                      href={src.articleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-mono font-medium transition-colors"
                      style={{
                        background: 'rgba(0,210,210,0.1)',
                        color: '#00d2d2',
                        border: '1px solid rgba(0,210,210,0.25)',
                      }}
                    >
                      View article →
                    </a>
                  )}
                  {src.url && (
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[10px] text-wp-text3 hover:text-wp-text2 transition-colors"
                    >
                      <SourceDomain url={src.url} />
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Primary source CTA — shown when sourceUrl differs from all articleUrls */}
      {showPrimarySourceCTA(sources, sourceUrl) && (
        <a
          href={sourceUrl!}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold border border-white/10 text-wp-text2 hover:text-wp-text hover:border-white/20 transition-all"
        >
          View primary source →
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2 10L10 2M10 2H5M10 2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </a>
      )}
    </div>
  )
}
