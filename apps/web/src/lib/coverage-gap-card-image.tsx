/**
 * An under-reported crises link's share picture as a PNG response (Oct 21,
 * 2026): the least covered crisis, one bar per crisis (its outlets), drawn
 * with the entity card. Used by app/under-reported/(…)/opengraph-image.tsx
 * and twitter-image.tsx.
 */

import { ImageResponse } from 'next/og'
import { CARD_SIZE, StoryCard, cardFonts } from './story-card'
import { EntityCard } from './entity-card'
import { fetchCoverageGap, gapCardText } from './coverage-gap'

export async function coverageGapCardImage(week?: string): Promise<ImageResponse> {
  const data = await fetchCoverageGap(week)
  // The API didn't answer: fail rather than draw the plain card, which link previews would keep
  if (data === 'unavailable') throw new Error('Coverage gap card: the API did not answer')
  const fonts = await cardFonts()
  const opts = { ...CARD_SIZE, ...(fonts.length ? { fonts } : {}) }
  return data === 'missing'
    ? new ImageResponse(<StoryCard text={null} />, opts)
    : new ImageResponse(<EntityCard text={gapCardText(data)} />, opts)
}
