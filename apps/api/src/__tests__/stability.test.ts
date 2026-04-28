/**
 * Scraper Stability Tracker — Unit Tests
 *
 * Covers the Gate 1 stability check logic mirrored from:
 *   apps/scraper/src/lib/stability-tracker.ts  (core logic)
 *   apps/api/src/routes/admin.ts               (API response shape)
 *
 * Test cases:
 *  1.  Zero sources tracked → hour is NOT clean
 *  2.  Active sources exactly at 70% threshold → clean
 *  3.  Active sources just below 70% threshold → NOT clean
 *  4.  Active sources above 70% with zero exceptions → clean
 *  5.  Active sources above 70% but unhandled exceptions > 0 → NOT clean
 *  6.  Streak increments on successive clean hours
 *  7.  Streak resets to 0 on a failed hour
 *  8.  API percent_to_gate calculation (partial + full streak)
 *  9.  estimated_gate_clear_date: 0 hours remaining → returns current time
 * 10.  estimated_gate_clear_date: partial streak → projects correctly
 * 11.  status is 'stable' only when consecutive_clean_hours >= 336
 * 12.  currentHourBucket formats as "YYYY-MM-DDTHH"
 * 13.  failureReason message includes the exact percentage when below threshold
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Constants (mirror stability-tracker.ts) ──────────────────────────────────

const TARGET_HOURS            = 336  // 14 days × 24 h
const CLEAN_SOURCE_THRESHOLD  = 0.70 // 70%

// ── Pure helpers mirrored from stability-tracker.ts ─────────────────────────

/** Returns "YYYY-MM-DDTHH" for any given Date. */
function currentHourBucket(now = new Date()): string {
  return now.toISOString().slice(0, 13)
}

/** Whether the active/total fraction meets the 70% quorum. */
function sourcesPassThreshold(active: number, total: number): boolean {
  if (total === 0) return false
  return active / total >= CLEAN_SOURCE_THRESHOLD
}

/** Determine stability status from streak. */
function deriveStatus(streak: number): 'stable' | 'degraded' | 'failed' {
  if (streak >= TARGET_HOURS) return 'stable'
  if (streak > 0) return 'degraded'
  return 'failed'
}

/**
 * Evaluate a clean hour given source counts and exception count.
 * Pure function — no Redis I/O.
 */
function evaluateCleanHour(
  activeSourceCount: number,
  totalSourceCount: number,
  exceptionCount: number,
  now = new Date(),
): { clean: boolean; failureReason: string | null; activePercent: number } {
  if (totalSourceCount === 0) {
    return { clean: false, failureReason: 'No sources tracked yet', activePercent: 0 }
  }

  const activePercent = activeSourceCount / totalSourceCount

  if (activePercent < CLEAN_SOURCE_THRESHOLD) {
    return {
      clean: false,
      activePercent,
      failureReason: `Only ${(activePercent * 100).toFixed(1)}% of sources active (threshold: ${CLEAN_SOURCE_THRESHOLD * 100}%)`,
    }
  }

  if (exceptionCount > 0) {
    const bucket = currentHourBucket(now)
    return {
      clean: false,
      activePercent,
      failureReason: `${exceptionCount} unhandled exception(s) in hour ${bucket}`,
    }
  }

  return { clean: true, failureReason: null, activePercent }
}

/**
 * Compute the API response fields from raw Redis values.
 * Mirrors the inline logic in apps/api/src/routes/admin.ts /scraper/stability.
 */
function buildStabilityResponse(
  streakRaw: string | null,
  lastFailureAt: string | null,
  statusRaw: string | null,
  now = new Date(),
) {
  const consecutive_clean_hours = Math.max(0, parseInt(streakRaw ?? '0', 10))
  const status = (statusRaw ?? 'degraded') as 'stable' | 'degraded' | 'failed'
  const percent_to_gate = Number(
    Math.min(100, (consecutive_clean_hours / TARGET_HOURS) * 100).toFixed(2),
  )
  const hoursRemaining = Math.max(0, TARGET_HOURS - consecutive_clean_hours)
  const estimated_gate_clear_date = hoursRemaining === 0
    ? now.toISOString()
    : new Date(now.getTime() + hoursRemaining * 3_600_000).toISOString()

  return {
    consecutive_clean_hours,
    target_hours: TARGET_HOURS,
    percent_to_gate,
    status,
    last_failure_at: lastFailureAt ?? null,
    estimated_gate_clear_date,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('currentHourBucket', () => {
  it('formats as YYYY-MM-DDTHH (13 chars, no minutes/seconds)', () => {
    const d = new Date('2026-03-29T14:37:55.000Z')
    const bucket = currentHourBucket(d)
    expect(bucket).toBe('2026-03-29T14')
    expect(bucket).toHaveLength(13)
  })
})

describe('evaluateCleanHour — source quorum', () => {
  it('1. fails when zero sources are tracked', () => {
    const result = evaluateCleanHour(0, 0, 0)
    expect(result.clean).toBe(false)
    expect(result.failureReason).toBe('No sources tracked yet')
    expect(result.activePercent).toBe(0)
  })

  it('2. passes when exactly 70% of sources are active (boundary inclusive)', () => {
    // 70% of 54 = 37.8 → 38 active out of 54 = 70.37% ≥ 70%
    const result = evaluateCleanHour(38, 54, 0)
    expect(result.clean).toBe(true)
    expect(result.failureReason).toBeNull()
  })

  it('3. fails when active sources are just below 70% threshold', () => {
    // 69% of 100 = 69 active out of 100 = 69% < 70%
    const result = evaluateCleanHour(69, 100, 0)
    expect(result.clean).toBe(false)
    expect(result.failureReason).toMatch(/69\.0%/)
    expect(result.failureReason).toMatch(/threshold: 70%/)
  })

  it('4. passes when active sources exceed 70% and no exceptions', () => {
    // 45 / 54 ≈ 83.3% — well above threshold
    const result = evaluateCleanHour(45, 54, 0)
    expect(result.clean).toBe(true)
    expect(result.failureReason).toBeNull()
    expect(result.activePercent).toBeCloseTo(45 / 54)
  })

  it('5. fails when active sources exceed 70% BUT unhandled exceptions occurred', () => {
    const result = evaluateCleanHour(50, 54, 2)
    expect(result.clean).toBe(false)
    expect(result.failureReason).toMatch(/2 unhandled exception\(s\)/)
  })
})

describe('sourcesPassThreshold helper', () => {
  it('returns false for zero total sources', () => {
    expect(sourcesPassThreshold(0, 0)).toBe(false)
  })

  it('returns true at exactly 70%', () => {
    expect(sourcesPassThreshold(7, 10)).toBe(true)
  })

  it('returns false at 69%', () => {
    expect(sourcesPassThreshold(69, 100)).toBe(false)
  })

  it('returns true at 100%', () => {
    expect(sourcesPassThreshold(54, 54)).toBe(true)
  })
})

describe('streak logic', () => {
  it('6. streak increments by 1 on each consecutive clean hour', () => {
    let streak = 0
    // Simulate 5 clean hours
    for (let i = 0; i < 5; i++) {
      const isClean = evaluateCleanHour(50, 54, 0).clean
      if (isClean) streak++
    }
    expect(streak).toBe(5)
  })

  it('7. streak resets to 0 on any failed hour', () => {
    let streak = 100 // pretend 100 clean hours accumulated
    const { clean } = evaluateCleanHour(30, 54, 0) // 55.5% < 70% → fails
    if (!clean) streak = 0
    expect(streak).toBe(0)
  })
})

describe('buildStabilityResponse — API shape', () => {
  const FIXED_NOW = new Date('2026-03-29T12:00:00.000Z')

  it('8a. percent_to_gate is 0 when streak is 0', () => {
    const resp = buildStabilityResponse('0', null, 'failed', FIXED_NOW)
    expect(resp.percent_to_gate).toBe(0)
    expect(resp.consecutive_clean_hours).toBe(0)
    expect(resp.target_hours).toBe(336)
  })

  it('8b. percent_to_gate is 50 when streak is 168 (half of 336)', () => {
    const resp = buildStabilityResponse('168', null, 'degraded', FIXED_NOW)
    expect(resp.percent_to_gate).toBe(50)
  })

  it('8c. percent_to_gate is capped at 100 when streak exceeds 336', () => {
    const resp = buildStabilityResponse('400', null, 'stable', FIXED_NOW)
    expect(resp.percent_to_gate).toBe(100)
  })

  it('9. estimated_gate_clear_date equals now when 0 hours remain', () => {
    const resp = buildStabilityResponse('336', null, 'stable', FIXED_NOW)
    expect(resp.estimated_gate_clear_date).toBe(FIXED_NOW.toISOString())
  })

  it('10. estimated_gate_clear_date projects forward by remaining hours', () => {
    // 336 - 100 = 236 hours remaining
    const resp = buildStabilityResponse('100', null, 'degraded', FIXED_NOW)
    const expectedMs = FIXED_NOW.getTime() + 236 * 3_600_000
    expect(new Date(resp.estimated_gate_clear_date).getTime()).toBe(expectedMs)
  })

  it('11. status is stable only when streak >= 336', () => {
    expect(deriveStatus(335)).toBe('degraded')
    expect(deriveStatus(336)).toBe('stable')
    expect(deriveStatus(500)).toBe('stable')
    expect(deriveStatus(0)).toBe('failed')
  })

  it('response includes all required fields', () => {
    const resp = buildStabilityResponse('42', '2026-03-28T05:00:00.000Z', 'degraded', FIXED_NOW)
    expect(resp).toMatchObject({
      consecutive_clean_hours:   42,
      target_hours:              336,
      percent_to_gate:           expect.any(Number),
      status:                    'degraded',
      last_failure_at:           '2026-03-28T05:00:00.000Z',
      estimated_gate_clear_date: expect.any(String),
    })
  })

  it('last_failure_at is null when no failure has occurred', () => {
    const resp = buildStabilityResponse('1', null, 'degraded', FIXED_NOW)
    expect(resp.last_failure_at).toBeNull()
  })
})

describe('failureReason formatting', () => {
  it('13. failure reason includes exact percentage when below threshold', () => {
    const result = evaluateCleanHour(35, 54, 0) // 64.8% < 70%
    expect(result.clean).toBe(false)
    expect(result.failureReason).toMatch(/64\.8%/)
    expect(result.failureReason).toContain('threshold: 70%')
  })
})
