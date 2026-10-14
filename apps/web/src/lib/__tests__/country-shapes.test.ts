import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  pointInRing, featureContains, countryCodeOf, countryNameOf, flagEmoji, findCountry, focusBboxOf,
  COUNTRY_SHAPES_URL, type CountryFeature, type CountryCollection,
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

describe('the borders file on our own site (plan M23)', () => {
  const file = new URL(`../../../public${COUNTRY_SHAPES_URL}`, import.meta.url)
  const shapes = JSON.parse(readFileSync(file, 'utf8')) as CountryCollection

  it('is served from our own site, not a third party', () => {
    expect(COUNTRY_SHAPES_URL).toMatch(/^\/geo\/[\w.-]+\.geojson$/)
  })

  it('holds every country, each with a shape, a name and (nearly all) a code', () => {
    expect(shapes.type).toBe('FeatureCollection')
    expect(shapes.features.length).toBe(177)
    for (const f of shapes.features) {
      expect(['Polygon', 'MultiPolygon']).toContain(f.geometry?.type)
      expect(countryNameOf(f.properties)).not.toBe('Unknown')
    }
    const missing = shapes.features.filter(f => !countryCodeOf(f.properties)).map(f => countryNameOf(f.properties))
    expect(missing.length).toBeLessThanOrEqual(2)
  })

  it('finds the country of well-known places', () => {
    const at = (lng: number, lat: number) => findCountry(shapes, lng, lat)
    expect(at(2.35, 48.86)?.code).toBe('FR')       // Paris
    expect(at(30.52, 50.45)?.code).toBe('UA')      // Kyiv
    expect(at(-74.0, 40.75)?.code).toBe('US')      // New York
    expect(at(21.17, 42.67)?.code).toBe('XK')      // Pristina
    expect(at(36.82, -1.29)?.code).toBe('KE')      // Nairobi
    expect(at(151.2, -33.87)?.code).toBe('AU')     // Sydney
    expect(at(31.13, -26.32)).toMatchObject({ code: 'SZ', name: 'Eswatini' })
    expect(at(-30, 30)).toBeNull()                 // the Atlantic
  })
})
