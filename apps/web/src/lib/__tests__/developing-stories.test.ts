import { describe, it, expect } from 'vitest'
import { toDevelopingStories, sinceLabel, outletBadge, localOutlets, namedOutlets, outletsTitle } from '../developing-stories'

const NOW = Date.parse('2026-10-11T07:00:00Z')

const story = {
  id: 's1', leadId: 'sig-1', title: 'Twelve killed and 300 injured in attack on airport in Riyadh', place: 'Riyadh',
  severity: 'high', size: 33, outlets: ['aljazeera.com', 'bbc.co.uk', 'apnews.com', 'dw.com', 'npr.org'],
  outletCount: 14, firstSeenAt: '2026-10-10T20:00:00Z', updatedAt: '2026-10-11T06:54:00Z', verifiedAt: '2026-10-10T21:00:00Z',
}

describe('toDevelopingStories', () => {
  it('reads the API answer and leaves out malformed stories', () => {
    const list = toDevelopingStories({ success: true, data: { stories: [
      story,
      { ...story, id: 's2', title: '   ' },
      { ...story, id: 's3', leadId: undefined },
      null,
      { ...story, id: 's4', outlets: ['a.com', 7, ''], outletCount: 'x', place: '' },
    ] } })
    expect(list.map(s => s.id)).toEqual(['s1', 's4'])
    expect(list[1]).toMatchObject({ outlets: ['a.com'], outletCount: 1, place: null })
  })

  it('returns nothing for an unexpected answer', () => {
    expect(toDevelopingStories(null)).toEqual([])
    expect(toDevelopingStories({ threads: [] })).toEqual([])
  })
})

describe('row text', () => {
  it('says how long ago', () => {
    expect(sinceLabel('2026-10-11T06:59:30Z', NOW)).toBe('just now')
    expect(sinceLabel('2026-10-11T06:48:00Z', NOW)).toBe('12m ago')
    expect(sinceLabel('2026-10-11T03:30:00Z', NOW)).toBe('3h ago')
    expect(sinceLabel('2026-10-08T07:00:00Z', NOW)).toBe('3d ago')
    expect(sinceLabel('', NOW)).toBe('')
  })

  it('badges verified stories with their outlet count', () => {
    expect(outletBadge(story)).toEqual({ label: '✓ Verified · 14 outlets', verified: true, count: '14 outlets' })
    expect(outletBadge({ outletCount: 2, verifiedAt: null })).toEqual({ label: '2 outlets', verified: false, count: '2 outlets' })
  })

  it('names a few outlets and counts the rest from the full total', () => {
    expect(namedOutlets(story)).toEqual({ names: ['aljazeera.com', 'bbc.co.uk', 'apnews.com'], more: 11 })
    expect(namedOutlets({ outlets: ['a.com', 'b.com'], outletCount: 2 })).toEqual({ names: ['a.com', 'b.com'], more: 0 })
  })

  it("says on hover that the names aren't all of them (the API sends at most 12)", () => {
    expect(outletsTitle({ outlets: ['a.com', 'b.com'], outletCount: 55 })).toBe("a.com, b.com and 53 more (all on the story's page)")
    expect(outletsTitle({ outlets: ['a.com', 'b.com'], outletCount: 2 })).toBe('a.com, b.com')
  })
})

describe("where a story's outlets are from (Nov 8, 2026)", () => {
  it('leads the badge with the countries, and names the story\'s own country\'s outlets', () => {
    const [s] = toDevelopingStories({ data: { stories: [{
      id: 'k', leadId: 'l', title: 'Poland in shock after six die in Krakow mass shooting', outletCount: 81, outlets: ['france24.com'],
      verifiedAt: '2026-11-08T07:00:00Z', country: 'PL', countries: 36, localOutlets: 2, localNames: ['Notes from Poland', 'Defence24'],
    }] } })
    expect(outletBadge(s!)).toEqual({ label: '✓ Verified · 81 outlets · 36 countries', verified: true, count: '81 outlets · 36 countries' })
    expect(localOutlets(s!)).toEqual({ label: '2 from Poland', title: 'Notes from Poland, Defence24: outlets from Poland, where the story is' })
    // an older answer: as before
    const [old] = toDevelopingStories({ data: { stories: [{ id: 'k', leadId: 'l', title: 'A story', outletCount: 3, verifiedAt: null }] } })
    expect(old!.reach).toBeUndefined()
    expect(outletBadge(old!)).toEqual({ label: '3 outlets', verified: false, count: '3 outlets' })
    expect(localOutlets(old!)).toBeNull()
  })
})
