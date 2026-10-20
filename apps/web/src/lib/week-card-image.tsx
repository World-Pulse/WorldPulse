/**
 * A "WorldPulse Week" link's share picture as a PNG response (plan G11
 * slice 1): reads the week from the API and draws it with the entity card.
 * Used by app/week/(…)/opengraph-image.tsx and twitter-image.tsx.
 */

import { ImageResponse } from 'next/og'
import { CARD_SIZE, StoryCard, cardFonts } from './story-card'
import { EntityCard } from './entity-card'
import { weekCardText } from './week-card'
import { fetchWeek } from './week-data'

export async function weekCardImage(name?: string): Promise<ImageResponse> {
  const data = await fetchWeek(name)
  // The API didn't answer: fail rather than draw the plain card, which link
  // previews would keep (as story and country cards do)
  if (data === 'unavailable') throw new Error('Week card: the API did not answer')
  const fonts = await cardFonts()
  const opts = { ...CARD_SIZE, ...(fonts.length ? { fonts } : {}) }
  return data === 'missing'
    ? new ImageResponse(<StoryCard text={null} />, opts)
    : new ImageResponse(<EntityCard text={weekCardText(data)} />, opts)
}
