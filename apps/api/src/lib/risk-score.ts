// ─── Geopolitical Risk Score ──────────────────────────────────────────────────
// Composite 0-100 risk score derived from severity, reliability, corroboration,
// and recency. Competes with WorldMonitor strategic risk scoring feature.

export interface RiskScoreInput {
  severity: string          // "critical"|"high"|"medium"|"low"|"info"
  reliabilityScore: number  // 0-1
  sourceCount: number       // number of sources corroborating
  hasLocation: boolean      // has geo coordinates
  category: string          // "conflict"|"disaster"|"health"|"market"|etc
  publishedAt: Date         // signal timestamp
  countryCode?: string      // ISO country code
}

export interface RiskScoreResult {
  score: number                 // 0-100 integer
  level: 'critical' | 'high' | 'medium' | 'low'
  factors: {
    severityScore: number       // 0-40
    reliabilityScore: number    // 0-25
    corroborationScore: number  // 0-20
    recencyScore: number        // 0-15
  }
  label: string                 // e.g. "High Risk · 72"
}

// Severity weights (0-40)
const SEVERITY_SCORES: Record<string, number> = {
  critical: 40,
  high:     30,
  medium:   18,
  low:      8,
  info:     2,
}

export function computeRiskScore(input: RiskScoreInput): RiskScoreResult {
  // ── Severity (0-40) ───────────────────────────────────────────────────────
  const severityScore = SEVERITY_SCORES[input.severity] ?? 8

  // ── Reliability (0-25) ────────────────────────────────────────────────────
  const reliabilityScore = Math.round(Math.min(1, Math.max(0, input.reliabilityScore)) * 25)

  // ── Corroboration (0-20) ──────────────────────────────────────────────────
  const corroborationScore =
    input.sourceCount >= 4 ? 20 :
    input.sourceCount === 3 ? 15 :
    input.sourceCount === 2 ? 10 :
    5

  // ── Recency (0-15) ────────────────────────────────────────────────────────
  const ageMs = Date.now() - input.publishedAt.getTime()
  const ageH  = ageMs / (1000 * 60 * 60)
  const recencyScore =
    ageH <= 1   ? 15 :
    ageH <= 6   ? 12 :
    ageH <= 24  ? 8  :
    ageH <= 168 ? 4  :  // 7 days
    1

  // ── Sum + clamp ───────────────────────────────────────────────────────────
  const raw   = severityScore + reliabilityScore + corroborationScore + recencyScore
  const score = Math.min(100, Math.max(0, Math.round(raw)))

  // ── Level thresholds ──────────────────────────────────────────────────────
  const level: RiskScoreResult['level'] =
    score >= 75 ? 'critical' :
    score >= 50 ? 'high'     :
    score >= 25 ? 'medium'   :
    'low'

  const levelLabel = level.charAt(0).toUpperCase() + level.slice(1)
  const label = `${levelLabel} Risk · ${score}`

  return {
    score,
    level,
    factors: { severityScore, reliabilityScore, corroborationScore, recencyScore },
    label,
  }
}
