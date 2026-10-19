/**
 * Live aircraft for the map (Oct 19, 2026, Map Lab; Devon: "Ship and Aircraft
 * data do not populate").
 *
 * The map's Aircraft layer asked for stories in category "aviation", which the
 * classifier stopped using in April, so it stayed empty. Now it shows
 * positions from adsb.lol, a community ADS-B network whose API needs no key
 * and whose data is under the ODbL (the OpenStreetMap licence: free to use,
 * commercially too, with credit; a database made from it stays ODbL):
 *
 *   /v2/mil            military aircraft worldwide
 *   /v2/sqk/7700|7600|7500  aircraft squawking an emergency, radio failure or hijack
 *
 * Read on the server at most every 3 minutes (served up to 30 minutes old
 * while a fresh read runs, so a slow or refusing adsb.lol never holds a page
 * up). Aircraft flying under a privacy programme (PIA, LADD) are left out.
 * Not OpenSky: its licence rules out commercial use.
 */

import { redis } from '../db/redis'
import { logger } from './logger'

export const ADSB_LOL = 'https://api.adsb.lol/v2'
export const AIRCRAFT_FRESH_MS = 3 * 60_000
export const AIRCRAFT_STALE_MS = 30 * 60_000
const CACHE_KEY = 'aircraft:live:v1'
const USER_AGENT = 'WorldPulse/1.0 (+https://world-pulse.io)'
/** A position older than this isn't "now" */
const MAX_POSITION_AGE_S = 120

export const EMERGENCY_SQUAWKS: Record<string, string> = {
  '7500': 'Hijack',
  '7600': 'Radio failure',
  '7700': 'Emergency',
}

export interface LiveAircraft {
  hex:       string
  callsign:  string | null
  reg:       string | null
  /** ICAO type code, e.g. "C17" */
  type:      string | null
  /** Its description, e.g. "BOEING C-17A Globemaster III" */
  desc:      string | null
  operator:  string | null
  lat:       number
  lng:       number
  /** Feet, or "ground" */
  alt:       number | 'ground' | null
  /** Ground speed, knots */
  speed:     number | null
  /** Degrees from north */
  track:     number | null
  squawk:    string | null
  /** "Emergency", "Radio failure" or "Hijack" when it squawks one */
  emergency: string | null
  military:  boolean
}

export interface AircraftSnapshot {
  at:       string
  source:   'adsb.lol'
  license:  'ODbL 1.0'
  aircraft: LiveAircraft[]
  counts:   { military: number; emergency: number }
  /** Reads that failed this time (the rest still count) */
  failed:   string[]
}

interface ReadsbAircraft {
  hex?: string; flight?: string; r?: string; t?: string; desc?: string; ownOp?: string
  lat?: number; lon?: number; alt_baro?: number | string; gs?: number; track?: number; true_heading?: number
  squawk?: string; emergency?: string; dbFlags?: number; seen_pos?: number; seen?: number
}

const clean = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s.slice(0, 60) : null
}

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** One aircraft from readsb's JSON, or null (no position, too old, or flying under a privacy programme) */
export function toLiveAircraft(a: ReadsbAircraft, fromMil = false): LiveAircraft | null {
  const lat = finite(a.lat)
  const lng = finite(a.lon)
  const hex = clean(a.hex)?.toLowerCase().replace(/^~/, '') ?? null
  if (lat == null || lng == null || !hex || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  const flags = finite(a.dbFlags) ?? 0
  // 4: PIA (privacy ICAO address), 8: LADD (limited display): not shown
  if (flags & 4 || flags & 8) return null
  const age = finite(a.seen_pos) ?? finite(a.seen) ?? 0
  if (age > MAX_POSITION_AGE_S) return null
  const squawk = clean(a.squawk)
  const alt = a.alt_baro === 'ground' ? 'ground' : finite(a.alt_baro)
  return {
    hex,
    callsign:  clean(a.flight),
    reg:       clean(a.r),
    type:      clean(a.t),
    desc:      clean(a.desc),
    operator:  clean(a.ownOp),
    lat:       Math.round(lat * 1e4) / 1e4,
    lng:       Math.round(lng * 1e4) / 1e4,
    alt,
    speed:     finite(a.gs) != null ? Math.round(a.gs as number) : null,
    track:     finite(a.track) ?? finite(a.true_heading),
    squawk,
    emergency: squawk && EMERGENCY_SQUAWKS[squawk] ? EMERGENCY_SQUAWKS[squawk] : null,
    military:  fromMil || (flags & 1) === 1,
  }
}

async function readList(path: string, fetchImpl: typeof fetch): Promise<ReadsbAircraft[]> {
  const res = await fetchImpl(`${ADSB_LOL}/${path}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal:  AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  const json = await res.json() as { ac?: ReadsbAircraft[] }
  return Array.isArray(json.ac) ? json.ac : []
}

/** Reads adsb.lol now: military aircraft and emergency squawks, one list after another (a few seconds apart) */
export async function readAircraft(fetchImpl: typeof fetch = fetch, pauseMs = 1_500): Promise<AircraftSnapshot> {
  const byHex = new Map<string, LiveAircraft>()
  const failed: string[] = []
  const paths = ['mil', 'sqk/7700', 'sqk/7600', 'sqk/7500']
  for (const [i, path] of paths.entries()) {
    if (i > 0 && pauseMs > 0) await new Promise(r => setTimeout(r, pauseMs))
    try {
      for (const raw of await readList(path, fetchImpl)) {
        const a = toLiveAircraft(raw, path === 'mil')
        if (!a) continue
        const had = byHex.get(a.hex)
        byHex.set(a.hex, had ? { ...had, ...a, military: had.military || a.military, emergency: a.emergency ?? had.emergency } : a)
      }
    } catch (err) {
      failed.push(path)
      logger.warn({ err, path }, 'adsb.lol read failed')
    }
  }
  const aircraft = [...byHex.values()]
  return {
    at: new Date().toISOString(), source: 'adsb.lol', license: 'ODbL 1.0', aircraft,
    counts: { military: aircraft.filter(a => a.military).length, emergency: aircraft.filter(a => a.emergency).length },
    failed,
  }
}

let refreshing: Promise<AircraftSnapshot | null> | null = null

const LOCK_KEY = 'aircraft:live:lock'

function refresh(): Promise<AircraftSnapshot | null> {
  if (!refreshing) {
    refreshing = (async () => {
      // one read at a time across the API's processes
      const lock = await redis.set(LOCK_KEY, '1', 'EX', 60, 'NX').catch(() => 'OK')
      if (lock !== 'OK') return null
      try { return await readAircraft() } finally { await redis.del(LOCK_KEY).catch(() => {}) }
    })()
      .then(async snap => {
        if (!snap) return null
        // a read where everything failed keeps the last good snapshot
        if (snap.aircraft.length === 0 && snap.failed.length > 0) return null
        await redis.set(CACHE_KEY, JSON.stringify(snap), 'EX', Math.ceil(AIRCRAFT_STALE_MS / 1000)).catch(() => {})
        return snap
      })
      .catch(() => null)
      .finally(() => { refreshing = null })
  }
  return refreshing
}

/** The newest snapshot: fresh for 3 minutes; older (up to 30) is served while a new read runs */
export async function liveAircraft(now = Date.now()): Promise<AircraftSnapshot | null> {
  let kept: AircraftSnapshot | null = null
  try {
    const raw = await redis.get(CACHE_KEY)
    if (raw) kept = JSON.parse(raw) as AircraftSnapshot
  } catch { /* read it below */ }
  if (kept) {
    if (now - Date.parse(kept.at) > AIRCRAFT_FRESH_MS) void refresh()
    return kept
  }
  return refresh()
}
