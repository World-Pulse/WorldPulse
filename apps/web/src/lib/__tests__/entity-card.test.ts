/**
 * What an entity page's share picture says (lib/entity-card.tsx, Oct 13, 2026).
 */
import { describe, it, expect } from 'vitest'
import { entityCardText } from '../entity-card'

const daily = Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(14 + i).padStart(2, '0')}`, n: i >= 27 ? 100 + i : 0 }))

describe('entityCardText', () => {
  it('names the entity, its counts, 14 days of bars and its most-reported story', () => {
    const t = entityCardText({
      entity: { name: 'Houthis', type: 'organisation' },
      activity: { last24h: 105, last7d: 218, daily },
      stories: [{ title: 'Saudi warning system stayed silent before deadly airport attacks', outletCount: 101, verifiedAt: '2026-10-13T02:00:00Z' }],
    })
    expect(t).toMatchObject({ name: 'Houthis', kind: 'ORGANIZATION', counts: '105 reports in 24 hours · 218 this week', verified: true, proof: 'Verified · 101 outlets' })
    expect(t.bars).toHaveLength(14)
    expect(t.nameSize).toBe(112)
  })

  it('works without a story and shrinks long names', () => {
    const t = entityCardText({
      entity: { name: 'International Committee of the Red Cross', type: 'organisation' },
      activity: { last24h: 1, last7d: 3, daily },
      stories: [],
    })
    expect(t).toMatchObject({ story: null, proof: null, verified: false, counts: '1 report in 24 hours · 3 this week' })
    expect(t.nameSize).toBeLessThan(92)
  })
})
