/**
 * world-pulse.io/entities' share picture as a PNG response (Oct 13, 2026):
 * reads the directory from the API and draws lib/directory-card.tsx. Used by
 * app/entities/opengraph-image.tsx and twitter-image.tsx.
 */

import { ImageResponse } from 'next/og'
import { CARD_SIZE, StoryCard, cardFonts } from './story-card'
import { DirectoryCard, directoryCardText } from './directory-card'
import { fetchDirectory } from './entity-directory'

export async function directoryCardImage(): Promise<ImageResponse> {
  const directory = await fetchDirectory()
  // The API didn't answer: fail rather than draw the plain card, which link
  // previews would keep (as story and entity cards do)
  if (!directory) throw new Error('Directory card: the API did not answer')
  const text = directoryCardText(directory)
  const fonts = await cardFonts()
  const opts = { ...CARD_SIZE, ...(fonts.length ? { fonts } : {}) }
  return text
    ? new ImageResponse(<DirectoryCard text={text} />, opts)
    : new ImageResponse(<StoryCard text={null} />, opts)
}
