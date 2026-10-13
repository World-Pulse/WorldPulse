/**
 * A story's share picture as a PNG response (plan G3): reads the story and
 * its outlet count from the API and draws lib/story-card.tsx. Used by
 * app/signals/[id]/opengraph-image.tsx and twitter-image.tsx.
 */

import { ImageResponse } from 'next/og'
import { CARD_SIZE, StoryCard, cardFonts, storyCardText, type CardOutlets, type CardStory } from './story-card'
import { cachedFetch } from './server-fetch'

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'https://api.world-pulse.io'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The answer and its HTTP status (0 when the API couldn't be reached) */
async function getJson<T>(path: string): Promise<{ status: number; body: T | null }> {
  try {
    const res = await cachedFetch(`${API_URL}${path}`, 120_000, 8_000)
    return { status: res.status, body: res.ok ? await res.json() as T : null }
  } catch {
    return { status: 0, body: null }
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
    // The API didn't answer (down, overloaded): fail rather than draw the
    // plain card, which X, LinkedIn and the image cache would keep for a story
    // that exists (Oct 12, 2026). A story that doesn't exist gets the plain card.
    if (!s.body && s.status !== 404 && s.status !== 400) throw new Error('Story card: the API did not answer')
    story = s.body?.data?.title ? s.body.data : null
    outlets = o.body?.data?.stories?.[id] ?? null
  }
  const fonts = await cardFonts()
  return new ImageResponse(<StoryCard text={story ? storyCardText(story, outlets) : null} />, {
    ...CARD_SIZE,
    ...(fonts.length ? { fonts } : {}),
  })
}
