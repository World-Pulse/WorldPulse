import { weekCardImage } from '@/lib/week-card-image'

// The picture a shared world-pulse.io/week link shows: the week so far and its
// top story (lib/week-card.ts, plan G11). Drawn when asked, not at build time
// (the build has no API).
export const alt = "WorldPulse Week: this week's top verified stories, ranked by independent outlets"
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const dynamic = 'force-dynamic'

export default async function Image() {
  return weekCardImage()
}
