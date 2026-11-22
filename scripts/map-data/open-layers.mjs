#!/usr/bin/env node
/**
 * Three World Map layers from open data (Nov 21, 2026; Devon: "keep me updated on more map layers"), written to
 * apps/web/public/geo/ as GeoJSON like the Wikidata layers (wikidata-layers.py):
 *
 *   - airports.v1.geojson: airports with scheduled flights that OurAirports rates large (about 1,150).
 *     OurAirports' data is in the public domain (ourairports.com/data), kept on GitHub
 *     (davidmegginson/ourairports-data) and updated every day.
 *   - ports.v1.geojson: Natural Earth's 1:10m seaports (about 1,100; public domain, naturalearthdata.com),
 *     from its GitHub copy (nvkelso/natural-earth-vector). Its scalerank is how far out a map shows a port, not
 *     the port's size (Anchorage outranks Rotterdam), so it is left out. It gives no country, so each port takes the country it stands in on Natural Earth's 1:10m country shapes
 *     (ne_10m_admin_0_countries.geojson, from the same copy; used here only), or the nearest one within 25 km,
 *     as ports are on the coast; none when no shape is that close.
 *   - power-plants.v1.geojson: power plants of 1,000 MW or more, nuclear left out (it is its own layer),
 *     from WRI's Global Power Plant Database (CC BY 4.0, to be credited; github.com/wri/global-power-plant-database).
 *     WRI stopped updating it in 2021, so plants built since are missing and a few shown may have closed.
 *
 * Run by hand when the layers should be refreshed (a few times a year), from the repository's root:
 *     node scripts/map-data/open-layers.mjs <folder with the downloads>
 * where the folder holds the four files as their sources name them: airports.csv, ne_10m_ports.geojson,
 * ne_10m_admin_0_countries.geojson and global_power_plant_database.csv. It prints what it kept and why it left the rest out.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'apps', 'web', 'public', 'geo')
const SRC = process.argv[2]
if (!SRC) { console.error('usage: node scripts/map-data/open-layers.mjs <folder with the downloads>'); process.exit(2) }
const TODAY = new Date().toISOString().slice(0, 10)
const regionName = new Intl.DisplayNames(['en'], { type: 'region' })

/** RFC 4180 CSV: quoted fields with commas, doubled quotes and line breaks */
export function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  const [head, ...body] = rows
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

const round = (n, places = 4) => Math.round(n * 10 ** places) / 10 ** places
const httpUrl = (s) => /^https?:\/\/[^\s"<>]+$/i.test(String(s ?? '').trim()) ? String(s).trim().replace(/^http:/i, 'https:') : null
const point = (lat, lng) => {
  const la = Number(lat), lo = Number(lng)
  return Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && !(la === 0 && lo === 0) ? [round(lo), round(la)] : null
}
/** Names as the site writes them (apps/web/src/lib/story-reach.ts), else Unicode's */
const COUNTRY_LABELS = {
  CD: 'DR Congo', CG: 'Congo', MM: 'Myanmar', HK: 'Hong Kong', MO: 'Macau', PS: 'Palestine', TR: 'Turkey',
  CZ: 'Czech Republic', BA: 'Bosnia and Herzegovina', TT: 'Trinidad and Tobago', AG: 'Antigua and Barbuda',
  KN: 'St Kitts and Nevis', LC: 'St Lucia', VC: 'St Vincent and the Grenadines', ST: 'São Tomé and Príncipe',
  VA: 'Vatican City', FM: 'Micronesia', TC: 'Turks and Caicos Islands',
}
const country = (code) => {
  const c = String(code ?? '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return null
  if (COUNTRY_LABELS[c]) return COUNTRY_LABELS[c]
  try { const n = regionName.of(c); return n && n !== c ? n.replace(/ & /g, ' and ') : null } catch { return null }
}

/**
 * Natural Earth draws borders where a government is in control. The map follows the UN's view, as the rest of the
 * site does: Crimea is Ukraine's, Northern Cyprus is part of Cyprus, Somaliland of Somalia, and Western Sahara (south
 * of 27°40′ N) is a territory of its own, not Morocco's.
 */
export function unView([lng, lat], name) {
  if (name === 'Russia' && lat >= 44.3 && lat <= 46.25 && lng >= 32.4 && lng <= 36.6) return 'Ukraine'
  if (/northern cyprus|^n\. cyprus$/i.test(name ?? '')) return 'Cyprus'
  if (/^somaliland$/i.test(name ?? '')) return 'Somalia'
  if (name === 'Morocco' && lat < 27.667) return 'Western Sahara'
  return name
}

function write(name, about, features) {
  const file = join(OUT, name)
  writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', about, features }) + '\n')
  console.log(`${name}: ${features.length} kept`)
}

// ── Airports ─────────────────────────────────────────────────────────────────
{
  const rows = parseCsv(readFileSync(join(SRC, 'airports.csv'), 'utf8'))
  const left = { 'not large': 0, 'marked duplicate': 0, 'no scheduled flights': 0, 'no place': 0 }
  const features = []
  for (const r of rows) {
    if (r.type !== 'large_airport') { left['not large']++; continue }
    if (/^\(duplicate\)/i.test(r.name.trim())) { left['marked duplicate']++; continue }
    if (r.scheduled_service !== 'yes') { left['no scheduled flights']++; continue }
    const at = point(r.latitude_deg, r.longitude_deg)
    if (!at) { left['no place']++; continue }
    features.push({
      type: 'Feature', geometry: { type: 'Point', coordinates: at },
      properties: {
        name: r.name.trim(),
        code: [r.iata_code, r.icao_code || r.gps_code].map(s => s.trim()).filter(Boolean).join(' · ') || null,
        city: r.municipality.trim() || null,
        country: country(r.iso_country),
        link: httpUrl(r.wikipedia_link),
      },
    })
  }
  features.sort((a, b) => a.properties.name.localeCompare(b.properties.name))
  console.log('airports left out:', left)
  write('airports.v1.geojson', `Large airports with scheduled flights. OurAirports (public domain), github.com/davidmegginson/ourairports-data, ${TODAY}.`, features)
}

// ── Seaports ─────────────────────────────────────────────────────────────────

/** Is the point inside the ring (ray casting; [lng, lat] pairs)? */
function inRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Kilometres between two [lng, lat] points */
function km([lo1, la1], [lo2, la2]) {
  const r = Math.PI / 180
  const a = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(a))
}

{
  const shapes = JSON.parse(readFileSync(join(SRC, 'ne_10m_admin_0_countries.geojson'), 'utf8')).features.map(f => {
    const g = f.geometry ?? {}
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    const p = f.properties ?? {}
    const code = [p.ISO_A2_EH, p.ISO_A2, p.iso_a2].find(c => /^[A-Z]{2}$/.test(String(c ?? '')))
    return { name: country(code) ?? p.NAME_EN ?? p.NAME ?? p.ADMIN ?? null, polys }
  }).filter(s => s.name && s.polys.length)
  const named = new Set(shapes.map(s => s.name))
  const countryAt = (at, portName) => {
    // a port named for its territory (Gibraltar, Monaco, Singapore) is that territory's, whichever shore is nearer
    if (named.has(portName)) return portName
    for (const s of shapes) if (s.polys.some(poly => inRing(at, poly[0]) && !poly.slice(1).some(hole => inRing(at, hole)))) return unView(at, s.name)
    let best = null, bestKm = 25
    for (const s of shapes) for (const poly of s.polys) for (const v of poly[0]) {
      const d = km(at, v)
      if (d < bestKm) { bestKm = d; best = s.name }
    }
    return best && unView(at, best)
  }
  const src = JSON.parse(readFileSync(join(SRC, 'ne_10m_ports.geojson'), 'utf8'))
  const left = { 'no place or name': 0 }
  let noCountry = 0
  const features = []
  for (const f of src.features ?? []) {
    const c = f.geometry?.coordinates ?? []
    const at = point(c[1], c[0])
    const p = f.properties ?? {}
    const name = String(p.name ?? '').trim()
    if (!at || !name) { left['no place or name']++; continue }
    const where = countryAt(at, name)
    if (!where) noCountry++
    features.push({
      type: 'Feature', geometry: { type: 'Point', coordinates: at },
      properties: {
        name,
        country: where,
        link: httpUrl(p.website),
      },
    })
  }
  features.sort((a, b) => a.properties.name.localeCompare(b.properties.name))
  console.log('ports left out:', left, `(${noCountry} kept with no country)`)
  write('ports.v1.geojson', `Seaports. Natural Earth 1:10m ports (public domain), github.com/nvkelso/natural-earth-vector, ${TODAY}; countries from Natural Earth's 1:10m country shapes.`, features)
}

// ── Power plants of 1 GW or more ────────────────────────────────────────────

/** WRI's long names the site writes shorter (as lib/story-reach.ts) */
const WRI_NAMES = { 'United States of America': 'United States', 'Syrian Arab Republic': 'Syria', 'Democratic Republic of the Congo': 'DR Congo' }
{
  const rows = parseCsv(readFileSync(join(SRC, 'global_power_plant_database.csv'), 'utf8'))
  const left = { 'under 1,000 MW': 0, 'nuclear (its own layer)': 0, 'no place': 0 }
  const features = []
  for (const r of rows) {
    const mw = Number(r.capacity_mw)
    if (!(mw >= 1000)) { left['under 1,000 MW']++; continue }
    if (r.primary_fuel === 'Nuclear') { left['nuclear (its own layer)']++; continue }
    const at = point(r.latitude, r.longitude)
    if (!at) { left['no place']++; continue }
    const year = Math.round(Number(r.commissioning_year))
    features.push({
      type: 'Feature', geometry: { type: 'Point', coordinates: at },
      properties: {
        name: r.name.trim(),
        country: WRI_NAMES[r.country_long.trim()] ?? (r.country_long.trim() || null),
        fuel: r.primary_fuel.trim() || null,
        mw: Math.round(mw),
        owner: r.owner.trim() || null,
        year: year >= 1900 && year <= 2030 ? year : null,
      },
    })
  }
  features.sort((a, b) => b.properties.mw - a.properties.mw)
  console.log('power plants left out:', left)
  write('power-plants.v1.geojson', `Power plants of 1,000 MW or more, nuclear left out. WRI Global Power Plant Database v1.3.0 (CC BY 4.0), github.com/wri/global-power-plant-database, last updated by WRI in 2021; read ${TODAY}.`, features)
}
