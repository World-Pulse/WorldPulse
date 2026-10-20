/**
 * Live ships on the map (Oct 19, 2026, PLAN M39): ships in the main straits
 * and canals right now, from GET /api/v1/maritime/live (AIS via aisstream.io),
 * each an arrow turned to its heading and coloured by what it is.
 */

import { escapeHtml } from './map-utils'
import { MAP_ICON } from './map-icons'

export type ShipKind = 'tanker' | 'cargo' | 'passenger' | 'fishing' | 'military' | 'other'

export interface LiveShipProps {
  mmsi:    string
  name:    string | null
  kind:    ShipKind
  /** Knots */
  sog:     number | null
  cog:     number | null
  heading: number | null
  nav:     number | null
  dest:    string | null
  area:    string | null
  /** When it was last heard (ISO) */
  seen:    string | null
}

export const SHIP_KIND_LABEL: Record<ShipKind, string> = {
  tanker: 'Tanker', cargo: 'Cargo ship', passenger: 'Passenger ship', fishing: 'Fishing vessel', military: 'Navy or coast guard', other: 'Ship',
}

/** AIS navigational status, in plain words */
export const NAV_STATUS: Record<number, string> = {
  0: 'Under way', 1: 'At anchor', 2: 'Not under command', 3: 'Restricted in how it can move', 4: 'Held by its draught',
  5: 'Moored', 6: 'Aground', 7: 'Fishing', 8: 'Under sail', 14: 'Distress beacon active',
}

export function liveShipIconId(kind: ShipKind): string {
  if (kind === 'tanker') return MAP_ICON.shipTanker.id
  if (kind === 'cargo') return MAP_ICON.shipCargo.id
  if (kind === 'passenger') return MAP_ICON.shipPassenger.id
  if (kind === 'military') return MAP_ICON.shipMilitary.id
  return MAP_ICON.shipOther.id
}

/** Where the arrow points: the bow's heading when the ship sends it, else its course, else north */
export function shipRotation(heading: number | null | undefined, cog: number | null | undefined): number {
  if (typeof heading === 'number' && heading >= 0 && heading < 360) return heading
  if (typeof cog === 'number' && cog >= 0 && cog < 360) return cog
  return 0
}

function ago(iso: string | null, now: number): string {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return ''
  const min = Math.max(0, Math.round((now - t) / 60_000))
  return min < 1 ? 'just now' : `${min} min ago`
}

/** The popup: what the ship is, how it's moving, where it's going, and when it was last heard */
export function liveShipPopupHtml(p: LiveShipProps, now = Date.now()): string {
  const moving = [
    p.sog != null ? `${p.sog.toFixed(1)} kn` : '',
    p.sog != null && p.sog >= 0.5 && p.cog != null ? `course ${Math.round(p.cog)}°` : '',
    p.nav != null && NAV_STATUS[p.nav] ? NAV_STATUS[p.nav] : '',
  ].filter(Boolean).join(' · ')
  const place = [p.area, p.seen ? `heard ${ago(p.seen, now)}` : ''].filter(Boolean).join(' · ')
  return `
    <div style="max-width:260px">
      <div style="font:700 10px/1 system-ui;letter-spacing:.08em;color:#2dd4bf;margin-bottom:6px;padding-right:20px">⚓ LIVE SHIP · ${escapeHtml(SHIP_KIND_LABEL[p.kind] ?? 'Ship').toUpperCase()}</div>
      <div style="font:600 13px/1.4 system-ui;color:#e2e8f0">${escapeHtml(p.name || `MMSI ${p.mmsi}`)}</div>
      ${moving ? `<div style="font:11px/1.5 system-ui;color:#cbd5e1;margin-top:2px">${escapeHtml(moving)}</div>` : ''}
      ${p.dest ? `<div style="font:11px/1.5 system-ui;color:#cbd5e1">Bound for ${escapeHtml(p.dest)}</div>` : ''}
      ${place ? `<div style="font:11px/1.5 system-ui;color:#94a3b8">${escapeHtml(place)}</div>` : ''}
      <div style="font:10px/1.5 system-ui;color:#64748b;margin-top:4px">MMSI ${escapeHtml(p.mmsi)} · live AIS via aisstream.io</div>
    </div>`
}
