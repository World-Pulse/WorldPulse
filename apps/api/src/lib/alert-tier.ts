/**
 * Alert Tier Classification
 *
 * Computes the urgency tier for a WorldPulse signal based on severity,
 * reliability score, and category. Mirrors the FLASH / PRIORITY / ROUTINE
 * classification pattern used by professional intelligence tools.
 *
 * Tiers:
 *   FLASH    — Immediate action / maximum urgency
 *              Criteria: critical severity + reliability ≥ 0.65
 *              OR: breaking category + critical severity
 *
 *   PRIORITY — High urgency, elevated attention required
 *              Criteria: high or critical severity (below FLASH threshold)
 *              OR: breaking / conflict / disaster category
 *
 *   ROUTINE  — Standard signal, normal processing
 *              Criteria: everything else (medium / low / info severity)
 *
 * @module lib/alert-tier
 */

import type { AlertTier, Category, SignalSeverity } from '@worldpulse/types'

/** Reliability score threshold required for FLASH classification */
export const FLASH_RELIABILITY_THRESHOLD = 0.65

/** Categories that elevate a signal to at least PRIORITY tier */
const ELEVATED_CATEGORIES = new Set<Category>(['breaking', 'conflict', 'disaster'])

/**
 * Compute the alert tier for a signal.
 *
 * @param severity        - Signal severity level
 * @param reliabilityScore - 0.0–1.0 reliability score
 * @param category        - Signal category
 * @returns AlertTier ('FLASH' | 'PRIORITY' | 'ROUTINE')
 */
export function computeAlertTier(
  severity: SignalSeverity,
  reliabilityScore: number,
  category: Category,
): AlertTier {
  // FLASH: critical severity AND high reliability, or breaking critical event
  if (severity === 'critical') {
    if (reliabilityScore >= FLASH_RELIABILITY_THRESHOLD) {
      return 'FLASH'
    }
    if (category === 'breaking') {
      return 'FLASH'
    }
    // critical below threshold → PRIORITY
    return 'PRIORITY'
  }

  // PRIORITY: high severity OR elevated categories
  if (severity === 'high' || ELEVATED_CATEGORIES.has(category)) {
    return 'PRIORITY'
  }

  // ROUTINE: medium, low, info severity in non-elevated categories
  return 'ROUTINE'
}

/**
 * Compute alert tier from a raw DB row (snake_case fields).
 * Convenience wrapper for use in the scraper pipeline and API routes.
 */
export function computeAlertTierFromRow(row: {
  severity:          string
  reliability_score: number
  category:          string
}): AlertTier {
  return computeAlertTier(
    row.severity        as SignalSeverity,
    row.reliability_score,
    row.category        as Category,
  )
}

/**
 * Map a DB alert_tier string to the typed AlertTier union.
 * Returns 'ROUTINE' as a safe default for unknown values.
 */
export function parseAlertTier(raw: string | null | undefined): AlertTier {
  if (raw === 'FLASH' || raw === 'PRIORITY' || raw === 'ROUTINE') {
    return raw
  }
  return 'ROUTINE'
}
