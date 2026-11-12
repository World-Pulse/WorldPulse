import { mapDayCardImage } from '@/lib/map-day-card-image'

// The picture a morning video's own link shows: that video's reports, outlets and countries
// (lib/map-day-card.tsx, Nov 12, 2026). Kept 10 minutes; the live map card until the video exists.
export const alt = 'WorldPulse, the world in 30 seconds: the reports, outlets and countries in that morning’s video'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const revalidate = 600

export default async function Image({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params
  return mapDayCardImage(date)
}
