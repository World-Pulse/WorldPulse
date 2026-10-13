import { directoryCardImage } from '@/lib/directory-card-image'

// The picture a shared world-pulse.io/entities link shows: who was in the news
// this week (lib/directory-card.tsx). Drawn when asked, not at build time: the
// build has no API to read (the API keeps the list for 30 minutes).
export const alt = 'WorldPulse: who was in the news this week, the most-reported people, places and organizations'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const dynamic = 'force-dynamic'

export default async function Image() {
  return directoryCardImage()
}
