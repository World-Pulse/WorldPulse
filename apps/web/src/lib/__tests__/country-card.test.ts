/**
 * What a country page's share picture says (lib/country-card.ts, Oct 16, 2026).
 */
import { describe, it, expect } from 'vitest'
import { countryCardText } from '../country-card'

const hourly = Array.from({ length: 24 }, (_, i) => ({ hour: `2026-10-16T${String(i).padStart(2, '0')}:00:00Z`, count: i === 23 ? 5 : 1 }))

describe('countryCardText', () => {
  it('names the country, its counts, 12 bars and the newest verified story', () => {
    const t = countryCardText({
      name: 'Sudan',
      total_signals: 42,
      recent_signals: [{ title: 'Ceasefire talks resume in Jeddah', source_count: 6 }],
      hourly_trend: hourly,
    })
    expect(t).toMatchObject({ name: 'Sudan', kind: 'COUNTRY', counts: '42 verified stories this week · 28 in 24 hours', proof: 'Verified · 6 sources', verified: true })
    expect(t.bars).toHaveLength(12)
    expect(t.bars[11]).toBe(6)
  })

  it('says "story" for one and works without stories or an hourly trend', () => {
    const t = countryCardText({ name: 'Liechtenstein', total_signals: 1, recent_signals: [], hourly_trend: [] })
    expect(t).toMatchObject({ story: null, proof: null, counts: '1 verified story this week · 0 in 24 hours', bars: [] })
  })
})
