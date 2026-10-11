/**
 * Cluster rings that don't sit on each other (World Map).
 *
 * Supercluster joins signals within 44 px at whole zoom levels, but its
 * groups' centres can land closer than that, a big group's ring is wider than
 * half the gap, and on the globe the far north and the edge of the sphere
 * squeeze distances further. So rings piled up over Europe, the Gulf and
 * India on a desktop, and over most of the globe on a phone.
 *
 * After clustering, a ring or dot that would overlap a bigger one on screen
 * joins it: the bigger one stays where it is and counts both (its colour is
 * the worse severity). Features that aren't drawn (the far side of the globe,
 * off screen) are left as they are. Zooming in pulls them apart again.
 */

import { SEVERITY_RANK, ringRadius, dotRadius, SIGNAL_ICON_ZOOM, SIGNAL_ICON_RADIUS } from './map-style'

export interface ScreenPoint { x: number; y: number }

export interface MapFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: number[] }
  properties: object | null
}

/** Space kept between two rings, px */
const GAP = 2
/** Half the ring's stroke (2 px), and about half a dot's */
const RING_STROKE = 1
const DOT_STROKE = 0.8

/** "1.2k" the way supercluster writes point_count_abbreviated */
export function abbreviateCount(n: number): string | number {
  if (n >= 10000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`
  return n
}

interface Item {
  index: number
  feature: MapFeature
  at: ScreenPoint
  count: number
  sev: number
  verified: number
  severity: unknown
  cluster: boolean
  joined: boolean
  r: number
}

function radiusOf(item: Item, zoom: number): number {
  if (item.cluster) return ringRadius(item.count, zoom) + RING_STROKE
  // Zoomed in, a single signal is an icon of its kind, not a dot
  return zoom >= SIGNAL_ICON_ZOOM ? SIGNAL_ICON_RADIUS : dotRadius(item.severity, zoom) + DOT_STROKE
}

const bigger = (a: Item, b: Item): number => b.count - a.count || b.sev - a.sev || a.index - b.index

/**
 * The features to draw with overlapping rings joined. `place` gives a
 * feature's position on screen, or null when it isn't drawn. Features that
 * don't change come back as the same objects, in their original order.
 */
export function declutter<F extends MapFeature>(
  features: F[],
  place: (lngLat: [number, number]) => ScreenPoint | null,
  zoom: number,
): F[] {
  const items: Item[] = []
  features.forEach((feature, index) => {
    const coords = feature?.geometry?.coordinates
    if (!coords || coords.length < 2) return
    const at = place([Number(coords[0]), Number(coords[1])])
    if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return
    const p = (feature.properties ?? {}) as Record<string, unknown>
    const cluster = Boolean(p.cluster)
    const item: Item = {
      index, feature, at, cluster, joined: false, r: 0,
      count:    cluster ? Math.max(1, Number(p.point_count) || 1) : 1,
      sev:      cluster ? Number(p.sev ?? 1) : (SEVERITY_RANK[String(p.severity)] ?? 1),
      verified: cluster ? Number(p.verified ?? 0) : (p.status === 'verified' ? 1 : 0),
      severity: p.severity,
    }
    item.r = radiusOf(item, zoom)
    items.push(item)
  })

  // Biggest first; each one either stays or joins the first bigger one it
  // touches. A ring that grew can touch another: go round until nothing does.
  let kept = items.sort(bigger)
  for (let pass = 0; pass < 8; pass++) {
    const next: Item[] = []
    let changed = false
    for (const item of kept) {
      const host = next.find(k => Math.hypot(k.at.x - item.at.x, k.at.y - item.at.y) < k.r + item.r + GAP)
      if (!host) { next.push(item); continue }
      host.count += item.count
      host.sev = Math.max(host.sev, item.sev)
      host.verified += item.verified
      host.cluster = true
      host.joined = true
      host.r = radiusOf(host, zoom)
      changed = true
    }
    kept = next.sort(bigger)
    if (!changed) break
  }

  const removed = new Set(items.map(i => i.index))
  const replaced = new Map<number, F>()
  for (const item of kept) {
    removed.delete(item.index)
    if (!item.joined) continue
    const before = (item.feature.properties ?? {}) as Record<string, unknown>
    replaced.set(item.index, {
      ...item.feature,
      geometry: { type: 'Point', coordinates: [...item.feature.geometry.coordinates] },
      properties: {
        // A cluster keeps its id (a click zooms to where it splits); a dot that
        // took others in has none
        ...(before.cluster ? before : {}),
        cluster: true,
        point_count: item.count,
        point_count_abbreviated: abbreviateCount(item.count),
        sev: item.sev,
        verified: item.verified,
        joined: true,
      },
    } as unknown as F)
  }
  const out: F[] = []
  features.forEach((feature, index) => {
    if (removed.has(index)) return
    out.push(replaced.get(index) ?? feature)
  })
  return out
}
