import { weekCardImage } from '@/lib/week-card-image'

// The picture a shared finished week shows (lib/week-card.ts, plan G11), redrawn at most every 10 minutes
export const alt = "WorldPulse Week: the week's top verified stories, ranked by independent outlets"
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const revalidate = 600

export default async function Image({ params }: { params: Promise<{ week: string }> }) {
  const { week } = await params
  return weekCardImage(week)
}
