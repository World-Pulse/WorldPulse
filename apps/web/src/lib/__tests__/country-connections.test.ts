import { describe, it, expect } from 'vitest'
import { countriesMentioned, countryConnections, greatCircle, countryCentre, countryLabel, fitZoom, arcDegrees, connectionFeatures } from '../country-connections'
import type { CountryFeature } from '../country-shapes'

const square = (w: number, s: number, e: number, n: number): CountryFeature => ({
  type: 'Feature', properties: {},
  geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
} as unknown as CountryFeature)

// "Saudi Arabia" as a box around Riyadh, "Pakistan" around Islamabad
const saudi = square(35, 16, 55, 32)
const countryOf = (lng: number, lat: number) => (lng > 60 && lng < 77 && lat > 24 && lat < 37 ? 'PK' : lng > 35 && lng < 55 && lat > 16 && lat < 32 ? 'SA' : null)

describe('countriesMentioned', () => {
  it('finds names, people-words, plurals and capitalised US/UK, in order', () => {
    expect(countriesMentioned('Pakistan reaffirms commitment to Saudi Arabia')).toEqual(['PK', 'SA'])
    expect(countriesMentioned('Israelis and Iranians trade threats')).toEqual(['IL', 'IR'])
    expect(countriesMentioned('US says it disabled a cargo vessel near the UK')).toEqual(['US', 'GB'])
    expect(countriesMentioned('Michael Jordan buys turkeys for us')).toEqual([])
  })
})

describe('countryConnections', () => {
  const sig = (id: string, title: string, lng: number, lat: number) => ({ id, title, lng, lat })
  it('ties a country to those its own signals name and those whose signals name it', () => {
    const signals = [
      sig('1', 'Saudi Arabia condemns Yemen rebels', 46.7, 24.7),        // in SA, names Yemen
      sig('2', 'Houthis in Yemen claim strike on Riyadh, Saudi Arabia says', 46.7, 24.7),
      sig('3', 'Pakistan reaffirms commitment to Saudi Arabia', 73.0, 33.7), // in PK, names SA
      sig('4', 'Pakistan sends envoy to Saudi Arabia', 73.0, 33.7),
      sig('5', 'Pakistan beats India at cricket', 73.0, 33.7),            // nothing to do with SA
      sig('6', 'France and Saudi Arabia sign deal', 46.7, 24.7),           // one France tie only
    ]
    expect(countryConnections(signals, 'SA', saudi, countryOf)).toEqual([
      { code: 'PK', name: 'Pakistan', count: 2 },
      { code: 'YE', name: 'Yemen', count: 2 },
    ])
  })
})

describe('arcs', () => {
  it('follows the great circle and stays continuous across the date line', () => {
    const arc = greatCircle([170, 0], [-170, 0], 4)
    expect(arc[0]).toEqual([170, 0])
    expect(arc[4]![0]).toBeCloseTo(190, 3)     // -170 written as 190, so the line doesn't cross the map
    for (let i = 1; i < arc.length; i++) expect(Math.abs(arc[i]![0] - arc[i - 1]![0])).toBeLessThan(10)
  })

  it('finds a middle and a name', () => {
    expect(countryCentre(saudi)).toEqual([45, 24])
    expect(countryLabel('YE')).toBe('Yemen')
  })
})

describe('fitZoom', () => {
  it('zooms out just enough for the near ties, and leaves the far ones to their arcs', () => {
    // Saudi Arabia with Yemen, Iran and India near; India, 34 degrees east, sets the zoom
    const near = fitZoom([45, 24], [[48, 15], [53, 32], [79, 22]], 280, 290)
    // on the globe India sits cos(22)·sin(34) ≈ 0.52 radii east: radius 280/0.52 ≈ 540 px
    expect(near).toBeCloseTo(Math.log2((280 / (Math.cos(22 * Math.PI / 180) * Math.sin(34 * Math.PI / 180))) * 2 * Math.PI * Math.cos(24 * Math.PI / 180) / 512), 6)
    expect(near).toBeGreaterThan(2.4)
    expect(near).toBeLessThan(2.8)
    // the United States, 110 degrees away, changes nothing
    expect(fitZoom([45, 24], [[48, 15], [53, 32], [79, 22], [-96, 37]], 280, 290)).toBeCloseTo(near, 6)
    // nothing to fit
    expect(fitZoom([45, 24], [], 280, 290)).toBe(Infinity)
  })

  it('measures the short way round the date line, on the globe and the flat map', () => {
    expect(arcDegrees([178, -18], [-172, -14])).toBeLessThan(11)
    const flat = fitZoom([178, -18], [[-172, -14]], 300, 300, 'mercator')
    // 10 degrees of longitude in 300 px: a world 10,800 px wide
    expect(flat).toBeCloseTo(Math.log2(300 * 36 / 512), 6)
  })
})

describe('connectionFeatures', () => {
  it('draws an arc and a named end for each tie, and names the far ones along the arc', () => {
    const { features } = connectionFeatures([45, 24], [
      { name: 'Yemen', count: 6, centre: [48, 15] },
      { name: 'United States', count: 8, centre: [-96, 37] },
    ])
    expect(features.map(f => `${f.properties.kind}:${f.properties.label ?? f.properties.count}`)).toEqual([
      'arc:6', 'end:Yemen · 6', 'arc:8', 'end:United States · 8', 'far:United States · 8',
    ])
    // the far name sits on the arc about 35 degrees out (the arc's nearest point)
    const far = features[4]!.geometry.coordinates as [number, number]
    expect(Math.abs(arcDegrees([45, 24], far) - 35)).toBeLessThan(2)
  })
})
