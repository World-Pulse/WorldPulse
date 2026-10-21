/**
 * The World Map's Satellites layer (plan M53, Oct 21, 2026; Devon: "Nice!"):
 * about 500 satellites in five of CelesTrak's groups, placed where they are
 * now. The API sends their orbital elements (GET /api/v1/map/satellites,
 * TLEs kept 6 hours); satellite.js (MIT, SGP4) works out each position in
 * the browser, again every few seconds while the layer is on.
 */

import type { OverlayFeature } from './map-overlays'

export type SatGroup = 'stations' | 'gnss' | 'weather' | 'resource' | 'military'

export interface SatTle { name: string; norad: number; group: SatGroup; tle1: string; tle2: string }

export const SAT_GROUP_LABEL: Record<SatGroup, string> = {
  stations: 'Space station',
  gnss:     'Navigation (GPS, Galileo, GLONASS, BeiDou)',
  weather:  'Weather',
  resource: 'Earth observation',
  military: 'Military',
}

export const SAT_GROUP_COLOR: Record<SatGroup, string> = {
  stations: '#f8fafc',
  gnss:     '#a5b4fc',
  weather:  '#7dd3fc',
  resource: '#86efac',
  military: '#fca5a5',
}

// The parts of satellite.js used here (loaded only when the layer is turned on)
type SatLib = typeof import('satellite.js')
type SatRec = ReturnType<SatLib['twoline2satrec']>

export interface PreparedSats {
  lib: SatLib
  sats: Array<{ satrec: SatRec; name: string; norad: number; group: SatGroup }>
}

function isGroup(v: unknown): v is SatGroup {
  return typeof v === 'string' && v in SAT_GROUP_LABEL
}

/** A TLE line: its number, a space, a 5-digit catalogue number, 69 characters in all (satellite.js reads garbage without a word) */
function isTleLine(line: string, n: 1 | 2): boolean {
  return line.length >= 68 && line.length <= 70 && new RegExp(`^${n} [0-9 ]{5}`).test(line)
}

/** The API's answer as satellites ready to place (bad elements are left out) */
export function prepareWith(lib: SatLib, json: unknown): PreparedSats {
  const list = (json as { satellites?: unknown })?.satellites
  const sats: PreparedSats['sats'] = []
  if (Array.isArray(list)) {
    for (const s of list as Array<Partial<SatTle>>) {
      if (typeof s?.tle1 !== 'string' || typeof s?.tle2 !== 'string' || !isGroup(s.group)) continue
      if (!isTleLine(s.tle1, 1) || !isTleLine(s.tle2, 2)) continue
      try {
        const satrec = lib.twoline2satrec(s.tle1, s.tle2)
        if (satrec.error) continue
        sats.push({ satrec, name: String(s.name ?? '').trim() || `NORAD ${s.norad}`, norad: Number(s.norad) || 0, group: s.group })
      } catch { /* a malformed element set: skip it */ }
    }
  }
  return { lib, sats }
}

export async function prepareSatellites(json: unknown): Promise<PreparedSats> {
  return prepareWith(await import('satellite.js'), json)
}

/** Where each satellite is at `now`: a point, its height (km) and speed (km/s) */
export function satellitePositions(prepared: PreparedSats, now: Date): OverlayFeature[] {
  const { lib, sats } = prepared
  const gmst = lib.gstime(now)
  const out: OverlayFeature[] = []
  for (const s of sats) {
    let pv: ReturnType<SatLib['propagate']> | false
    try { pv = lib.propagate(s.satrec, now) } catch { continue }
    // satellite.js answers false (or no position) when the orbit can't be worked out (decayed, bad elements)
    if (!pv || typeof pv.position !== 'object' || !pv.position) continue
    const geo = lib.eciToGeodetic(pv.position, gmst)
    const lat = lib.degreesLat(geo.latitude)
    const lng = lib.degreesLong(geo.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(geo.height)) continue
    const v = pv.velocity && typeof pv.velocity === 'object' ? Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z) : NaN
    out.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Math.round(lng * 1e3) / 1e3, Math.round(lat * 1e3) / 1e3] },
      properties: {
        name: s.name, norad: s.norad, group: s.group, kind: SAT_GROUP_LABEL[s.group], color: SAT_GROUP_COLOR[s.group],
        km: Math.round(geo.height), kms: Number.isFinite(v) ? Math.round(v * 100) / 100 : null,
      },
    })
  }
  return out
}
