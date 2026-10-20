import { describe, it, expect } from 'vitest'
import { weekCardText } from '../week-card'

// The share picture of a "WorldPulse Week" link (plan G11 slice 1)

const story = (title: string, outletCount: number, verifiedAt: string | null = '2026-10-13T21:00:00Z') =>
  ({ id: title, leadId: title, title, place: null, category: null, severity: 'high', outletCount, verifiedAt })

describe('weekCardText', () => {
  it("names the week's dates, the ranking, a bar per top story and the top story's outlets", () => {
    const t = weekCardText({ start: '2026-10-12T00:00:00.000Z', underWay: false, stories: [story('Ceasefire talks resume in Doha', 14), story('Typhoon makes landfall in Luzon', 9)] })
    expect(t.name).toBe('Oct 12–18')
    expect(t.kind).toBe('WORLDPULSE WEEK')
    expect(t.counts).toBe('2026 · the top 2 stories, ranked by independent outlets')
    expect(t.bars).toEqual([14, 9])
    expect(t.story).toBe('Ceasefire talks resume in Doha')
    expect(t.proof).toBe('Verified · 14 outlets')
    expect(t.verified).toBe(true)
  })
  it('says when the week is under way, and when no story had two outlets', () => {
    const t = weekCardText({ start: '2026-10-19T00:00:00.000Z', underWay: true, stories: [] })
    expect(t.kind).toBe('WORLDPULSE WEEK · SO FAR')
    expect(t.counts).toBe('2026 · no story two outlets reported yet')
    expect(t.story).toBeNull()
    expect(t.bars).toEqual([])
  })
  it("gives the year a week ends in, and doesn't call an unverified story verified", () => {
    const t = weekCardText({ start: '2026-12-28T00:00:00.000Z', underWay: false, stories: [story('A storm', 3, null)] })
    expect(t.name).toBe('Dec 28–Jan 3')
    expect(t.counts).toMatch(/^2027 · the top story/)
    expect(t.proof).toBe('3 outlets')
    expect(t.verified).toBe(false)
  })
})
