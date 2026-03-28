'use client'

// ─── Types ────────────────────────────────────────────────────────────────────

export type VerificationStatus = 'verified' | 'partial' | 'unverified' | 'disputed'

export interface VerificationEntry {
  check_type: string
  result:     string
  confidence: number
}

export interface VerificationSummary {
  status:           VerificationStatus
  score:            number       // 0–1
  confirmed_checks: number
  total_checks:     number
  has_disputed:     boolean
}

// ─── Pure helpers (also used in unit tests) ───────────────────────────────────

const POSITIVE_RESULTS = new Set(['confirmed', 'pass', 'verified'])
const NEGATIVE_RESULTS = new Set(['refuted', 'fail', 'failed', 'disputed'])

/**
 * Compute a 0-1 verification score from an array of verification log entries.
 * Returns 0.5 (neutral) if no entries are provided.
 */
export function getVerificationScore(entries: VerificationEntry[]): number {
  if (entries.length === 0) return 0

  const weightedSum = entries.reduce((sum, e) => {
    const r = e.result.toLowerCase()
    const clampedConf = Math.max(0, Math.min(1, e.confidence))
    if (POSITIVE_RESULTS.has(r)) return sum + clampedConf
    if (NEGATIVE_RESULTS.has(r)) return sum - clampedConf
    // warn/pending/unverified — count as neutral, slight positive if confidence > 0.6
    return sum + (clampedConf > 0.6 ? clampedConf * 0.25 : 0)
  }, 0)

  // Normalise to 0–1
  return Math.max(0, Math.min(1, weightedSum / entries.length))
}

/**
 * Derive VerificationStatus from structured verification log entries.
 * Precedence: any refuted → disputed; score ≥ 0.8 → verified; ≥ 0.4 → partial; else unverified.
 */
export function computeVerificationStatusFromLog(
  entries: VerificationEntry[],
): VerificationStatus {
  if (entries.length === 0) return 'unverified'

  const hasDisputed = entries.some(e => NEGATIVE_RESULTS.has(e.result.toLowerCase()))
  if (hasDisputed) return 'disputed'

  const score = getVerificationScore(entries)
  if (score >= 0.8) return 'verified'
  if (score >= 0.4) return 'partial'
  return 'unverified'
}

/**
 * Derive VerificationStatus from the signal-level status field + reliabilityScore.
 * Used for feed list items where full verification_log isn't available.
 */
export function computeVerificationStatus(
  signalStatus: string | undefined | null,
  reliabilityScore: number | undefined | null,
): VerificationStatus {
  const s = (signalStatus ?? '').toLowerCase()
  if (s === 'disputed' || s === 'false' || s === 'retracted') return 'disputed'
  if (s === 'verified') return 'verified'

  const r = reliabilityScore ?? 0
  if (r >= 0.75) return 'verified'
  if (r >= 0.40) return 'partial'
  return 'unverified'
}

/**
 * Build a VerificationSummary from log entries (detail page use-case).
 */
export function buildVerificationSummary(
  entries: VerificationEntry[],
  signalStatus?: string | null,
): VerificationSummary {
  const confirmedChecks = entries.filter(e =>
    POSITIVE_RESULTS.has(e.result.toLowerCase()),
  ).length
  const hasDisputed = entries.some(e => NEGATIVE_RESULTS.has(e.result.toLowerCase()))
  const score  = getVerificationScore(entries)
  const status = entries.length > 0
    ? computeVerificationStatusFromLog(entries)
    : computeVerificationStatus(signalStatus, null)

  return {
    status,
    score,
    confirmed_checks: confirmedChecks,
    total_checks:     entries.length,
    has_disputed:     hasDisputed,
  }
}

// ─── Badge config ─────────────────────────────────────────────────────────────

interface BadgeConfig {
  label:   string
  icon:    string
  bg:      string
  border:  string
  color:   string
}

export function getVerificationBadgeConfig(status: VerificationStatus): BadgeConfig {
  switch (status) {
    case 'verified':
      return {
        label:  'VERIFIED',
        icon:   '✓',
        bg:     'rgba(0,230,118,0.12)',
        border: 'rgba(0,230,118,0.35)',
        color:  '#00e676',
      }
    case 'partial':
      return {
        label:  'PARTIAL',
        icon:   '◑',
        bg:     'rgba(245,166,35,0.12)',
        border: 'rgba(245,166,35,0.35)',
        color:  '#f5a623',
      }
    case 'disputed':
      return {
        label:  'DISPUTED',
        icon:   '✕',
        bg:     'rgba(255,59,92,0.12)',
        border: 'rgba(255,59,92,0.35)',
        color:  '#ff3b5c',
      }
    case 'unverified':
    default:
      return {
        label:  'UNVERIFIED',
        icon:   '○',
        bg:     'rgba(136,146,164,0.10)',
        border: 'rgba(136,146,164,0.25)',
        color:  '#8892a4',
      }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  status:  VerificationStatus
  /** Show confirmed/total counts when available */
  summary?: Pick<VerificationSummary, 'confirmed_checks' | 'total_checks'>
  /** 'sm' = compact pill for feed cards; 'md' = wider pill for detail page */
  size?:   'sm' | 'md'
  className?: string
}

export function VerificationBadge({ status, summary, size = 'sm', className = '' }: Props) {
  const cfg = getVerificationBadgeConfig(status)

  const tooltipParts: string[] = [`Verification: ${cfg.label}`]
  if (summary && summary.total_checks > 0) {
    tooltipParts.push(`${summary.confirmed_checks}/${summary.total_checks} checks passed`)
  }
  const tooltip = tooltipParts.join(' — ')

  return (
    <span
      className={`inline-flex items-center gap-1 font-mono uppercase tracking-wider ${
        size === 'md' ? 'px-2.5 py-1 text-[10px] rounded-full' : 'px-1.5 py-0.5 text-[8px] rounded'
      } ${className}`}
      style={{
        background: cfg.bg,
        border:     `1px solid ${cfg.border}`,
        color:      cfg.color,
      }}
      title={tooltip}
      aria-label={tooltip}
      role="status"
    >
      <span aria-hidden="true" style={{ fontSize: size === 'md' ? '10px' : '8px' }}>
        {cfg.icon}
      </span>
      <span>{cfg.label}</span>
      {summary && summary.total_checks > 0 && size === 'md' && (
        <span
          className="ml-0.5 opacity-60"
          aria-label={`${summary.confirmed_checks} of ${summary.total_checks} checks passed`}
        >
          {summary.confirmed_checks}/{summary.total_checks}
        </span>
      )}
    </span>
  )
}
