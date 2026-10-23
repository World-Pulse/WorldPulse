import Link from 'next/link'
import { fetchCoverageGap, people, plural } from '@/lib/coverage-gap'

/**
 * The home page's small look at the coverage gap (plan N7, Oct 23, 2026): the
 * three crises /under-reported ranks first this week, each with the people
 * UNHCR counts displaced and the outlets WorldPulse found reporting on it, as
 * the API gives them. Nothing shows when the API doesn't answer.
 */
export async function UnderReportedStrip() {
  const data = await fetchCoverageGap()
  if (data === 'missing' || data === 'unavailable') return null
  const top = data.crises.slice(0, 3)
  if (top.length === 0) return null
  return (
    <p className="border-b border-[rgba(255,255,255,0.07)] bg-wp-bg px-4 py-2 text-center text-xs text-wp-text">
      <span className="text-wp-cyan">Under-reported this week</span>
      {top.map(c => (
        <span key={c.code}> · {c.name}: {people(c.displaced)} displaced, {plural(c.outlets, 'outlet')}</span>
      ))}
      {' · '}
      <Link href="/under-reported" className="underline underline-offset-2 hover:text-wp-cyan">See all {data.crises.length}</Link>
    </p>
  )
}
