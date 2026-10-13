import { directoryCardImage } from '@/lib/directory-card-image'

// (the same picture as opengraph-image.tsx, for X's card)
export const alt = 'WorldPulse: who was in the news this week, the most-reported people, places and organizations'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const dynamic = 'force-dynamic'

export default async function Image() {
  return directoryCardImage()
}
