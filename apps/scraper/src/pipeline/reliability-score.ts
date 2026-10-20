/**
 * A report's reliability score when it is saved.
 *
 * Scoring factors:
 *   1. The outlet's rating (0.0–1.0), from its source definition: the starting point
 *   2. Completeness: a summary, a place and tags add a little; no tags take a little
 *   3. Severity–category mismatch: CRITICAL or HIGH sports/culture reports lose some
 *   4. State-run outlets: 10 points off on conflict, geopolitics, elections or security, 3 otherwise
 *   5. One outlet so far: medium, high and critical reports lose some (more outlets: a small bonus)
 *
 * The same report always gets the same score. Until Oct 20, 2026 a random
 * spread of up to ±4 points (and a "spread" from the tag count and language)
 * was added so that reports from one outlet never tied; it made the score
 * noisy and could tip a story near the 65% verified line either way (Devon:
 * "fix this and remove it"). Ties are fine: the same outlet with the same
 * evidence earns the same score.
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
  /** Detected language (no longer moves the score: it was part of the removed spread) */
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
