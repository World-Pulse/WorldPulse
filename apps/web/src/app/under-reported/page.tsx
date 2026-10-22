import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'
import { fetchCoverageGap, gapTitle, gapDescription } from '@/lib/coverage-gap'
import { CoverageGapView } from '@/components/under-reported/CoverageGapView'

// Under-reported crises, the last 7 days (the coverage gap, Oct 21, 2026).
// Finished weeks live at /under-reported/<YYYY>-W<ww>.

class CoverageGapUnavailableError extends Error {
  constructor() { super('The coverage gap could not be loaded: the API did not answer'); this.name = 'CoverageGapUnavailableError' }
}

export async function generateMetadata(): Promise<Metadata> {
  const data = await fetchCoverageGap()
  // The picture is the list's own card (opengraph-image.tsx, twitter-image.tsx)
  if (data === 'missing' || data === 'unavailable') {
    return pageMetadata({ path: '/under-reported', title: 'Under-reported crises this week', description: 'The countries where at least a million people are displaced, ranked by how few news outlets reported on them this week.', image: null })
  }
  return pageMetadata({ path: '/under-reported', title: gapTitle(data), description: gapDescription(data), image: null })
}

export default async function Page() {
  const data = await fetchCoverageGap()
  if (data === 'missing' || data === 'unavailable') throw new CoverageGapUnavailableError()
  return <CoverageGapView data={data} />
}
