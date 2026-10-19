/**
 * The map's live aircraft (Oct 19, 2026, Map Lab): military aircraft and
 * emergency squawks from GET /api/v1/aircraft/live (adsb.lol, ODbL 1.0).
 */

import { escapeHtml } from './map-utils'

export interface LiveAircraft {
  hex:       string
  callsign:  string | null
  reg:       string | null
  type:      string | null
  desc:      string | null
  operator:  string | null
  lat:       number
  lng:       number
  alt:       number | 'ground' | null
  speed:     number | null
  track:     number | null
  squawk:    string | null
  emergency: string | null
  military:  boolean
}

export interface AircraftSnapshot {
  at:       string | null
  aircraft: LiveAircraft[]
  counts:   { military: number; emergency: number }
}

/** The Lucide plane points to the upper right: turn it by the track less 45° */
export const PLANE_GLYPH_ANGLE = 45

export function planeRotation(track: number | null): number {
  return track == null ? 0 : (((track - PLANE_GLYPH_ANGLE) % 360) + 360) % 360
}

export function altitudeLabel(alt: LiveAircraft['alt']): string {
  if (alt === 'ground') return 'On the ground'
  if (alt == null) return ''
  return alt >= 18_000 ? `FL${Math.round(alt / 100)} (${alt.toLocaleString('en-US')} ft)` : `${alt.toLocaleString('en-US')} ft`
}

/** The popup: who it is, what it is, how high and fast, and the squawk when it's an emergency */
export function aircraftPopupHtml(a: Pick<LiveAircraft, 'callsign' | 'reg' | 'type' | 'desc' | 'operator' | 'alt' | 'speed' | 'track' | 'squawk' | 'emergency' | 'military' | 'hex'>, asOf: string | null): string {
  const colour = a.emergency ? '#ef4444' : a.military ? '#f59e0b' : '#22d3ee'
  const kind = a.emergency ? `${a.emergency.toUpperCase()} · SQUAWK ${a.squawk ?? ''}` : a.military ? 'MILITARY AIRCRAFT' : 'AIRCRAFT'
  const name = a.callsign || a.reg || a.hex.toUpperCase()
  const what = [a.desc || a.type, a.operator].filter(Boolean).join(' · ')
  const facts = [
    altitudeLabel(a.alt),
    a.speed != null ? `${a.speed} kt` : '',
    a.track != null ? `heading ${Math.round(a.track)}°` : '',
  ].filter(Boolean).join(' · ')
  const reg = a.reg && a.reg !== name ? ` · ${escapeHtml(a.reg)}` : ''
  const when = asOf ? new Date(asOf).toISOString().slice(11, 16) + ' UTC' : ''
  return `
    <div style="width:min(260px,70vw)">
      <div style="font:700 10px/1 system-ui;letter-spacing:.08em;color:${colour};margin-bottom:6px;padding-right:20px">✈ ${escapeHtml(kind)}</div>
      <div style="font:600 14px/1.4 system-ui;color:#e2e6f0">${escapeHtml(name)}<span style="font:400 11px system-ui;color:#9aa5b4">${reg}</span></div>
      ${what ? `<div style="font:12px/1.4 system-ui;color:#c4cbd6;margin-top:2px">${escapeHtml(what)}</div>` : ''}
      ${facts ? `<div style="font:11px/1.4 system-ui;color:#9aa5b4;margin-top:4px">${escapeHtml(facts)}</div>` : ''}
      <div style="font:10px/1.4 system-ui;color:#6b7686;margin-top:6px">Position ${escapeHtml(when)} · ADS-B data: adsb.lol (ODbL)</div>
    </div>`
}
