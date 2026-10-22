import { coverageGapCardImage } from '@/lib/coverage-gap-card-image'

// The picture a shared world-pulse.io/under-reported link shows: the least
// covered crisis of the last 7 days (lib/coverage-gap.ts). Drawn when asked,
// not at build time (the build has no API).
export const alt = 'Under-reported crises: the countries with the most people displaced for the fewest news outlets'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const dynamic = 'force-dynamic'

export default async function Image() {
  return coverageGapCardImage()
}
