/**
 * Cluster rings that don't sit on each other (lib/map-declutter.ts), and the
 * dot and ring sizes they share with the map (lib/map-style.ts).
 */

import { describe, it, expect } from 'vitest'
import { declutter, abbreviateCount, type MapFeature } from '../map-declutter'
import {
  interpolateStops, dotRadius, ringRadius, SIGNAL_RADIUS_EXPR, CLUSTER_RING_EXPR, CLUSTER_HALO_EXPR, CLUSTER_TEXT_EXPR,
} from '../map-style'

type Feature = MapFeature & { properties: Record<string, unknown> }

/** A cluster or a signal at screen position (x, y); the test "projection" reads x, y from the coordinates */
function cluster(x: number, y: number, count: number, extra: Record<string, unknown> = {}): Feature {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [x, y] }, properties: { cluster: true, cluster_id: x * 1000 + y, point_count: count, point_count_abbreviated: count, sev: 2, verified: 0, ...extra } }
}
function dot(x: number, y: number, severity = 'medium', status = 'pending'): Feature {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [x, y] }, properties: { id: `${x},${y}`, severity, status } }
}
const onScreen = ([x, y]: [number, number]) => ({ x, y })
const Z = 3.5   // full-size rings: 2 → 11 px, 10 → 14, 50 → 19, 200 → 25

describe('sizes the map draws', () => {
  it('interpolates between stops and holds flat past the ends', () => {
    const stops: Array<[number, number]> = [[1, 10], [3, 20]]
    expect(interpolateStops(stops, 0)).toBe(10)
    expect(interpolateStops(stops, 2)).toBe(15)
    expect(interpolateStops(stops, 9)).toBe(20)
    expect(interpolateStops([], 2)).toBe(0)
  })

  it('gives dots the radius the dot expression draws', () => {
    expect(dotRadius('critical', 1)).toBe(5)
    expect(dotRadius('critical', 3)).toBeCloseTo(6.25)
    expect(dotRadius('low', 10)).toBe(7)
    expect(dotRadius(undefined, 0)).toBe(2.8)
    expect(SIGNAL_RADIUS_EXPR[0]).toBe('interpolate')
    expect(SIGNAL_RADIUS_EXPR[3]).toBe(1)
    expect(SIGNAL_RADIUS_EXPR[4]).toEqual(['match', ['get', 'severity'], 'critical', 5, 'high', 4.2, 'medium', 3.4, 2.8])
  })

  it('makes rings smaller on the zoomed-out globe and full size from zoom 3.5', () => {
    expect(ringRadius(2, 1)).toBe(8)
    expect(ringRadius(200, 1)).toBe(17)
    expect(ringRadius(200, 3.5)).toBe(25)
    expect(ringRadius(200, 2.25)).toBeCloseTo(21)
    expect(ringRadius(5000, 8)).toBe(25)
    expect(ringRadius(2, 0.6)).toBe(8)
  })

  it('writes ring, halo and number sizes as zoom-then-count expressions', () => {
    for (const expr of [CLUSTER_RING_EXPR, CLUSTER_HALO_EXPR, CLUSTER_TEXT_EXPR]) {
      expect(expr.slice(0, 3)).toEqual(['interpolate', ['linear'], ['zoom']])
      expect(expr[3]).toBe(1)
      expect(expr[4].slice(0, 3)).toEqual(['interpolate', ['linear'], ['get', 'point_count']])
      expect(expr[5]).toBe(3.5)
    }
    expect(CLUSTER_RING_EXPR[6]).toEqual(['interpolate', ['linear'], ['get', 'point_count'], 2, 11, 10, 14, 50, 19, 200, 25])
  })
})

describe('abbreviateCount', () => {
  it('writes counts the way the cluster numbers did', () => {
    expect(abbreviateCount(999)).toBe(999)
    expect(abbreviateCount(1234)).toBe('1.2k')
    expect(abbreviateCount(15321)).toBe('15k')
  })
})

describe('declutter', () => {
  it('leaves rings that have room as they are, the same objects in the same order', () => {
    const features = [cluster(0, 0, 50), cluster(100, 0, 10), dot(0, 100)]
    const out = declutter(features, onScreen, Z)
    expect(out).toHaveLength(3)
    out.forEach((f, i) => expect(f).toBe(features[i]))
  })

  it('joins a ring that would overlap a bigger one into it: summed, worst colour, bigger one stays put', () => {
    const big = cluster(0, 0, 139, { sev: 3, verified: 4 })
    const small = cluster(30, 0, 72, { sev: 4, verified: 2 })
    const out = declutter([small, big], onScreen, Z)
    expect(out).toHaveLength(1)
    const joined = out[0]!
    expect(joined.geometry.coordinates).toEqual([0, 0])
    expect(joined.properties).toMatchObject({ cluster: true, cluster_id: big.properties.cluster_id, point_count: 211, point_count_abbreviated: 211, sev: 4, verified: 6, joined: true })
    // The input isn't changed
    expect(big.properties.point_count).toBe(139)
  })

  it('keeps a gap: rings just apart stay apart', () => {
    // 50 → 19 px rings (+1 stroke): touching at 40 px, apart from 42 px with the 2 px gap
    expect(declutter([cluster(0, 0, 50), cluster(42.5, 0, 50)], onScreen, Z)).toHaveLength(2)
    expect(declutter([cluster(0, 0, 50), cluster(41, 0, 50)], onScreen, Z)).toHaveLength(1)
  })

  it('takes in a dot that sits on a ring, with its severity and verification', () => {
    const out = declutter([dot(20, 0, 'critical', 'verified'), cluster(0, 0, 10, { sev: 2, verified: 1 })], onScreen, Z)
    expect(out).toHaveLength(1)
    expect(out[0]!.properties).toMatchObject({ point_count: 11, sev: 4, verified: 2, joined: true })
  })

  it('turns two dots on top of each other into a ring of 2 at the more severe one, with no cluster id', () => {
    const out = declutter([dot(3, 0, 'low'), dot(0, 0, 'high', 'verified')], onScreen, Z)
    expect(out).toHaveLength(1)
    expect(out[0]!.geometry.coordinates).toEqual([0, 0])
    expect(out[0]!.properties).toMatchObject({ cluster: true, point_count: 2, sev: 3, verified: 1, joined: true })
    expect(out[0]!.properties!.cluster_id).toBeUndefined()
  })

  it('goes round again when a ring that grew now touches another', () => {
    // 200 (25 px) and 50 (19 px) are apart at 50 px; the 10 beside the 50 joins
    // it first, then the grown 60 (19.4 px) reaches the 200 and joins that
    const out = declutter([cluster(0, 0, 200), cluster(48, 0, 50), cluster(48, 34, 10)], onScreen, Z)
    expect(out).toHaveLength(1)
    expect(out[0]!.properties!.point_count).toBe(260)
  })

  it('leaves features that are not drawn (far side of the globe, off screen) alone', () => {
    const hidden = cluster(5, 0, 80)
    const out = declutter([cluster(0, 0, 100), hidden], ([x, y]) => (x === 5 ? null : { x, y }), Z)
    expect(out).toHaveLength(2)
    expect(out[1]).toBe(hidden)
  })

  it('reads smaller rings on a zoomed-out globe, so more of them fit', () => {
    // 30 px apart: full-size 50s overlap; at zoom 1 they are 13.5 px and fit
    expect(declutter([cluster(0, 0, 50), cluster(31, 0, 50)], onScreen, 1)).toHaveLength(2)
    expect(declutter([cluster(0, 0, 50), cluster(31, 0, 50)], onScreen, Z)).toHaveLength(1)
  })
})
