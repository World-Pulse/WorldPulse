/**
 * A country page's share picture as a PNG response (plan G15 slice 3): reads
 * the country from the API and draws it with the entity card. Used by
 * app/countries/[code]/opengraph-image.tsx and twitter-image.tsx.
 */

import { ImageResponse } from 'next/og'
import { CARD_SIZE, StoryCard, cardFonts } from './story-card'
import { EntityCard } from './entity-card'
import { countryCardText, type CardCountry } from './country-card'
import { cachedFetch } from './server-fetch'

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'https://api.world-pulse.io'

export async function countryCardImage(code: string): Promise<ImageResponse> {
  let country: CardCountry | null = null
  if (/^[A-Za-z]{2}$/.test(code)) {
    let status = 0
    try {
      const res = await cachedFetch(`${API_URL}/api/v1/countries/${code.toUpperCase()}?window=7d&limit=5`, 120_000, 8_000)
      status = res.status
      if (res.ok) {
        const json = await res.json() as Partial<CardCountry>
        if (json.name) {
          country = {
            name: json.name,
            total_signals: Number(json.total_signals) || 0,
            recent_signals: json.recent_signals ?? [],
            hourly_trend: json.hourly_trend ?? [],
          }
        }
      }
    } catch { /* status stays 0 */ }
    // The API didn't answer: fail rather than draw the plain card, which link
    // previews would keep (as story cards do, lib/story-card-image.tsx)
    if (!country && status !== 404 && status !== 400) throw new Error('Country card: the API did not answer')
  }
  const fonts = await cardFonts()
  const opts = { ...CARD_SIZE, ...(fonts.length ? { fonts } : {}) }
  return country
    ? new ImageResponse(<EntityCard text={countryCardText(country)} />, opts)
    : new ImageResponse(<StoryCard text={null} />, opts)
}
