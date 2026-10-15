import { mapCardImage } from '@/lib/map-card-image'

// The picture a shared world-pulse.io/map link shows: today's verified
// stories, outlets and busiest places (lib/map-card.tsx, plan M29). Drawn
// when asked and kept 10 minutes; not at build time (the build has no API).
export const alt = 'WorldPulse live world map: verified stories, outlets and the busiest places in the last 24 hours'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const dynamic = 'force-dynamic'

export default async function Image() {
  return mapCardImage()
}
