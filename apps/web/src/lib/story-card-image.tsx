/**
 * A story's share picture as a PNG response (plan G3): reads the story and
 * its outlet count from the API and draws lib/story-card.tsx. Used by
 * app/signals/[id]/opengraph-image.tsx and twitter-image.tsx.
 */

import { ImageResponse } from 'next/og'
import { CARD_SIZE, StoryCard, cardFonts, storyCardText, type CardOutlets, type CardStory } from './story-card'

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'https://api.world-pulse.io'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { next: { revalidate: 600 }, signal: AbortSignal.timeout(8_000) })
    return res.ok ? await res.json() as T : null
  } catch {
    return null
  }
}

export async function storyCardImage(id: string): Promise<ImageResponse> {
  let story: CardStory | null = null
  let outlets: CardOutlets | null = null
  if (UUID_RE.test(id)) {
    const [s, o] = await Promise.all([
      getJson<{ data?: CardStory }>(`/api/v1/signals/${id}`),
      getJson<{ data?: { stories?: Record<string, CardOutlets> } }>(`/api/v1/stories/outlets?ids=${id}`),
    ])
    story = s?.data?.title ? s.data : null
    outlets = o?.data?.stories?.[id] ?? null
  }
  const fonts = await cardFonts()
  return new ImageResponse(<StoryCard text={story ? storyCardText(story, outlets) : null} />, {
    ...CARD_SIZE,
    ...(fonts.length ? { fonts } : {}),
  })
}
