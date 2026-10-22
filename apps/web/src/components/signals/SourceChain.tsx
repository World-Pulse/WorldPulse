'use client'

import type { Source } from '@worldpulse/types'
import { hostOf, infoFor, kindLine, type OutletInfo } from '@/lib/outlet-kinds'

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

/** One link per outlet (website) among a signal's original URLs, in the order
 *  they were reported. A verified signal has two or more: the outlets whose
 *  reports of the same story corroborated it. */
export function distinctOutlets(urls: readonly string[] | null | undefined): Array<{ host: string; url: string }> {
  const seen = new Map<string, string>()
  for (const url of urls ?? []) {
    let host = ''
    try {
      const u = new URL(url)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
      host = u.hostname.toLowerCase().replace(/^www\./, '')
    } catch {
      continue
    }
    if (host && !seen.has(host)) seen.set(host, url)
  }
  return [...seen].map(([host, url]) => ({ host, url }))
}

/**
 * The outlet list's heading. A report's links are some of its story's
 * outlets; when the story has more, say so (the page showed "Reported by 16
 * outlets" beside a story of 55, reading audit P9).
 */
export function outletsHeading(count: number, storyOutlets?: number | null): string {
  return storyOutlets && storyOutlets > count
    ? `This report links ${count} of the story's ${storyOutlets} outlets`
    : `Reported by ${count} outlets`
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  sources:   Source[]
  sourceUrl?: string | null
  /** All of the signal's original article URLs (one or more per outlet) */
  originalUrls?: string[] | null
  /** Outlets that carried the whole story, when known */
  storyOutlets?: number | null
  /** Inside the story page's one "Who reported it" block (plan P2, step 3): no card or title of its own */
  bare?: boolean
  /** What each linked website is, from the API (plan 15, Oct 22, 2026): its name and kind on the outlet list */
  outletInfo?: OutletInfo[] | null
}

function SourceDomain({ url }: { url: string }) {
  try {
    return <>{new URL(url).hostname.replace(/^www\./, '')} ↗</>
  } catch {
    return <>{url} ↗</>
  }
}

export function SourceChain({ sources, sourceUrl, originalUrls, storyOutlets, bare = false, outletInfo = null }: Props) {
  const mode = computeSourceChainMode(sources, sourceUrl)
  const outlets = distinctOutlets(originalUrls)
  if (mode === 'hidden') return null

  return (
    <div className={bare ? 'space-y-3' : 'p-4 rounded-xl border border-white/10 bg-white/[0.02] space-y-4'}>
      <div className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">
        {bare ? 'This report' : '🔗 Source Intelligence'}
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
            // the outlet directory's kind (plan 15, Oct 22, 2026); the sources table's old tier called the BBC a wire service
            const kind  = kindLine(infoFor(outletInfo, hostOf(src.articleUrl) ?? hostOf(src.url)))
            return (
              <div key={src.id} className="space-y-1.5">
                {/* Kind of outlet, name + score */}
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    {kind && (
                      <span className="font-mono text-[9px] uppercase text-wp-text3 border border-white/10 rounded px-1 shrink-0">
                        {kind}
                      </span>
                    )}
                    <span className="text-[13px] font-medium text-wp-text truncate">
                      {src.name}
                    </span>
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

      {/* Every outlet that reported it — shown once there are two or more */}
      {outlets.length >= 2 && (
        <div className="space-y-1.5">
          <div className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">
            {outletsHeading(outlets.length, storyOutlets)}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {outlets.map(o => {
              const info = infoFor(outletInfo, o.host)
              const kind = kindLine(info)
              return (
                <a
                  key={o.host}
                  href={o.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={info?.name ? `${info.name}${kind ? ` · ${kind}` : ''}${info.country ? ` · ${info.country}` : ''} (${o.host})` : o.host}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-mono border border-white/10 text-wp-text2 hover:text-wp-text hover:border-white/20 transition-colors"
                >
                  {info?.name ?? o.host}
                  {kind && <span className="text-wp-text3">· {kind}</span>} ↗
                </a>
              )
            })}
          </div>
        </div>
      )}

      {/* Primary source CTA — shown when sourceUrl differs from all articleUrls. Only
          beside a list: without one, "View original source" above is that link already
          (the page showed both buttons, to the same address; Oct 21, 2026) */}
      {mode === 'list' && showPrimarySourceCTA(sources, sourceUrl) && (
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
