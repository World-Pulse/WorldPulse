import { coverageGapCardImage } from '@/lib/coverage-gap-card-image'

// The picture a shared finished week shows (lib/coverage-gap.ts), redrawn at most every 10 minutes
export const alt = 'Under-reported crises: the countries with the most people displaced for the fewest news outlets'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const revalidate = 600

export default async function Image({ params }: { params: Promise<{ week: string }> }) {
  const { week } = await params
  return coverageGapCardImage(week)
}
