/**
 * A score as a number (V3f, Oct 20, 2026): signals.reliability_score is a
 * Postgres decimal, which the driver hands over as text, so most of the API
 * answered "reliabilityScore": "0.925" while /public/signals and the stories
 * answered 0.925. Null when there is no score.
 */
export function scoreOf(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
