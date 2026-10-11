import { describe, it, expect } from 'vitest'
import { subsolarPoint, terminator, dayNightFeatures, isNight } from '../daynight'
import { MAP_REGIONS, mapRegion, inRegion } from '../map-regions'

describe('subsolarPoint', () => {
  it('follows the seasons', () => {
    expect(subsolarPoint(new Date('2026-06-21T12:00:00Z')).lat).toBeCloseTo(23.44, 0)
    expect(subsolarPoint(new Date('2026-12-21T12:00:00Z')).lat).toBeCloseTo(-23.44, 0)
    expect(Math.abs(subsolarPoint(new Date('2026-03-20T15:00:00Z')).lat)).toBeLessThan(0.5)
  })

  it('follows the clock, with the equation of time', () => {
    expect(subsolarPoint(new Date('2026-04-15T06:00:00Z')).lng).toBeCloseTo(90, 0)
    // Early November the sun runs about 16 minutes ahead of the clock
    expect(subsolarPoint(new Date('2026-11-03T12:00:00Z')).lng).toBeCloseTo(-4.1, 0)
    expect(subsolarPoint(new Date('2026-10-11T23:59:00Z')).lng).toBeGreaterThanOrEqual(-180)
  })
})

describe('isNight', () => {
  const at = new Date('2026-10-11T07:30:00Z')
  it('knows where it is night', () => {
    expect(isNight(at, 40.71, -74.01)).toBe(true)    // New York, 3:30 am
    expect(isNight(at, 21.31, -157.86)).toBe(true)   // Honolulu, 9:30 pm
    expect(isNight(at, 51.51, -0.13)).toBe(false)    // London, 8:30 am
    expect(isNight(at, 35.68, 139.69)).toBe(false)   // Tokyo, 4:30 pm
  })
})

describe('dayNightFeatures', () => {
  // ray casting, enough for a test
  const inside = (ring: Array<[number, number]>, lng: number, lat: number) => {
    let hit = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!; const [xj, yj] = ring[j]!
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit
    }
    return hit
  }

  it('draws the terminator from -180 to 180', () => {
    const line = terminator(new Date('2026-10-11T07:30:00Z'), 2)
    expect(line).toHaveLength(181)
    expect(line[0]![0]).toBe(-180)
    expect(line[180]![0]).toBe(180)
  })

  it('closes the night polygon around the dark pole, and it agrees with isNight', () => {
    for (const when of ['2026-10-11T07:30:00Z', '2026-06-21T20:00:00Z', '2026-01-05T03:00:00Z']) {
      const date = new Date(when)
      const night = dayNightFeatures(date).features[0]!
      if (night.geometry.type !== 'Polygon') throw new Error('expected a polygon')
      const ring = night.geometry.coordinates[0]!
      expect(ring[0]).toEqual(ring[ring.length - 1])
      for (let lat = -75; lat <= 75; lat += 15) {
        for (let lng = -165; lng <= 165; lng += 30) {
          // skip points right on the terminator
          const sun = subsolarPoint(date)
          const RAD = Math.PI / 180
          const elevation = Math.asin(Math.sin(lat * RAD) * Math.sin(sun.lat * RAD)
            + Math.cos(lat * RAD) * Math.cos(sun.lat * RAD) * Math.cos((lng - sun.lng) * RAD)) / RAD
          if (Math.abs(elevation) < 2) continue
          expect(inside(ring, lng, lat), `${when} ${lat},${lng}`).toBe(isNight(date, lat, lng))
        }
      }
    }
  })
})

describe('map regions', () => {
  it('has well-formed bounds and finds places in them', () => {
    for (const region of MAP_REGIONS) {
      const [[w, s], [e, n]] = region.bounds
      expect(w).toBeLessThan(e)
      expect(s).toBeLessThan(n)
    }
    expect(inRegion(mapRegion('europe')!, 48.85, 2.35)).toBe(true)     // Paris
    expect(inRegion(mapRegion('mena')!, 24.71, 46.68)).toBe(true)      // Riyadh
    expect(inRegion(mapRegion('americas')!, 8.98, -79.52)).toBe(true)  // Panama City
    expect(mapRegion('atlantis')).toBeUndefined()
  })
})
