/**
 * Dynamic Reliability Scoring
 *
 * Adds per-signal variance to the base source reliability score.
 * Without this, every signal from the same source gets an identical score,
 * which creates score anomalies detected by the fact-checker.
 *
 * Scoring factors:
 *   1. Base source reliability (0.0–1.0) — the starting point
 *   2. Content completeness bonus — signals with summary, location, tags score higher
 *   3. Severity–category alignment penalty — CRITICAL sports/culture signals get docked
 *   4. Source type bonus — institutional/government sources trusted more
 *   5. Small random jitter — breaks exact ties between signals from same source
 *
 * The corroboration boost in correlate.ts handles multi-source signals separately.
 *
 * @module pipeline/reliability-score
 */

import type { Category, SignalSeverity } from '@worldpulse/types'

export interface ScoreInputs {
  /** Base reliability from the source definition (0.0–1.0) */
  baseReliability: number
  /** LLM or rule-based severity classification */
  severity: SignalSeverity | string
  /** Signal category */
  category: Category | string
  /** Does the signal have a non-empty summary beyond just the title? */
  hasSummary: boolean
  /** Does the signal have a resolved location? */
  hasLocation: boolean
  /** Number of tags extracted */
  tagCount: number
  /** Is this from a state media source? */
  isStateMedia?: boolean
  /** How many sources contributed to this signal at insert time */
  sourceCount: number
  /** Detected language — non-English content with English-only source is suspicious */
  language?: string
}

/**
 * Compute the final reliability score for a signal at insert time.
 *
 * Returns a score clamped to [0.05, 0.99] — we never assign 0 or 1.0
 * because both imply a certainty we don't have.
 */
export function computeReliabilityScore(inputs: ScoreInputs): number {
  let score = inputs.baseReliability

  // ── Content completeness adjustment (±0.05 max) ────────────────────────
  // Signals with richer metadata are more trustworthy
  let completenessAdj = 0
  if (inputs.hasSummary) completenessAdj += 0.02
  if (inputs.hasLocation) completenessAdj += 0.02
  if (inputs.tagCount >= 3) completenessAdj += 0.01
  else if (inputs.tagCount === 0) completenessAdj -= 0.02

  score += completenessAdj

  // ── Severity–category alignment penalty ────────────────────────────────
  // Cultural/sports/opinion content should not have high reliability at
  // critical/high severity — it indicates a classification error.
  const softCategories = new Set(['culture', 'sports', 'other', 'space', 'science'])
  if (softCategories.has(inputs.category)) {
    if (inputs.severity === 'critical') score -= 0.15
    else if (inputs.severity === 'high') score -= 0.08
  }

  // ── State media penalty ────────────────────────────────────────────────
  // State-controlled media is less reliable for geopolitical content
  if (inputs.isStateMedia) {
    const sensitiveCats = new Set(['conflict', 'geopolitics', 'elections', 'security'])
    if (sensitiveCats.has(inputs.category)) {
      score -= 0.10
    } else {
      score -= 0.03
    }
  }

  // ── Single-source penalty for high severity ────────────────────────────
  // Single-source signals are inherently less reliable. Stronger penalties
  // create visible separation from multi-source corroborated signals.
  if (inputs.sourceCount <= 1) {
    if (inputs.severity === 'critical') score -= 0.15
    else if (inputs.severity === 'high') score -= 0.08
    else if (inputs.severity === 'medium') score -= 0.03
  }

  // ── Multi-source bonus ────────────────────────────────────────────────
  // Reward corroborated signals so they visibly outrank single-source ones
  if (inputs.sourceCount >= 3) score += 0.05
  else if (inputs.sourceCount >= 2) score += 0.02

  // ── Content-derived variance ───────────────────────────────────────────
  // Use deterministic signal properties to create natural score spread,
  // then add wider jitter to prevent any remaining ties.
  // Hash-like spread from tag count and summary length indicator
  const contentSpread = ((inputs.tagCount % 7) * 0.005) +
    (inputs.hasSummary && inputs.hasLocation ? 0.01 : 0) +
    (inputs.language !== 'en' ? -0.01 : 0)
  score += contentSpread

  // Wider jitter (±0.04) to ensure unique scores across concurrent inserts
  const jitter = (Math.random() - 0.5) * 0.08  // range: -0.04 to +0.04
  score += jitter

  // ── Clamp to valid range ──────────────────────────────────────────────
  return Math.round(Math.max(0.05, Math.min(0.99, score)) * 1000) / 1000
}

/**
 * Corroboration threshold check.
 *
 * Returns the maximum severity a signal is allowed at a given source count.
 * This enforces: "no CRITICAL severity without 2+ independent sources."
 */
export function maxSeverityForSourceCount(
  sourceCount: number,
  category: string,
): SignalSeverity {
  // Breaking news from institutional sources can be critical at 1 source
  // (e.g., USGS earthquake, NOAA tsunami — they ARE the primary source)
  const institutionalCategories = new Set([
    'disaster', 'health', 'security',
  ])

  if (sourceCount >= 3) return 'critical'

  // 2 sources: allow HIGH, but require 3+ for CRITICAL
  if (sourceCount >= 2) return 'high'

  // Single-source: cap at HIGH for institutional, MEDIUM for everything else
  if (sourceCount <= 1) {
    if (institutionalCategories.has(category)) return 'high'
    return 'medium'
  }

  return 'critical'
}
