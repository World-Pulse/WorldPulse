/**
 * Six more kinds of layer for the World Map (Oct 21, 2026, Devon: "I still
 * think there is a gap in the mapping features"; the audit is
 * departments/research/compete-worldmonitor-2026-10-21.md): World Monitor has
 * 58 kinds of layer, the map had 13, and for five of the missing kinds
 * WorldPulse already held the data on other pages.
 *
 *   - Protests and unrest, disease outbreaks, refugees and displacement: news
 *     reports with a place, found by headline (GET /api/v1/map/topics/:topic)
 *   - Internet outages: IODA's reports (GET /api/v1/outages/recent)
 *   - Undersea cable landings: where the cables of /undersea-cables come
 *     ashore (GET /api/v1/undersea-cables/landing-points). Not their routes:
 *     the routes the API keeps are three to eleven points per cable, some
 *     across land.
 *   - AI data centers: the sites of /ai-infrastructure
 *
 * Each turns its API's answer into points and a popup. Everything shown in a
 * popup comes from data, so it goes through escapeHtml.
 */

import { escapeHtml, safeHttpUrl, timeAgo } from './map-utils'

export type OverlayKey = 'protests' | 'outbreaks' | 'displacement' | 'outages' | 'cable-landings' | 'ai-dc'

export const OVERLAY_KEYS: readonly OverlayKey[] = ['protests', 'outbreaks', 'displacement', 'outages', 'cable-landings', 'ai-dc']

export function isOverlayKey(value: unknown): value is OverlayKey {
  return typeof value === 'string' && (OVERLAY_KEYS as readonly string[]).includes(value)
}

export interface OverlayFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: Record<string, string | number | null>
}

export interface OverlayDef {
  key: OverlayKey
  label: string
  description: string
  color: string
  /** Path on the API */
  path: string
  /** How often the layer reloads while on */
  refreshMs: number
  /** Dot size: news by severity, the rest one size */
  bySeverity: boolean
  toFeatures: (json: unknown) => OverlayFeature[]
  popup: (props: Record<string, unknown>) => string
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/** A point if lat/lng are real coordinates (not 0,0, the "no place" of bad geocodes) */
export function pointAt(lat: unknown, lng: unknown): [number, number] | null {
  const la = num(lat), lo = num(lng)
  if (la == null || lo == null || Math.abs(la) > 90 || Math.abs(lo) > 180 || (la === 0 && lo === 0)) return null
  return [lo, la]
}

function feature(coords: [number, number], properties: OverlayFeature['properties']): OverlayFeature {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : (typeof v === 'number' ? String(v) : null)
}

const SEVERITY_COLOR: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#94a3b8' }

function header(color: string, text: string, severity?: unknown): string {
  const sev = str(severity)?.toLowerCase()
  const sevPart = sev ? ` · <span style="color:${SEVERITY_COLOR[sev] ?? '#94a3b8'}">${escapeHtml(sev.toUpperCase())}</span>` : ''
  return `<div style="font:700 10px/1 system-ui;letter-spacing:.08em;color:${color};margin-bottom:6px;padding-right:20px">${escapeHtml(text)}${sevPart}</div>`
}

const TITLE = 'font:600 13px/1.4 system-ui;color:#e2e8f0;max-width:260px'
const META = 'font:11px/1.4 system-ui;color:#94a3b8;margin-top:3px'
const LINK = 'display:inline-block;margin-top:6px;font:600 11px system-ui;text-decoration:underline'

function storyLink(id: unknown, color: string): string {
  const s = str(id)
  return s ? `<a href="/signals/${encodeURIComponent(s)}" style="${LINK};color:${color}">Open the story →</a>` : ''
}

// ── News found by headline ────────────────────────────────────────────────────

function topicFeatures(json: unknown): OverlayFeature[] {
  const list = (json as { features?: unknown })?.features
  if (!Array.isArray(list)) return []
  const out: OverlayFeature[] = []
  for (const f of list as Array<{ geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> }>) {
    const c = Array.isArray(f?.geometry?.coordinates) ? f.geometry!.coordinates as unknown[] : []
    const at = pointAt(c[1], c[0])
    const p = f?.properties ?? {}
    if (!at || !str(p.title)) continue
    out.push(feature(at, { id: str(p.id), title: str(p.title), place: str(p.place), severity: str(p.severity) ?? 'low', at: str(p.created_at) }))
  }
  return out
}

function topicPopup(label: string, color: string) {
  return (p: Record<string, unknown>) => {
    const when = str(p.at) ? timeAgo(String(p.at)) : ''
    const meta = [str(p.place), when].filter(Boolean).join(' · ')
    return header(color, label, p.severity) +
      `<div style="${TITLE}">${escapeHtml(p.title)}</div>` +
      (meta ? `<div style="${META}">${escapeHtml(meta)}</div>` : '') +
      storyLink(p.id, color)
  }
}

// ── Internet outages (IODA) ───────────────────────────────────────────────────

function outageFeatures(json: unknown): OverlayFeature[] {
  const events = (json as { data?: { events?: unknown } })?.data?.events
  if (!Array.isArray(events)) return []
  const out: OverlayFeature[] = []
  for (const e of events as Array<Record<string, unknown>>) {
    const at = pointAt(e.lat, e.lng)
    if (!at || !str(e.title)) continue
    out.push(feature(at, {
      id: str(e.id), title: str(e.title), place: str(e.location_name), severity: str(e.severity) ?? 'medium',
      at: str(e.published_at), summary: str(e.summary), source: safeHttpUrl(e.source_url),
    }))
  }
  return out
}

function outagePopup(p: Record<string, unknown>): string {
  const color = OVERLAYS.outages.color
  const since = str(p.at) ? `Started ${timeAgo(String(p.at))}` : ''
  const summary = str(p.summary) ? String(p.summary) : ''
  const short = summary.length > 220 ? `${summary.slice(0, 217)}…` : summary
  const source = safeHttpUrl(p.source)
  return header(color, 'INTERNET OUTAGE', p.severity) +
    `<div style="${TITLE}">${escapeHtml(p.title)}</div>` +
    (since ? `<div style="${META}">${escapeHtml(since)}</div>` : '') +
    (short ? `<div style="${META};max-width:260px">${escapeHtml(short)}</div>` : '') +
    storyLink(p.id, color) +
    (source ? ` <a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer" style="${LINK};color:#94a3b8;margin-left:8px">IODA ↗</a>` : '')
}

// ── Undersea cable landings ───────────────────────────────────────────────────

function landingFeatures(json: unknown): OverlayFeature[] {
  const countries = (json as { data?: unknown })?.data
  if (!Array.isArray(countries)) return []
  const out: OverlayFeature[] = []
  for (const c of countries as Array<{ country?: unknown; points?: unknown }>) {
    if (!Array.isArray(c?.points)) continue
    for (const pt of c.points as Array<{ name?: unknown; lat?: unknown; lng?: unknown; cables?: unknown }>) {
      const at = pointAt(pt.lat, pt.lng)
      if (!at || !str(pt.name)) continue
      const cables = Array.isArray(pt.cables) ? (pt.cables as unknown[]).map(str).filter((x): x is string => !!x) : []
      out.push(feature(at, { name: str(pt.name), country: str(c.country), cables: cables.join(' · '), cableCount: cables.length }))
    }
  }
  return out
}

function landingPopup(p: Record<string, unknown>): string {
  const color = OVERLAYS['cable-landings'].color
  const place = [str(p.name), str(p.country)].filter(Boolean).join(', ')
  const n = num(p.cableCount) ?? 0
  return header(color, 'UNDERSEA CABLE LANDING') +
    `<div style="${TITLE}">${escapeHtml(place)}</div>` +
    (str(p.cables) ? `<div style="${META};max-width:260px">${escapeHtml(n === 1 ? 'Cable: ' : `${n} cables: `)}${escapeHtml(p.cables)}</div>` : '') +
    `<a href="/undersea-cables" style="${LINK};color:${color}">All cables →</a>`
}

// ── AI data centers ───────────────────────────────────────────────────────────

function dataCenterFeatures(json: unknown): OverlayFeature[] {
  const list = (json as { data?: unknown })?.data
  if (!Array.isArray(list)) return []
  const out: OverlayFeature[] = []
  for (const d of list as Array<Record<string, unknown>>) {
    const at = pointAt(d.lat, d.lng)
    if (!at || !str(d.name)) continue
    out.push(feature(at, {
      name: str(d.name), operator: str(d.operator), place: [str(d.city), str(d.country)].filter(Boolean).join(', ') || null,
      mw: num(d.capacity_mw), status: str(d.status), gpu: str(d.gpu_type),
    }))
  }
  return out
}

function dataCenterPopup(p: Record<string, unknown>): string {
  const color = OVERLAYS['ai-dc'].color
  const mw = num(p.mw)
  const facts = [str(p.operator), mw ? `${mw.toLocaleString('en-US')} MW` : null, str(p.status)?.replace(/_/g, ' ') ?? null, str(p.gpu)].filter(Boolean).join(' · ')
  return header(color, 'AI DATA CENTER') +
    `<div style="${TITLE}">${escapeHtml(p.name)}</div>` +
    (str(p.place) ? `<div style="${META}">${escapeHtml(p.place)}</div>` : '') +
    (facts ? `<div style="${META}">${escapeHtml(facts)}</div>` : '') +
    `<a href="/ai-infrastructure" style="${LINK};color:${color}">AI infrastructure →</a>`
}

export const OVERLAYS: Record<OverlayKey, OverlayDef> = {
  protests: {
    key: 'protests', label: 'Protests and unrest', color: '#f472b6',
    description: 'Protests, strikes and riots in the news, last 48 h',
    path: '/api/v1/map/topics/protests', refreshMs: 10 * MINUTE, bySeverity: true,
    toFeatures: topicFeatures, popup: topicPopup('PROTESTS & UNREST', '#f472b6'),
  },
  outbreaks: {
    key: 'outbreaks', label: 'Disease outbreaks', color: '#a3e635',
    description: 'Outbreaks and epidemics in the news (Ebola, cholera, measles…), last 72 h',
    path: '/api/v1/map/topics/outbreaks', refreshMs: 10 * MINUTE, bySeverity: true,
    toFeatures: topicFeatures, popup: topicPopup('DISEASE OUTBREAK', '#a3e635'),
  },
  displacement: {
    key: 'displacement', label: 'Refugees and displacement', color: '#fde68a',
    description: 'People displaced, fleeing or seeking asylum, in the news, last 7 days',
    path: '/api/v1/map/topics/displacement', refreshMs: 10 * MINUTE, bySeverity: true,
    toFeatures: topicFeatures, popup: topicPopup('REFUGEES & DISPLACEMENT', '#fde68a'),
  },
  outages: {
    key: 'outages', label: 'Internet outages', color: '#818cf8',
    description: 'Country-wide internet outages detected by IODA (Georgia Tech), last 24 h',
    path: '/api/v1/outages/recent?hours=24&limit=200', refreshMs: 10 * MINUTE, bySeverity: false,
    toFeatures: outageFeatures, popup: outagePopup,
  },
  'cable-landings': {
    key: 'cable-landings', label: 'Undersea cable landings', color: '#38bdf8',
    description: 'Where the main undersea internet cables come ashore',
    path: '/api/v1/undersea-cables/landing-points', refreshMs: 6 * HOUR, bySeverity: false,
    toFeatures: landingFeatures, popup: landingPopup,
  },
  'ai-dc': {
    key: 'ai-dc', label: 'AI data centers', color: '#e879f9',
    description: 'Large AI computing sites: operator, power and chips',
    path: '/api/v1/ai-infrastructure/datacenters?limit=200', refreshMs: 6 * HOUR, bySeverity: false,
    toFeatures: dataCenterFeatures, popup: dataCenterPopup,
  },
}
