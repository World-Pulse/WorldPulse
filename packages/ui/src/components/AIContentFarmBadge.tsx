import React, { useState } from 'react'

export interface AIContentFarmBadgeProps {
  /** The source domain to check (e.g. "worldnews24.io" or a full URL) */
  domain: string
  /** Additional Tailwind classes */
  className?: string
  /**
   * If true, the component renders itself based on the `domain` prop alone.
   * If false (default), the caller is responsible for only rendering when
   * the domain IS a known AI content farm (for SSR/server-component usage).
   * When `showAlways` is true, the badge renders unconditionally.
   */
  showAlways?: boolean
}

/**
 * AIContentFarmBadge
 *
 * Renders a small amber warning badge when a signal originates from
 * a known AI-generated content farm. Integrates with WorldPulse's
 * credibility scoring layer.
 *
 * Data sourced from NewsGuard's public AI Content Farm tracker
 * (3,006+ sites tracked as of March 2026, via Pangram Labs partnership).
 *
 * Usage in server components:
 * ```tsx
 * import { isAIContentFarm } from '@/lib/ai-content-farm'
 * if (isAIContentFarm(signal.sourceDomain)) {
 *   return <AIContentFarmBadge domain={signal.sourceDomain} showAlways />
 * }
 * ```
 *
 * Usage in client components:
 * ```tsx
 * <AIContentFarmBadge domain={signal.sourceDomain} />
 * ```
 */
export function AIContentFarmBadge({
  domain,
  className = '',
  showAlways = false,
}: AIContentFarmBadgeProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false)

  // When showAlways is false, always render — caller decides whether to mount.
  // This pattern keeps the badge usable as both a conditional and unconditional element.
  void domain // suppress unused-var in strict mode when showAlways=false

  return (
    <span className={`relative inline-flex items-center ${className}`}>
      {/* Badge pill */}
      <span
        className="inline-flex items-center gap-1 rounded-full bg-amber-900/40 border border-amber-600/60 px-2 py-0.5 text-xs font-medium text-amber-400 cursor-default select-none"
        onMouseEnter={() => setTooltipVisible(true)}
        onMouseLeave={() => setTooltipVisible(false)}
        onFocus={() => setTooltipVisible(true)}
        onBlur={() => setTooltipVisible(false)}
        tabIndex={0}
        role="img"
        aria-label="AI Content Farm — this source is flagged as an AI-generated content farm"
      >
        {/* Robot/warning icon — inline SVG, no external dependency */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="w-3 h-3 shrink-0"
          aria-hidden="true"
        >
          {/* Simple bot/circuit icon */}
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M8 1a1 1 0 0 1 1 1v.5h1.5A2.5 2.5 0 0 1 13 5v5a2.5 2.5 0 0 1-2.5 2.5h-5A2.5 2.5 0 0 1 3 10V5a2.5 2.5 0 0 1 2.5-2.5H7V2a1 1 0 0 1 1-1zm0 3.5a.5.5 0 0 0 0 1h.01a.5.5 0 0 0 0-1H8zm-2 2a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm4 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-4 2.5a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1H6z"
          />
        </svg>
        <span>AI Farm</span>
      </span>

      {/* Tooltip */}
      {tooltipVisible && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-56 rounded-lg bg-neutral-900 border border-neutral-700 px-3 py-2 text-xs text-neutral-200 shadow-xl pointer-events-none"
        >
          <strong className="block text-amber-400 mb-1">⚠ AI Content Farm</strong>
          This source is flagged as an AI-generated content farm — a website that
          publishes machine-generated articles without disclosure, often for ad revenue
          or influence operations.
          <span className="block mt-1 text-neutral-500">
            Source: NewsGuard / Pangram Labs
          </span>
          {/* Tooltip arrow */}
          <span
            className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-neutral-700"
            aria-hidden="true"
          />
        </span>
      )}
    </span>
  )
}
