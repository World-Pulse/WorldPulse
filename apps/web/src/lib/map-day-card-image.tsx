/**
 * A morning video's own share picture as a PNG response (world-pulse.io/map/day/<date>, Nov 12, 2026):
 * reads the card the recorder saved beside that day's video and draws lib/map-day-card.tsx. Before the
 * video exists, or for a day without one, it is the live map card (lib/map-card-image.tsx).
 */

import { ImageResponse } from 'next/og'
import { CARD_SIZE, cardFonts } from './story-card'
import { MapDayCard, dayCardText, parseDay, readDayCard, type DayCard } from './map-day-card'
import { mapCardImage } from './map-card-image'
import { cachedFetch } from './server-fetch'
import { SITE_URL } from './page-metadata'

/** The numbers that were on screen in that day's video, or null (no video that day, or not yet) */
export async function fetchDayCard(date: string): Promise<DayCard | null> {
  const day = parseDay(date)
  if (!day) return null
  try {
    // (kept 2 minutes: a "not there yet" at 5:40 AM must not outlive the video's arrival by long)
    const res = await cachedFetch(`${SITE_URL}/uploads/video/world-in-60s-${day}.json`, 120_000, 8_000)
    if (!res.ok) return null
    return readDayCard(await res.json(), day)
  } catch {
    return null
  }
}

export async function mapDayCardImage(date: string): Promise<ImageResponse> {
  const card = await fetchDayCard(date)
  if (!card) return mapCardImage()
  const fonts = await cardFonts()
  return new ImageResponse(<MapDayCard text={dayCardText(card)} />, { ...CARD_SIZE, ...(fonts.length ? { fonts } : {}) })
}
