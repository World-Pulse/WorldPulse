import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { pageMetadata } from '@/lib/page-metadata'
import { fetchCoverageGap, gapTitle, gapDescription } from '@/lib/coverage-gap'
import { WEEK_RE, isoWeekName } from '@/lib/week'
import { CoverageGapView } from '@/components/under-reported/CoverageGapView'

// Under-reported crises in a finished week, e.g. /under-reported/2026-W42.
// The week under way has no edition yet: it redirects to the last 7 days.

class CoverageGapUnavailableError extends Error {
  constructor() { super('The coverage gap could not be loaded: the API did not answer'); this.name = 'CoverageGapUnavailableError' }
}

export async function generateMetadata({ params }: { params: Promise<{ week: string }> }): Promise<Metadata> {
  const { week } = await params
  if (!WEEK_RE.test(week)) return { title: 'Not found — WorldPulse', robots: { index: false } }
  const data = await fetchCoverageGap(week)
  if (data === 'missing') return { title: 'Not found — WorldPulse', robots: { index: false } }
  if (data === 'unavailable') return { title: 'Under-reported crises' }
  // The picture is the week's own card (opengraph-image.tsx, twitter-image.tsx)
  return pageMetadata({ path: `/under-reported/${week}`, title: gapTitle(data), description: gapDescription(data), image: null })
}

export default async function Page({ params }: { params: Promise<{ week: string }> }) {
  const { week } = await params
  if (!WEEK_RE.test(week)) notFound()
  if (week === isoWeekName(new Date())) redirect('/under-reported')
  const data = await fetchCoverageGap(week)
  if (data === 'missing') notFound()
  if (data === 'unavailable') throw new CoverageGapUnavailableError()
  return <CoverageGapView data={data} />
}
