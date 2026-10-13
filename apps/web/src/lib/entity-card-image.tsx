/**
 * An entity page's share picture as a PNG response (Oct 13, 2026): reads the
 * entity's profile from the API and draws lib/entity-card.tsx. Used by
 * app/entities/[slug]/opengraph-image.tsx and twitter-image.tsx.
 */

import { ImageResponse } from 'next/og'
import { CARD_SIZE, StoryCard, cardFonts } from './story-card'
import { EntityCard, entityCardText, type CardProfile } from './entity-card'
import { entityIdFromSlug } from './entity-links'
import { cachedFetch } from './server-fetch'

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'https://api.world-pulse.io'

export async function entityCardImage(slug: string): Promise<ImageResponse> {
  const id = entityIdFromSlug(slug)
  let profile: CardProfile | null = null
  if (id) {
    let status = 0
    try {
      const res = await cachedFetch(`${API_URL}/api/v1/knowledge-graph/entities/${encodeURIComponent(id)}/profile`, 120_000, 8_000)
      status = res.status
      if (res.ok) profile = ((await res.json()) as { data?: CardProfile }).data ?? null
    } catch { /* status stays 0 */ }
    // The API didn't answer: fail rather than draw the plain card, which link
    // previews would keep (as story cards do, lib/story-card-image.tsx)
    if (!profile && status !== 404) throw new Error('Entity card: the API did not answer')
  }
  const fonts = await cardFonts()
  const opts = { ...CARD_SIZE, ...(fonts.length ? { fonts } : {}) }
  return profile
    ? new ImageResponse(<EntityCard text={entityCardText(profile)} />, opts)
    : new ImageResponse(<StoryCard text={null} />, opts)
}
