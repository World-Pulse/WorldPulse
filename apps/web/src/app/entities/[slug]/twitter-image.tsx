import { entityCardImage } from '@/lib/entity-card-image'

// (the same picture as opengraph-image.tsx, for X's card)
export const alt = 'WorldPulse: how often they are in the news, and the most-reported story naming them'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const revalidate = 600

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return entityCardImage(slug)
}
