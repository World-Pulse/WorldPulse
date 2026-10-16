/**
 * What a country page's share picture says (plan G15 slice 3, Oct 16, 2026).
 * It is drawn by the entity card (lib/entity-card.tsx): the country's name,
 * its verified stories this week and in the last 24 hours, 12 two-hour bars
 * and its newest verified story. Kept apart from the drawing so it can be tested.
 */

import { clip } from './story-card'
import type { EntityCardText } from './entity-card'

export interface CardCountry {
  name: string
  total_signals: number
  recent_signals: Array<{ title?: string; source_count?: number | string | null }>
  hourly_trend: Array<{ hour: string; count: number }>
}

export function countryCardText(c: CardCountry): EntityCardText {
  const name = clip(c.name, 60)
  const lead = c.recent_signals.find(s => typeof s.title === 'string' && s.title.length > 0)
  const sources = Number(lead?.source_count) || 0
  // 24 hourly counts, newest last, folded into 12 two-hour bars
  const hours = c.hourly_trend.slice(-24).map(h => Number(h.count) || 0)
  const bars: number[] = []
  for (let i = 0; i < hours.length; i += 2) bars.push((hours[i] ?? 0) + (hours[i + 1] ?? 0))
  const last24h = hours.reduce((a, b) => a + b, 0)
  return {
    name,
    nameSize: name.length <= 14 ? 112 : name.length <= 24 ? 92 : name.length <= 36 ? 72 : 58,
    kind: 'COUNTRY',
    counts: `${c.total_signals.toLocaleString('en-US')} verified ${c.total_signals === 1 ? 'story' : 'stories'} this week · ${last24h.toLocaleString('en-US')} in 24 hours`,
    bars,
    story: lead?.title ? clip(lead.title, 90) : null,
    proof: lead ? (sources > 1 ? `Verified · ${sources} sources` : 'Verified') : null,
    verified: true,
  }
}
