/**
 * world-pulse.io/map's share picture as a PNG response (plan M29, Oct 15,
 * 2026): reads the day's counts and map points from the API and draws
 * lib/map-card.tsx. Used by app/map/opengraph-image.tsx and twitter-image.tsx.
 */

import { ImageResponse } from 'next/og'
import { CARD_SIZE, StoryCard, cardFonts } from './story-card'
import { MapCard, mapCardText, type MapDay, type MapPoint } from './map-card'
import { cachedFetch } from './server-fetch'

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'https://api.world-pulse.io'

async function getData<T>(path: string): Promise<T | null> {
  try {
    const res = await cachedFetch(`${API_URL}${path}`, 120_000, 8_000)
    if (!res.ok) return null
    const json = await res.json() as { data?: T }
    return json.data ?? null
  } catch {
    return null
  }
}

export async function mapCardImage(): Promise<ImageResponse> {
  const [day, points] = await Promise.all([
    getData<MapDay>('/api/v1/signals/count'),
    getData<MapPoint[]>('/api/v1/signals/map/points?hours=24&limit=3000&lean=1'),
  ])
  // The API didn't answer: fail rather than draw the plain card, which link
  // previews would keep (as the story and entity cards do)
  if (!day) throw new Error('Map card: the API did not answer')
  const text = mapCardText(day, Array.isArray(points) ? points : [])
  const fonts = await cardFonts()
  const opts = { ...CARD_SIZE, ...(fonts.length ? { fonts } : {}) }
  return text
    ? new ImageResponse(<MapCard text={text} />, opts)
    : new ImageResponse(<StoryCard text={null} />, opts)
}
