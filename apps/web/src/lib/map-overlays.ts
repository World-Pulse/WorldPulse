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
 * Then (plan M53; Devon: "Nice!") three from Wikidata (CC0), kept as files on
 * our own server (public/geo/, built by scripts/map-data/wikidata-layers.py):
 * nuclear power plants, military bases and spaceports.
 *
 * And (Oct 23, 2026; Devon: "Add Lloyd's List data ... and layers to the map") Lloyd's List's
 * shipping headlines, from the free feed it offers websites: a circle per country or sea area the
 * headlines are tagged with, each headline linking to its article on lloydslist.com, credited.
 *
 * And (Nov 21, 2026; Devon: "keep me updated on more map layers") three from open data, kept as files too
 * (scripts/map-data/open-layers.mjs): large airports with scheduled flights (OurAirports, public domain),
 * seaports (Natural Earth, public domain) and power plants of 1,000 MW or more (WRI's Global Power Plant
 * Database, CC BY 4.0 and credited; WRI last updated it in 2021, which the layer says).
 *
 * And (Nov 22, 2026; Devon: "add more map layers where it makes sense and is free and automated") two from
 * public feeds that update themselves, through the API so readers never wait on the source
 * (apps/api/src/routes/map/earth-feeds.ts): storms, floods and other open events from NASA's EONET, with a
 * cyclone's track, NOAA's aurora forecast, and where the EU's Copernicus Emergency Management Service had
 * satellites map a disaster in the last 12 months.
 *
 * And (plan R4; Devon, Oct 21: "Add - added refugee and displacement data")
 * UNHCR's figures for each country (CC BY 4.0), one circle a country sized by
 * the people displaced from it: inside it and abroad. Kept as a file too
 * (scripts/map-data/unhcr-displacement.py), as they change twice a year.
 *
 * Each turns its answer into points and a popup. Everything shown in a popup
 * comes from data, so it goes through escapeHtml.
 */

import { escapeHtml, safeHttpUrl, timeAgo } from './map-utils'
import { prepareSatellites, satellitePositions, type PreparedSats } from './map-satellites'
import { DISPLACED_FILE, UNHCR_DATA_URL, displacedFigures, displacedLines } from './displaced'

export type OverlayKey = 'protests' | 'outbreaks' | 'displacement' | 'displaced' | 'outages' | 'cable-landings' | 'ai-dc' | 'nuclear' | 'bases' | 'spaceports' | 'satellites' | 'shipping-news' | 'airports' | 'ports' | 'power' | 'storms' | 'aurora' | 'disaster-maps'

export const OVERLAY_KEYS: readonly OverlayKey[] = ['protests', 'outbreaks', 'displacement', 'displaced', 'outages', 'cable-landings', 'ai-dc', 'nuclear', 'bases', 'spaceports', 'satellites', 'shipping-news', 'airports', 'ports', 'power', 'storms', 'aurora', 'disaster-maps']

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
  /** Path on the API, or on the site itself for files in public/ (base 'site') */
  path: string
  base?: 'api' | 'site'
  /** How often the layer reloads while on */
  refreshMs: number
  /** Dot size: news by severity, the rest one size */
  bySeverity: boolean
  /** Circles sized by each point's own "size" (0 to 1: the circle's area follows a count), drawn see-through */
  sized?: boolean
  toFeatures: (json: unknown) => OverlayFeature[]
  popup: (props: Record<string, unknown>) => string
  /** Points that move (satellites): made ready once per answer, then placed again every everyMs */
  live?: { everyMs: number; prepare: (json: unknown, fetchImpl: typeof fetch) => Promise<unknown>; at: (prepared: unknown, now: Date) => OverlayFeature[] }
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

// ── Displaced people (UNHCR's figures) ────────────────────────────────────────

function displacedFeatures(json: unknown): OverlayFeature[] {
  return displacedFigures(json).map(f => feature([f.lng, f.lat], {
    name: f.name, iso2: f.iso2, year: f.year, inside: f.inside, abroad: f.abroad, hosted: f.hosted,
    stateless: f.stateless, returned: f.returned, size: f.size, note: f.note,
  }))
}

function displacedPopup(p: Record<string, unknown>): string {
  const color = OVERLAYS.displaced.color
  const year = num(p.year)
  const lines = displacedLines({
    inside: num(p.inside) ?? 0, abroad: num(p.abroad) ?? 0, hosted: num(p.hosted) ?? 0,
    stateless: num(p.stateless) ?? 0, returned: num(p.returned) ?? 0, year,
  })
  if (!lines.length) lines.push('Fewer than 1,000 in each group')
  const iso2 = /^[A-Z]{2}$/.test(String(p.iso2 ?? '')) ? String(p.iso2).toLowerCase() : null
  return header(color, `DISPLACED PEOPLE${year ? ` · ${year}` : ''}`) +
    `<div style="${TITLE}">${escapeHtml(p.name)}</div>` +
    lines.map(l => `<div style="${META}">${escapeHtml(l)}</div>`).join('') +
    (str(p.note) ? `<div style="${META};max-width:260px;font-style:italic">${escapeHtml(p.note)}</div>` : '') +
    (iso2 ? `<a href="/countries/${iso2}" style="${LINK};color:${color}">${escapeHtml(String(p.name))} today →</a>` : '') +
    ` <a href="${UNHCR_DATA_URL}" target="_blank" rel="noopener noreferrer" style="${LINK};color:#94a3b8;margin-left:8px">UNHCR ↗</a>`
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

// ── Wikidata layers (files on our server) ────────────────────────────────────

const NUCLEAR_COLOR: Record<string, string> = {
  'operating': '#facc15', 'status not recorded': '#eab308', 'under construction': '#fef08a', 'shut down': '#64748b',
}

function wikidataFeatures(colorOf: (p: Record<string, unknown>) => string | null) {
  return (json: unknown): OverlayFeature[] => {
    const list = (json as { features?: unknown })?.features
    if (!Array.isArray(list)) return []
    const out: OverlayFeature[] = []
    for (const f of list as Array<{ geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> }>) {
      const c = Array.isArray(f?.geometry?.coordinates) ? f.geometry!.coordinates as unknown[] : []
      const at = pointAt(c[1], c[0])
      const p = f?.properties ?? {}
      if (!at || !str(p.name)) continue
      out.push(feature(at, {
        name: str(p.name), country: str(p.country), status: str(p.status), kind: str(p.kind),
        mw: num(p.mw), operator: str(p.operator), wikidata: /^Q\d+$/.test(String(p.wikidata ?? '')) ? String(p.wikidata) : null,
        color: colorOf(p),
      }))
    }
    return out
  }
}

function wikidataLink(q: unknown): string {
  const id = str(q)
  return id && /^Q\d+$/.test(id)
    ? `<a href="https://www.wikidata.org/wiki/${id}" target="_blank" rel="noopener noreferrer" style="${LINK};color:#94a3b8">Wikidata ↗</a>`
    : ''
}

function wikidataPopup(label: string, color: string, facts: (p: Record<string, unknown>) => Array<string | null>) {
  return (p: Record<string, unknown>) => {
    const line = facts(p).filter(Boolean).join(' · ')
    return header(color, label) +
      `<div style="${TITLE}">${escapeHtml(p.name)}</div>` +
      (str(p.country) ? `<div style="${META}">${escapeHtml(p.country)}</div>` : '') +
      (line ? `<div style="${META}">${escapeHtml(line)}</div>` : '') +
      wikidataLink(p.wikidata)
  }
}

// ── Airports, seaports and big power plants: open data kept as files (Nov 21, 2026) ──

/** A plant's main fuel; others (cogeneration, geothermal, petcoke) take the layer's colour */
const POWER_COLOR: Record<string, string> = { Coal: '#a8a29e', Gas: '#fb923c', Oil: '#d97706', Hydro: '#38bdf8', Solar: '#fde047', Wind: '#86efac' }
/** The biggest plant in the file (Three Gorges): a circle's area follows a plant's power against it */
const POWER_MAX_MW = 22_500
export const WRI_CREDIT = 'WRI Global Power Plant Database (CC BY 4.0), last updated 2021'

function placeFeatures(extra: (p: Record<string, unknown>) => OverlayFeature['properties']) {
  return (json: unknown): OverlayFeature[] => {
    const list = (json as { features?: unknown })?.features
    if (!Array.isArray(list)) return []
    const out: OverlayFeature[] = []
    for (const f of list as Array<{ geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> }>) {
      const c = Array.isArray(f?.geometry?.coordinates) ? f.geometry!.coordinates as unknown[] : []
      const at = pointAt(c[1], c[0])
      const p = f?.properties ?? {}
      if (!at || !str(p.name)) continue
      out.push(feature(at, { name: str(p.name), country: str(p.country), ...extra(p) }))
    }
    return out
  }
}

function outLink(url: unknown, text: string): string {
  const href = safeHttpUrl(url)
  return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" style="${LINK};color:#94a3b8">${escapeHtml(text)} ↗</a>` : ''
}

function airportPopup(p: Record<string, unknown>): string {
  const place = [str(p.city), str(p.country)].filter(Boolean).join(', ')
  return header('#93c5fd', 'AIRPORT') +
    `<div style="${TITLE}">${escapeHtml(p.name)}</div>` +
    (str(p.code) ? `<div style="${META}">${escapeHtml(p.code)}</div>` : '') +
    (place ? `<div style="${META}">${escapeHtml(place)}</div>` : '') +
    outLink(p.link, 'Wikipedia')
}

function portPopup(p: Record<string, unknown>): string {
  return header('#5eead4', 'SEAPORT') +
    `<div style="${TITLE}">${escapeHtml(p.name)}</div>` +
    (str(p.country) ? `<div style="${META}">${escapeHtml(p.country)}</div>` : '') +
    outLink(p.link, 'Website')
}

function powerPopup(p: Record<string, unknown>): string {
  const mw = num(p.mw)
  const year = num(p.year)
  const line = [str(p.fuel), mw ? `${mw.toLocaleString('en-US')} MW` : null, year ? `since ${year}` : null].filter(Boolean).join(' · ')
  return header('#fdba74', 'POWER PLANT') +
    `<div style="${TITLE}">${escapeHtml(p.name)}</div>` +
    (str(p.country) ? `<div style="${META}">${escapeHtml(p.country)}</div>` : '') +
    (line ? `<div style="${META}">${escapeHtml(line)}</div>` : '') +
    (str(p.owner) ? `<div style="${META}">${escapeHtml(p.owner)}</div>` : '') +
    `<div style="${META};font-size:10px">${escapeHtml(WRI_CREDIT)}</div>`
}

// ── Storms and other open events (NASA EONET) and the aurora forecast (NOAA), Nov 22, 2026 ──

export const EONET_LABEL: Record<string, string> = {
  severeStorms: 'SEVERE STORM', floods: 'FLOOD', landslides: 'LANDSLIDE', dustHaze: 'DUST AND HAZE', drought: 'DROUGHT',
  tempExtremes: 'HEAT OR COLD', snow: 'HEAVY SNOW', manmade: 'MAN-MADE EVENT',
}
const EONET_COLOR: Record<string, string> = {
  floods: '#60a5fa', landslides: '#d97706', dustHaze: '#d6d3d1', drought: '#eab308', tempExtremes: '#f87171', snow: '#e0f2fe', manmade: '#c4b5fd',
}
/** A storm's colour by its winds (knots): hurricane or typhoon strength, a tropical storm, weaker; its earlier positions paler */
function stormColor(kts: number | null, now: boolean): string {
  if (!now) return '#fda4af'
  return kts !== null && kts >= 64 ? '#f43f5e' : kts !== null && kts >= 34 ? '#fb923c' : '#fcd34d'
}
const STORM_NAME = /\b(tropical cyclone|cyclone|hurricane|typhoon|tropical storm|tropical depression)\b/i
const utcTime = (iso: unknown) => {
  // a time written without a zone is UTC
  const t = String(iso ?? '')
  const d = new Date(/T\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(t) ? `${t}Z` : t)
  return Number.isNaN(d.getTime()) ? null : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}, ${d.toISOString().slice(11, 16)} UTC`
}

function eonetFeatures(json: unknown): OverlayFeature[] {
  const list = (json as { features?: unknown })?.features
  if (!Array.isArray(list)) return []
  const out: OverlayFeature[] = []
  for (const f of list as Array<{ geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> }>) {
    const c = Array.isArray(f?.geometry?.coordinates) ? f.geometry!.coordinates as unknown[] : []
    const at = pointAt(c[1], c[0])
    const p = f?.properties ?? {}
    const category = str(p.category)
    if (!at || !str(p.title) || !category || !EONET_LABEL[category]) continue
    const now = p.now !== false
    const kts = num(p.wind_kts)
    // the dot's size: a storm's strength at its newest position, the rest the smallest
    const severity = !now ? 'low' : category !== 'severeStorms' ? 'medium' : kts !== null && kts >= 64 ? 'critical' : kts !== null && kts >= 34 ? 'high' : 'medium'
    out.push(feature(at, {
      title: str(p.title), category, now: now ? 1 : 0, at: str(p.at), since: str(p.since), positions: num(p.positions), wind_kts: kts,
      source: str(p.source), link: safeHttpUrl(p.link), severity,
      color: category === 'severeStorms' ? stormColor(kts, now) : (EONET_COLOR[category] ?? null),
    }))
  }
  return out
}

function eonetPopup(p: Record<string, unknown>): string {
  const category = String(p.category ?? '')
  const title = String(p.title ?? '')
  const kts = num(p.wind_kts)
  const label = category === 'severeStorms' && STORM_NAME.test(title) ? 'TROPICAL CYCLONE' : (EONET_LABEL[category] ?? 'EVENT')
  const now = num(p.now) !== 0
  const when = utcTime(p.at)
  const wind = kts !== null ? `${Math.round(kts)} kt winds (${Math.round(kts * 1.852)} km/h)` : null
  const line = now ? [wind, when ? `as of ${when}` : null] : [when ? `Position on ${when}` : null, wind]
  const since = utcTime(p.since)
  const tracked = now && category === 'severeStorms' && num(p.positions) && since ? `Tracked since ${since.replace(/, \d\d:\d\d UTC$/, '')}, ${num(p.positions)} positions` : null
  return header(stormColor(kts, true), label) +
    `<div style="${TITLE}">${escapeHtml(title)}</div>` +
    (line.filter(Boolean).length ? `<div style="${META}">${escapeHtml(line.filter(Boolean).join(' · '))}</div>` : '') +
    (tracked ? `<div style="${META}">${escapeHtml(tracked)}</div>` : '') +
    outLink(p.link, str(p.source) ?? 'Source') +
    `<div style="${META};font-size:10px">NASA EONET; not an official source for exact places and times</div>`
}

/** The chance of aurora overhead: brighter the likelier */
function auroraColor(chance: number): string {
  return chance >= 60 ? '#bbf7d0' : chance >= 30 ? '#4ade80' : '#15803d'
}

function auroraFeatures(json: unknown): OverlayFeature[] {
  const list = (json as { features?: unknown })?.features
  if (!Array.isArray(list)) return []
  const out: OverlayFeature[] = []
  for (const f of list as Array<{ geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> }>) {
    const c = Array.isArray(f?.geometry?.coordinates) ? f.geometry!.coordinates as unknown[] : []
    const at = pointAt(c[1], c[0])
    const chance = num(f?.properties?.chance)
    if (!at || chance === null || chance < 1 || chance > 100) continue
    out.push(feature(at, { chance: Math.round(chance), forecast: str(f?.properties?.forecast), color: auroraColor(chance) }))
  }
  return out
}

function auroraPopup(p: Record<string, unknown>): string {
  const chance = num(p.chance)
  const when = utcTime(p.forecast)
  return header('#4ade80', 'AURORA FORECAST') +
    `<div style="${TITLE}">${escapeHtml(chance !== null ? `${chance}% chance of aurora overhead` : 'Aurora likely')}</div>` +
    `<div style="${META}">${escapeHtml(when ? `NOAA's forecast for ${when}` : "NOAA's forecast for the next 30 to 90 minutes")}</div>` +
    `<div style="${META};font-size:10px">NOAA SWPC, OVATION model</div>`
}

/** A Copernicus EMS activation's colour by the kind of disaster */
const CEMS_COLOR: Record<string, string> = { flood: '#60a5fa', earthquake: '#f97316', wildfire: '#ef4444', 'forest fire': '#ef4444', storm: '#c084fc', 'wind storm': '#c084fc', landslide: '#d97706', volcano: '#fb7185' }
export const CEMS_CREDIT = 'Copernicus Emergency Management Service (© European Union)'

function cemsFeatures(json: unknown): OverlayFeature[] {
  const list = (json as { features?: unknown })?.features
  if (!Array.isArray(list)) return []
  const out: OverlayFeature[] = []
  for (const f of list as Array<{ geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> }>) {
    const c = Array.isArray(f?.geometry?.coordinates) ? f.geometry!.coordinates as unknown[] : []
    const at = pointAt(c[1], c[0])
    const p = f?.properties ?? {}
    const code = str(p.code)
    if (!at || !code || !/^EMSR\d+$/.test(code) || !str(p.name)) continue
    const closed = p.closed === true
    out.push(feature(at, {
      code, name: str(p.name), category: str(p.category), countries: str(p.countries), activated_at: str(p.activated_at),
      closed: closed ? 1 : 0, maps: num(p.maps), link: safeHttpUrl(p.link),
      // still being mapped: a bigger dot
      severity: closed ? 'medium' : 'high',
      color: CEMS_COLOR[String(p.category ?? '').toLowerCase()] ?? '#e2e8f0',
    }))
  }
  return out
}

function cemsPopup(p: Record<string, unknown>): string {
  const when = utcTime(p.activated_at)
  const maps = num(p.maps)
  const line = [str(p.category), str(p.countries), when ? `activated ${when.replace(/, \d\d:\d\d UTC$/, '')}` : null].filter(Boolean).join(' · ')
  const state = num(p.closed) === 1 ? `Closed${maps ? `: ${maps} maps made` : ''}` : `Still being mapped${maps ? `: ${maps} maps so far` : ''}`
  return header('#38bdf8', `SATELLITE DISASTER MAPS · ${escapeHtml(p.code)}`) +
    `<div style="${TITLE}">${escapeHtml(p.name)}</div>` +
    (line ? `<div style="${META}">${escapeHtml(line)}</div>` : '') +
    `<div style="${META}">${escapeHtml(state)}</div>` +
    outLink(p.link, 'The maps') +
    `<div style="${META};font-size:10px">${escapeHtml(CEMS_CREDIT)}</div>`
}

// ── Shipping headlines (Lloyd's List's free feed, credited) ───────────────────

const SHIPPING_COLOR = '#22d3ee'
export const LLOYDS_LIST_CREDIT = "Headlines: Lloyd's List (lloydslist.com)"

/** A circle per place the headlines are tagged with, its headlines kept on it for the popup */
export function shippingFeatures(json: unknown): OverlayFeature[] {
  const items = (json as { data?: { items?: unknown } })?.data?.items
  if (!Array.isArray(items)) return []
  const byPlace = new Map<string, { name: string; at: [number, number]; list: Array<{ title: string; url: string; published: string; kind: string | null }> }>()
  for (const it of items as Array<Record<string, unknown>>) {
    const title = str(it.title), url = safeHttpUrl(it.url), published = str(it.published)
    // Only links to lloydslist.com: the popup sends readers to the article there
    if (!title || !url || !/^https:\/\/(www\.)?lloydslist\.com\//.test(url) || !published || !Array.isArray(it.places)) continue
    for (const p of it.places as Array<Record<string, unknown>>) {
      const key = str(p.key), at = pointAt(p.lat, p.lon)
      if (!key || !at) continue
      const place = byPlace.get(key) ?? (byPlace.set(key, { name: str(p.name) ?? key, at, list: [] }), byPlace.get(key)!)
      place.list.push({ title, url, published, kind: str(it.kind) })
    }
  }
  const most = Math.max(1, ...[...byPlace.values()].map(p => p.list.length))
  return [...byPlace.entries()].map(([key, p]) => feature(p.at, {
    key, name: p.name, count: p.list.length, size: Math.max(0.15, p.list.length / most),
    items: JSON.stringify(p.list.slice(0, 6)),
  }))
}

export function shippingPopup(p: Record<string, unknown>): string {
  let list: Array<{ title?: unknown; url?: unknown; published?: unknown; kind?: unknown }> = []
  try { list = JSON.parse(String(p.items ?? '[]')) } catch { list = [] }
  const n = num(p.count) ?? list.length
  const rows = list.map(it => {
    const url = safeHttpUrl(it.url)
    if (!url || !/^https:\/\/(www\.)?lloydslist\.com\//.test(url)) return ''
    const meta = [str(it.kind), str(it.published) ? timeAgo(String(it.published)) : null].filter(Boolean).join(' · ')
    return `<div style="margin-top:7px"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="${TITLE};display:block;text-decoration:none">${escapeHtml(it.title)} ↗</a>` +
      (meta ? `<div style="${META}">${escapeHtml(meta)}</div>` : '') + '</div>'
  }).join('')
  return header(SHIPPING_COLOR, `SHIPPING NEWS · ${String(p.name ?? '').toUpperCase()}`) +
    `<div style="${META}">${n} headline${n === 1 ? '' : 's'} in the last two weeks</div>` + rows +
    `<div style="${META};margin-top:8px">${escapeHtml(LLOYDS_LIST_CREDIT)}</div>`
}

// ── Satellites (CelesTrak, placed by satellite.js) ────────────────────────────

function satellitePopup(p: Record<string, unknown>): string {
  const color = OVERLAYS.satellites.color
  const km = num(p.km), kms = num(p.kms), norad = num(p.norad)
  const facts = [km != null ? `${km.toLocaleString('en-US')} km up` : null, kms != null ? `${kms} km/s` : null, norad ? `NORAD ${norad}` : null].filter(Boolean).join(' · ')
  return header(color, `SATELLITE · ${String(p.kind ?? '').toUpperCase()}`) +
    `<div style="${TITLE}">${escapeHtml(p.name)}</div>` +
    (facts ? `<div style="${META}">${escapeHtml(facts)}</div>` : '') +
    `<div style="${META}">Where it is now, worked out from CelesTrak's orbital elements</div>` +
    (norad ? `<a href="https://celestrak.org/satcat/table-satcat.php?CATNR=${norad}&MAX=1" target="_blank" rel="noopener noreferrer" style="${LINK};color:#94a3b8">CelesTrak ↗</a>` : '')
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
    description: 'People displaced, fleeing or seeking asylum, in the news, last 72 h',
    path: '/api/v1/map/topics/displacement', refreshMs: 10 * MINUTE, bySeverity: true,
    toFeatures: topicFeatures, popup: topicPopup('REFUGEES & DISPLACEMENT', '#fde68a'),
  },
  displaced: {
    key: 'displaced', label: 'Displaced people (UNHCR)', color: '#2dd4bf',
    description: 'Refugees, asylum-seekers and people displaced inside their own country: UNHCR\'s 2025 figures (CC BY 4.0), added up by country',
    path: DISPLACED_FILE, base: 'site', refreshMs: 24 * HOUR, bySeverity: false, sized: true,
    toFeatures: displacedFeatures, popup: displacedPopup,
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
  nuclear: {
    key: 'nuclear', label: 'Nuclear power plants', color: '#facc15',
    description: 'About 300 plants, operating, being built or shut down (Wikidata)',
    path: '/geo/nuclear-plants.v1.geojson', base: 'site', refreshMs: 24 * HOUR, bySeverity: false,
    toFeatures: wikidataFeatures(p => NUCLEAR_COLOR[String(p.status ?? '')] ?? null),
    popup: wikidataPopup('NUCLEAR POWER PLANT', '#facc15', p => {
      const mw = num(p.mw)
      return [str(p.status), mw ? `${mw.toLocaleString('en-US')} MW` : null, str(p.operator)]
    }),
  },
  bases: {
    key: 'bases', label: 'Military bases', color: '#d4d4d8',
    description: 'About 1,800 air, naval and army bases (Wikidata; incomplete, a few may be closed)',
    path: '/geo/military-bases.v1.geojson', base: 'site', refreshMs: 24 * HOUR, bySeverity: false,
    toFeatures: wikidataFeatures(() => null),
    popup: wikidataPopup('MILITARY BASE', '#d4d4d8', p => [str(p.kind), str(p.operator)]),
  },
  spaceports: {
    key: 'spaceports', label: 'Spaceports', color: '#22c55e',
    description: 'Launch sites and spaceports, past and present (Wikidata)',
    path: '/geo/spaceports.v1.geojson', base: 'site', refreshMs: 24 * HOUR, bySeverity: false,
    toFeatures: wikidataFeatures(p => String(p.status ?? '') === 'shut down' ? '#64748b' : null),
    popup: wikidataPopup('SPACEPORT', '#22c55e', p => [str(p.status) === 'active or not recorded' ? null : str(p.status), str(p.operator)]),
  },
  'shipping-news': {
    key: 'shipping-news', label: "Shipping news (Lloyd's List)", color: SHIPPING_COLOR,
    description: "Lloyd's List's headlines on the countries and sea lanes they're about (its free feed, credited; each opens on lloydslist.com)",
    path: '/api/v1/maritime/headlines?limit=100', refreshMs: 30 * MINUTE, bySeverity: false, sized: true,
    toFeatures: shippingFeatures, popup: shippingPopup,
  },
  airports: {
    key: 'airports', label: 'Airports', color: '#93c5fd',
    description: 'About 1,150 large airports with scheduled flights (OurAirports, public domain)',
    path: '/geo/airports.v1.geojson', base: 'site', refreshMs: 24 * HOUR, bySeverity: false,
    toFeatures: placeFeatures(p => ({ code: str(p.code), city: str(p.city), link: safeHttpUrl(p.link) })),
    popup: airportPopup,
  },
  ports: {
    key: 'ports', label: 'Seaports', color: '#5eead4',
    description: 'About 1,100 seaports (Natural Earth, public domain)',
    path: '/geo/ports.v1.geojson', base: 'site', refreshMs: 24 * HOUR, bySeverity: false,
    toFeatures: placeFeatures(p => ({ link: safeHttpUrl(p.link) })),
    popup: portPopup,
  },
  power: {
    key: 'power', label: 'Power plants (1 GW+)', color: '#fdba74',
    description: 'About 1,450 coal (grey), gas (orange), oil (amber) and hydro (blue) plants of 1,000 MW or more, sized by power. WRI\'s database (CC BY 4.0), last updated 2021: newer plants are missing. Nuclear plants are their own layer.',
    path: '/geo/power-plants.v1.geojson', base: 'site', refreshMs: 24 * HOUR, bySeverity: false, sized: true,
    toFeatures: placeFeatures(p => {
      const mw = num(p.mw)
      const fuel = str(p.fuel)
      return {
        fuel, mw, owner: str(p.owner), year: num(p.year),
        // the circle's area follows the plant's power
        size: mw && mw > 0 ? Math.min(1, Math.sqrt(mw / POWER_MAX_MW)) : null,
        color: (fuel && POWER_COLOR[fuel]) ?? null,
      }
    }),
    popup: powerPopup,
  },
  storms: {
    key: 'storms', label: 'Storms & floods', color: '#fb7185',
    description: 'Tropical cyclones where they are now, with their tracks, and floods, landslides, dust storms, droughts, heat and cold waves tracked by NASA (EONET, public domain); updated every 30 minutes',
    path: '/api/v1/map/storms', refreshMs: 30 * MINUTE, bySeverity: true,
    toFeatures: eonetFeatures, popup: eonetPopup,
  },
  aurora: {
    key: 'aurora', label: 'Aurora now', color: '#4ade80',
    description: "Where the northern and southern lights are likely in the next 30 to 90 minutes, brighter the likelier: NOAA's forecast (public domain), updated every 15 minutes",
    path: '/api/v1/map/aurora', refreshMs: 15 * MINUTE, bySeverity: false,
    toFeatures: auroraFeatures, popup: auroraPopup,
  },
  'disaster-maps': {
    key: 'disaster-maps', label: 'Satellite disaster maps', color: '#7dd3fc',
    description: "Where the EU's Copernicus emergency service had satellites map a disaster in the last 12 months, each with a link to its maps (© European Union); bigger while still being mapped",
    path: '/api/v1/map/satellite-maps', refreshMs: HOUR, bySeverity: true,
    toFeatures: cemsFeatures, popup: cemsPopup,
  },
  satellites: {
    key: 'satellites', label: 'Satellites', color: '#e2e8f0',
    description: 'About 500 satellites where they are now: space stations, navigation, weather, Earth observation, military',
    path: '/api/v1/map/satellites', refreshMs: 6 * HOUR, bySeverity: false,
    toFeatures: () => [], popup: satellitePopup,
    live: {
      everyMs: 5000,
      prepare: (json, fetchImpl) => prepareSatellites(json, fetchImpl),
      at: (prepared, now) => satellitePositions(prepared as PreparedSats, now),
    },
  },
}
