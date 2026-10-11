import { storyCardImage } from '@/lib/story-card-image'

// The picture a shared story link shows (plan G3, lib/story-card.tsx).
// Redrawn at most every 10 minutes: verification and outlet counts change.
export const alt = 'WorldPulse: the story, where it happened and how many outlets confirm it'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const revalidate = 600

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return storyCardImage(id)
}
