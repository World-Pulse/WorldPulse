import { describe, it, expect } from 'vitest'
import {
  pointInRing, featureContains, countryCodeOf, countryNameOf, flagEmoji, findCountry, focusBboxOf,
  type CountryFeature, type CountryCollection,
} from '../country-shapes'

const square = (w: number, s: number, e: number, n: number) => [[w, s], [e, s], [e, n], [w, n], [w, s]]
const country = (props: Record<string, unknown>, geometry: CountryFeature['geometry']): CountryFeature =>
  ({ type: 'Feature', properties: props, geometry })

describe('point in country', () => {
  const donut = country({ iso_a2: 'ZA' }, { type: 'Polygon', coordinates: [square(0, 0, 10, 10), square(4, 4, 6, 6)] })  // a hole, like Lesotho in South Africa
  const islands = country({ iso_a2: 'ID' }, { type: 'MultiPolygon', coordinates: [[square(0, 0, 2, 2)], [[[5, 5], [7, 5], [6, 7], [5, 5]]]] })

  it('finds points inside, not in holes or outside', () => {
    expect(pointInRing(1, 1, square(0, 0, 2, 2))).toBe(true)
    expect(featureContains(donut, 2, 2)).toBe(true)
    expect(featureContains(donut, 5, 5)).toBe(false)     // in the hole
    expect(featureContains(donut, 11, 5)).toBe(false)
    expect(featureContains(islands, 6, 5.5)).toBe(true)   // the second island
    expect(featureContains(islands, 4, 4)).toBe(false)
  })

  it('picks the country under the click', () => {
    const shapes: CountryCollection = { type: 'FeatureCollection', features: [islands, donut] }
    expect(findCountry(shapes, 9, 9)?.code).toBe('ZA')
    expect(findCountry(shapes, 50, 50)).toBeNull()
  })
})

describe('country codes and names', () => {
  it('reads the ISO code, and gives the shapes Natural Earth leaves without one a code', () => {
    expect(countryCodeOf({ iso_a2: 'ua' })).toBe('UA')
    expect(countryCodeOf({ ISO_A2: 'FR' })).toBe('FR')
    expect(countryCodeOf({ iso_a2: '-99', adm0_a3: 'KOS' })).toBe('XK')
    expect(countryCodeOf({ iso_a2: '-99', adm0_a3: 'SOL' })).toBe('SO')
    expect(countryCodeOf({ iso_a2: '-99', adm0_a3: 'XYZ' })).toBeNull()
  })

  it('uses the short name unless it is abbreviated or unclear', () => {
    expect(countryNameOf({ name: 'Russia', name_long: 'Russian Federation', admin: 'Russia' })).toBe('Russia')
    expect(countryNameOf({ name: 'United States', admin: 'United States of America' })).toBe('United States')
    expect(countryNameOf({ name: 'Dem. Rep. Congo', admin: 'Democratic Republic of the Congo' })).toBe('Democratic Republic of the Congo')
    expect(countryNameOf({ name: 'Korea', admin: 'South Korea', iso_a2: 'KR' })).toBe('South Korea')
    expect(countryNameOf({ name: 'Macedonia', iso_a2: 'MK' })).toBe('North Macedonia')
    expect(countryNameOf({})).toBe('Unknown')
  })

  it('makes flags from codes', () => {
    expect(flagEmoji('UA')).toBe('🇺🇦')
    expect(flagEmoji('gb')).toBe('🇬🇧')
    expect(flagEmoji(null)).toBe('')
    expect(flagEmoji('-99')).toBe('')
  })
})

describe('focusBboxOf', () => {
  it('zooms to all of a compact country', () => {
    const id = country({}, { type: 'MultiPolygon', coordinates: [[square(95, -6, 105, 5)], [square(130, -9, 141, -1)]] })
    expect(focusBboxOf(id)).toEqual([95, -9, 141, 5])
  })

  it('zooms to the main piece of a country spread over half the globe', () => {
    // The US: Alaska's islands reach the date line
    const mainland = [[-125, 25], [-67, 25], [-67, 49], [-90, 49.5], [-125, 49], [-125, 25]]
    const us = country({}, { type: 'MultiPolygon', coordinates: [[mainland], [square(172, 52, 180, 53)], [square(-180, 51, -170, 52)]] })
    expect(focusBboxOf(us)).toEqual([-125, 25, -67, 49.5])
  })
})
