/**
 * Links from a story page to its country and entity pages (plan G16 slice 4).
 */
import { describe, it, expect } from 'vitest'
import { countryLink, entityLinks, weekLink } from '../story-links'

describe('countryLink', () => {
  it('points at the upper-case country page', () => {
    expect(countryLink('sd')?.href).toBe('/countries/SD')
  })
  it('has nothing for a missing or malformed code', () => {
    expect(countryLink(null)).toBeNull()
    expect(countryLink('')).toBeNull()
    expect(countryLink('USA')).toBeNull()
    expect(countryLink('../')).toBeNull()
  })
})

describe('entityLinks', () => {
  it('links each entity once, at most max', () => {
    const links = entityLinks([
      { id: 'a84d671cb97c1d91', name: 'Houthis' },
      { id: 'a84d671cb97c1d91', name: 'Houthis' },
      { id: 'b84d671cb97c1d92', name: ' Red Sea ' },
      { id: 'c84d671cb97c1d93', name: 'UN' },
    ], 2)
    expect(links).toEqual([
      { href: '/entities/houthis-a84d671cb97c1d91', label: 'Houthis' },
      { href: '/entities/red-sea-b84d671cb97c1d92', label: 'Red Sea' },
    ])
  })
  it('skips entries without an id or a name', () => {
    expect(entityLinks([{ name: 'X' }, { id: 'abcd1234', name: '' }, { id: 5, name: 'Y' }])).toEqual([])
    expect(entityLinks(undefined)).toEqual([])
  })
})

describe('weekLink (G21, Oct 20, 2026)', () => {
  const now = new Date('2026-10-20T17:00:00Z')   // a Tuesday in 2026-W43
  it('is /week while the story\'s week is under way', () => {
    expect(weekLink('2026-10-19T00:30:00Z', now)).toEqual({ href: '/week', label: 'this week (Oct 19–25, 2026)' })
  })
  it("is the finished week's own page after that", () => {
    expect(weekLink('2026-10-18T23:59:00Z', now)).toEqual({ href: '/week/2026-W42', label: 'Oct 12–18, 2026' })
    expect(weekLink('2026-09-30T08:00:00Z', now)?.href).toBe('/week/2026-W40')
  })
  it('has none without a sensible time', () => {
    expect(weekLink(null, now)).toBeNull()
    expect(weekLink('not a date', now)).toBeNull()
    expect(weekLink('2026-11-30T00:00:00Z', now)).toBeNull()
  })
})
