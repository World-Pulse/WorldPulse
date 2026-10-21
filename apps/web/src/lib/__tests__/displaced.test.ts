/**
 * UNHCR's figures for each country (plan R4, Oct 21, 2026), read by the World
 * Map's "Displaced people (UNHCR)" layer and each country's page.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { displacedFigures, displacedLines, displacedMapLink, people } from '../displaced'
import { decodePermalink } from '../map-permalink'

const file = {
  type: 'FeatureCollection', year: 2025, features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [29.863, 15.991] }, properties: { iso2: 'SD', name: 'Sudan', inside: 9139309, abroad: 3761034, hosted: 859963, stateless: 0, returned: 0, size: 1 } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [35.2, 31.9] }, properties: { iso2: 'PS', name: 'Palestine', inside: 0, abroad: '65049', hosted: '-', size: 0.071 } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { iso2: 'XX', name: 'Null Island', inside: 5 } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [10, 10] }, properties: { iso2: 'zz', name: '  ', inside: 5 } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [10, 10] }, properties: { iso2: 'de', name: 'Odd', inside: -4, hosted: 2.6, size: -1 } },
  ],
}

describe('reading the file', () => {
  it('keeps countries with a name and a real place, counts as whole numbers', () => {
    const f = displacedFigures(file)
    expect(f.map(x => x.name)).toEqual(['Sudan', 'Palestine', 'Odd'])
    expect(f[0]).toMatchObject({ iso2: 'SD', year: 2025, inside: 9139309, abroad: 3761034, hosted: 859963, size: 1, lng: 29.863, lat: 15.991, note: null })
    // "-" (not applicable) and text numbers as UNHCR writes them
    expect(f[1]).toMatchObject({ abroad: 65049, hosted: 0 })
    expect(f[2]).toMatchObject({ iso2: null, inside: 0, hosted: 3, size: 0 })
    expect(displacedFigures(null)).toEqual([])
    expect(displacedFigures({ features: 'no' })).toEqual([])
  })

  it('says what UNHCR\'s figures leave out for Palestine', () => {
    expect(displacedFigures(file)[1]!.note).toMatch(/UNRWA/)
  })
})

describe('the words', () => {
  it('each group, the biggest story first; empty groups left out', () => {
    expect(displacedLines(displacedFigures(file)[0]!)).toEqual([
      '9.1 million displaced inside the country',
      '3.8 million refugees and asylum-seekers abroad',
      'Hosts 859,963 from elsewhere',
    ])
    expect(displacedLines({ inside: 0, abroad: 0, hosted: 2952694, stateless: 28315, returned: 120, year: 2025 })).toEqual([
      'Hosts 3 million from elsewhere', '28,315 stateless people', '120 went home in 2025',
    ])
    expect(displacedLines({ inside: 0, abroad: 0, hosted: 0, stateless: 0, returned: 0, year: null })).toEqual([])
  })
  it('millions from one million up', () => {
    expect(people(999999)).toBe('999,999')
    expect(people(1000000)).toBe('1 million')
    expect(people(12345678)).toBe('12.3 million')
  })
})

describe('the map link', () => {
  it('opens the World Map on the country with the layer on', () => {
    const link = displacedMapLink({ lat: 15.991, lng: 29.863 })
    expect(link).toBe('/map#@15.99,29.86,3.50|l=displaced')
    const state = decodePermalink(link.slice(link.indexOf('#')))
    expect(state).toMatchObject({ lat: 15.99, lng: 29.86, zoom: 3.5, layers: ['displaced'] })
  })
})

describe('the file on the site (public/geo/unhcr-displacement.v1.geojson)', () => {
  const json = JSON.parse(readFileSync(path.resolve(__dirname, '../../../public/geo/unhcr-displacement.v1.geojson'), 'utf8'))
  const figures = displacedFigures(json)

  it('has UNHCR\'s credit, a year and most countries', () => {
    expect(json.source).toMatch(/UNHCR.*CC BY 4\.0/)
    expect(json.year).toBeGreaterThanOrEqual(2025)
    expect(figures.length).toBeGreaterThan(150)
    expect(figures.length).toBe(json.features.length)
  })

  it('every country once, with a size from 0 to 1 and the largest at 1', () => {
    const codes = figures.map(f => f.iso2).filter(Boolean)
    expect(new Set(codes).size).toBe(codes.length)
    expect(figures.every(f => f.size >= 0 && f.size <= 1)).toBe(true)
    expect(Math.max(...figures.map(f => f.size))).toBe(1)
  })
})
