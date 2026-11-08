/**
 * Where a story's outlets are from (Nov 8, 2026): how many countries ("81 outlets · 36 countries") and how many
 * are newsrooms of the story's own country ("2 from Poland"), as the feed card, the story page, the home page
 * and the map's closing card show them (lib/story-reach.ts; the API counts them, apps/api/src/lib/outlets.ts).
 */

import { describe, it, expect } from 'vitest'
import { countryLabel, reachOf, countriesLabel, localLabel } from '@/lib/story-reach'
import { storyOf, storyBadge } from '@/components/feed/StoryOutlets'
import { timelineReach } from '@/app/signals/[id]/StoryMembers'

describe('countryLabel', () => {
  it('names a country as a sentence says it', () => {
    expect(countryLabel('PL')).toBe('Poland')
    expect(countryLabel('us')).toBe('the United States')
    expect(countryLabel('US', false)).toBe('United States')
    expect(countryLabel('GB')).toBe('the United Kingdom')
    expect(countryLabel('CD')).toBe('DR Congo')
    expect(countryLabel('TR')).toBe('Turkey')
  })

  it('is null for what is not a country code', () => {
    expect(countryLabel(null)).toBeNull()
    expect(countryLabel('Poland')).toBeNull()
    expect(countryLabel('')).toBeNull()
  })
})

describe('reachOf', () => {
  it("reads the API's fields, and drops what doesn't add up", () => {
    expect(reachOf('PL', 36, 2, ['Defence24', 'Notes from Poland'])).toEqual({ country: 'PL', countries: 36, local: 2, localNames: ['Defence24', 'Notes from Poland'] })
    // no country: no local outlets; at most three names
    expect(reachOf(null, 5, 2, ['a'])).toEqual({ country: null, countries: 5, local: 0, localNames: [] })
    expect(reachOf('GB', 4, 5, ['a', 'b', 'c', 'd'])?.localNames).toEqual(['a', 'b', 'c'])
    // an older API (nothing sent), or nothing known
    expect(reachOf(undefined, undefined, undefined, undefined)).toBeNull()
    expect(reachOf('PL', 0, 0, [])).toBeNull()
    expect(reachOf('pl', 'x', -1, 'Defence24')).toBeNull()
  })
})

describe('the labels', () => {
  it('say the countries from two on', () => {
    expect(countriesLabel({ countries: 36 })).toBe('36 countries')
    expect(countriesLabel({ countries: 1 })).toBeNull()
    expect(countriesLabel(null)).toBeNull()
  })

  it("say the story's own country's outlets, with their names on hover", () => {
    expect(localLabel({ country: 'PL', countries: 36, local: 2, localNames: ['Defence24', 'Notes from Poland'] })).toEqual({
      label: '2 from Poland', long: '2 outlets from Poland', names: 'Defence24, Notes from Poland',
      title: 'Defence24, Notes from Poland: outlets from Poland, where the story is',
    })
    expect(localLabel({ country: 'US', countries: 3, local: 5, localNames: ['AP', 'CNN', 'NPR'] })).toMatchObject({
      label: '5 from the United States', names: 'AP, CNN, NPR and 2 more',
    })
    expect(localLabel({ country: 'KE', countries: 2, local: 1, localNames: [] })).toEqual({
      label: '1 from Kenya', long: '1 outlet from Kenya', names: '', title: 'an outlet from Kenya, where the story is',
    })
    expect(localLabel({ country: 'PL', countries: 36, local: 0, localNames: [] })).toBeNull()
    expect(localLabel(null)).toBeNull()
  })
})

describe('the feed card', () => {
  it('leads with how far the story reached: "Verified · 81 outlets · 36 countries"', () => {
    const s = storyOf({
      storyId: 'S1', storySize: 120, storyOutlets: ['defence24.com', 'notesfrompoland.com'], storyOutletCount: 81,
      storyVerifiedAt: '2026-11-08T07:00:00Z', storyCountry: 'PL', storyCountries: 36, storyLocalOutlets: 2,
      storyLocalNames: ['Defence24', 'Notes from Poland'],
    })!
    expect(s.reach).toEqual({ country: 'PL', countries: 36, local: 2, localNames: ['Defence24', 'Notes from Poland'] })
    expect(storyBadge(s)?.label).toBe('Verified · 81 outlets · 36 countries')
    expect(storyBadge({ ...s, verifiedAt: null }, 'pending')?.label).toBe('81 outlets · 36 countries')
  })

  it('says what it said before when the API sends no countries, or one', () => {
    const old = storyOf({ storyId: 'S1', storyOutlets: ['a.com', 'b.com', 'c.com'], storyVerifiedAt: '2026-11-08T07:00:00Z' })!
    expect(old.reach).toBeUndefined()
    expect(storyBadge(old)?.label).toBe('Verified · 3 outlets')
    const one = storyOf({ storyId: 'S1', storyOutlets: ['a.com', 'b.com'], storyCountries: 1, storyCountry: 'KE', storyLocalOutlets: 2 })!
    expect(storyBadge(one)?.label).toBe('2 outlets')
  })
})

describe("the story page's timeline", () => {
  const base = { storyId: 'a', size: 3, verifiedAt: null, signals: [] }

  it("reads the whole life's reach, as the timeline counts its outlets", () => {
    expect(timelineReach({ ...base, country: 'PL', outletCountries: 30, localOutlets: 2, localOutletNames: ['Defence24'],
      outletCountriesAll: 36, localOutletsAll: 3, localOutletNamesAll: ['Defence24', 'TVP', 'Notes from Poland'] }))
      .toEqual({ country: 'PL', countries: 36, local: 3, localNames: ['Defence24', 'TVP', 'Notes from Poland'] })
    // the last two days' when the API sends only those; nothing from an older API
    expect(timelineReach({ ...base, country: 'PL', outletCountries: 30, localOutlets: 2, localOutletNames: ['Defence24'] }))
      .toEqual({ country: 'PL', countries: 30, local: 2, localNames: ['Defence24'] })
    expect(timelineReach(base)).toBeNull()
  })
})
