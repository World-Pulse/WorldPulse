import { entityCardImage } from '@/lib/entity-card-image'

// The picture a shared entity page shows (lib/entity-card.tsx). Redrawn at
// most every 10 minutes: the counts and the top story change.
export const alt = 'WorldPulse: how often they are in the news, and the most-reported story naming them'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const revalidate = 600

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return entityCardImage(slug)
}
