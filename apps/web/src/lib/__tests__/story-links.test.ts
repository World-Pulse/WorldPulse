/**
 * Links from a story page to its country and entity pages (plan G16 slice 4).
 */
import { describe, it, expect } from 'vitest'
import { countryLink, entityLinks } from '../story-links'

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
