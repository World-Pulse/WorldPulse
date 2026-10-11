/**
 * USGS Volcano Alert Signal Source
 *
 * Reports US volcanoes (Alaska, Cascades, Hawaii, Yellowstone, the Northern
 * Mariana Islands) whose USGS alert level is above normal, once each time a
 * volcano's alert level or aviation color code changes.
 *
 * API: https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes
 * (USGS Hazard Notification System, public JSON, no key). Each volcano links
 * to its latest notice, whose JSON gives the volcano's coordinates and a
 * one-line synopsis. The older /hans2/api/volcanoAlerts address is gone (404).
 * Volcano numbers (vnum) are the Smithsonian Global Volcanism Program's.
 *
 * Reliability: 0.93 (USGS VHP is the authoritative US volcanic hazard
 *   assessment agency)
 * Category: disaster
 *
 * Complements USGS seismic + NASA FIRMS fire feeds with volcanic
 * eruption intelligence.
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { fetchWithResilience, CircuitOpenError } from '../lib/fetch-with-resilience'

const log = rootLogger.child({ module: 'gvp-volcano-source' })

const USGS_ORIGIN = 'https://volcanoes.usgs.gov/'
const USGS_ELEVATED_URL = 'https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes'
const RELIABILITY = 0.93
/** Hash of vnum -> "WATCH/ORANGE": the level last reported for each elevated volcano */
const LEVELS_KEY = 'osint:gvp:levels'
const LEVELS_TTL_S = 60 * 86_400
const USER_AGENT = 'WorldPulse/1.0 (https://world-pulse.io)'
const POLL_INTERVAL_MS = Number(process.env.GVP_INTERVAL_MS) || 30 * 60_000 // 30 min

// ─── SEVERITY MAPPING ───────────────────────────────────────────────────────

/**
 * USGS Volcanic Alert Levels → WorldPulse severity
 *
 * WARNING = hazardous eruption imminent or underway → critical
 * WATCH = elevated/escalating unrest with potential eruption → high
 * ADVISORY = elevated unrest above known background → medium
 * NORMAL = typical background activity → low
 */
const ALERT_LEVEL_MAP: Record<string, SignalSeverity> = {
  WARNING: 'critical',
  WATCH: 'high',
  ADVISORY: 'medium',
  NORMAL: 'low',
  UNASSIGNED: 'low',
}

/**
 * USGS Aviation Color Codes → additional severity context
 *
 * RED = eruption with significant ash cloud → critical
 * ORANGE = heightened/escalating unrest → high
 * YELLOW = elevated unrest → medium
 * GREEN = normal background → low
 */
const AVIATION_COLOR_MAP: Record<string, SignalSeverity> = {
  RED: 'critical',
  ORANGE: 'high',
  YELLOW: 'medium',
  GREEN: 'low',
}

/**
 * Map volcanic alert to WorldPulse severity based on alert level
 * and aviation color code. Takes the higher of the two.
 */
export function volcanoSeverity(
  alertLevel: string,
  aviationColor: string,
): SignalSeverity {
  const severityOrder: SignalSeverity[] = ['low', 'medium', 'high', 'critical']

  const alertSeverity = ALERT_LEVEL_MAP[alertLevel?.toUpperCase()] ?? 'low'
  const aviationSeverity = AVIATION_COLOR_MAP[aviationColor?.toUpperCase()] ?? 'low'

  const alertIdx = severityOrder.indexOf(alertSeverity)
  const aviationIdx = severityOrder.indexOf(aviationSeverity)

  return severityOrder[Math.max(alertIdx, aviationIdx)]
}

// ─── WELL-KNOWN VOLCANO LOCATIONS ──────────────────────────────────────────

const VOLCANO_COORDS: Record<string, { lat: number; lon: number }> = {
  'kilauea':          { lat: 19.42, lon: -155.29 },
  'mauna loa':        { lat: 19.48, lon: -155.61 },
  'mount st. helens': { lat: 46.20, lon: -122.18 },
  'mount rainier':    { lat: 46.85, lon: -121.76 },
  'mount shasta':     { lat: 41.41, lon: -122.19 },
  'yellowstone':      { lat: 44.43, lon: -110.59 },
  'mount hood':       { lat: 45.37, lon: -121.70 },
  'mount baker':      { lat: 48.78, lon: -121.81 },
  'augustine':        { lat: 59.36, lon: -153.43 },
  'redoubt':          { lat: 60.49, lon: -152.74 },
  'pavlof':           { lat: 55.42, lon: -161.89 },
  'shishaldin':       { lat: 54.76, lon: -163.97 },
  'cleveland':        { lat: 52.82, lon: -169.94 },
  'great sitkin':     { lat: 52.08, lon: -176.13 },
  'semisopochnoi':    { lat: 51.93, lon: 179.58 },
  'etna':             { lat: 37.75, lon: 14.99 },
  'vesuvius':         { lat: 40.82, lon: 14.43 },
  'stromboli':        { lat: 38.79, lon: 15.21 },
  'piton de la fournaise': { lat: -21.24, lon: 55.71 },
  'eyjafjallajökull': { lat: 63.63, lon: -19.62 },
  'sakurajima':       { lat: 31.58, lon: 130.66 },
  'mount fuji':       { lat: 35.36, lon: 138.73 },
  'taal':             { lat: 14.00, lon: 120.99 },
  'mayon':            { lat: 13.26, lon: 123.69 },
  'pinatubo':         { lat: 15.13, lon: 120.35 },
  'krakatoa':         { lat: -6.10, lon: 105.42 },
  'merapi':           { lat: -7.54, lon: 110.45 },
  'agung':            { lat: -8.34, lon: 115.51 },
  'ruang':            { lat: 2.30, lon: 125.37 },
  'popocatépetl':     { lat: 19.02, lon: -98.62 },
  'colima':           { lat: 19.51, lon: -103.62 },
  'cotopaxi':         { lat: -0.68, lon: -78.44 },
  'villarrica':       { lat: -39.42, lon: -71.93 },
  'white island':     { lat: -37.52, lon: 177.18 },
  'tongariro':        { lat: -39.13, lon: 175.64 },
  'nyiragongo':       { lat: -1.52, lon: 29.25 },
  // More USGS-monitored volcanoes, for when a notice's own coordinates can't be read
  'spurr':            { lat: 61.30, lon: -152.25 },
  'iliamna':          { lat: 60.03, lon: -153.09 },
  'katmai':           { lat: 58.27, lon: -154.96 },
  'trident':          { lat: 58.24, lon: -155.10 },
  'aniakchak':        { lat: 56.88, lon: -158.17 },
  'veniaminof':       { lat: 56.17, lon: -159.38 },
  'westdahl':         { lat: 54.52, lon: -164.65 },
  'akutan':           { lat: 54.13, lon: -165.99 },
  'makushin':         { lat: 53.89, lon: -166.92 },
  'bogoslof':         { lat: 53.93, lon: -168.03 },
  'okmok':            { lat: 53.43, lon: -168.13 },
  'korovin':          { lat: 52.38, lon: -174.15 },
  'kanaga':           { lat: 51.92, lon: -177.16 },
  'takawangha':       { lat: 51.87, lon: -178.01 },
  'tanaga':           { lat: 51.88, lon: -178.14 },
  'gareloi':          { lat: 51.79, lon: -178.79 },
  'little sitkin':    { lat: 51.95, lon: 178.54 },
  'edgecumbe':        { lat: 57.05, lon: -135.75 },
  'hualalai':         { lat: 19.69, lon: -155.87 },
  'mount adams':      { lat: 46.20, lon: -121.49 },
  'glacier peak':     { lat: 48.11, lon: -121.11 },
  'three sisters':    { lat: 44.10, lon: -121.77 },
  'newberry':         { lat: 43.72, lon: -121.23 },
  'crater lake':      { lat: 42.94, lon: -122.11 },
  'lassen':           { lat: 40.49, lon: -121.50 },
  'long valley':      { lat: 37.70, lon: -118.87 },
  'ahyi':             { lat: 20.42, lon: 145.03 },
  'anatahan':         { lat: 16.35, lon: 145.67 },
  'pagan':            { lat: 18.13, lon: 145.80 },
}

/**
 * Look up volcano coordinates from name. Falls back to null if unknown.
 */
export function lookupVolcanoCoords(
  volcanoName: string,
  lat?: number | null,
  lon?: number | null,
): { lat: number; lon: number } | null {
  // Use provided coordinates if available
  if (lat != null && lon != null && lat !== 0 && lon !== 0) {
    return { lat, lon }
  }

  const lower = volcanoName.toLowerCase()
  for (const [name, coords] of Object.entries(VOLCANO_COORDS)) {
    if (lower.includes(name)) return coords
  }

  return null
}

// ─── POLLER ─────────────────────────────────────────────────────────────────

/** One entry of getElevatedVolcanoes */
export interface ElevatedVolcano {
  volcano_name: string
  vnum: string
  obs_fullname?: string
  obs_abbr?: string
  alert_level: string
  color_code: string
  sent_utc?: string
  sent_unixtime?: number
  notice_url?: string
  notice_data?: string
}

/** One volcano's part of a notice (getNotice) */
interface NoticeSection {
  vnum?: string | number
  lat?: number
  lng?: number
  synopsis?: string
  region?: string
}

/** "WATCH/ORANGE" */
export function volcanoLevel(v: Pick<ElevatedVolcano, 'alert_level' | 'color_code'>): string {
  return `${(v.alert_level ?? '').toUpperCase()}/${(v.color_code ?? '').toUpperCase()}`
}

/** Elevated volcanoes whose level differs from the one last reported (or that weren't elevated before) */
export function volcanoLevelChanges(
  current: ElevatedVolcano[],
  previous: Record<string, string>,
): ElevatedVolcano[] {
  return current.filter(v => v.vnum && previous[v.vnum] !== volcanoLevel(v))
}

const ALERT_RANK: Record<string, number> = { NORMAL: 0, UNASSIGNED: 0, ADVISORY: 1, WATCH: 2, WARNING: 3 }
const COLOR_RANK: Record<string, number> = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 }

/** One sentence on how the level moved, e.g. "Raised from ADVISORY/YELLOW to WATCH/ORANGE." */
export function describeLevelChange(previous: string | undefined, current: string): string {
  if (!previous) return `Alert level is above normal: ${current}.`
  const [prevAlert, prevColor] = previous.split('/')
  const [alert, color] = current.split('/')
  const diff = ((ALERT_RANK[alert] ?? 0) - (ALERT_RANK[prevAlert] ?? 0)) ||
    ((COLOR_RANK[color] ?? 0) - (COLOR_RANK[prevColor] ?? 0))
  const verb = diff > 0 ? 'Raised' : diff < 0 ? 'Lowered' : 'Changed'
  return `${verb} from ${previous} to ${current}.`
}

function sentAt(v: ElevatedVolcano): Date {
  if (typeof v.sent_unixtime === 'number' && v.sent_unixtime > 0) return new Date(v.sent_unixtime * 1000)
  const parsed = v.sent_utc ? new Date(`${v.sent_utc.replace(' ', 'T')}Z`) : null
  return parsed && !isNaN(parsed.getTime()) ? parsed : new Date()
}

async function fetchNoticeSections(url: string): Promise<NoticeSection[]> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return []
    const body = await res.json() as { notice_sections?: unknown }
    return Array.isArray(body.notice_sections) ? body.notice_sections as NoticeSection[] : []
  } catch {
    return []
  }
}

async function pollVolcanoAlerts(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): Promise<void> {
  try {
    let volcanoes: ElevatedVolcano[]
    try {
      volcanoes = await fetchWithResilience(
        'gvp-volcano',
        'USGS Volcano',
        USGS_ELEVATED_URL,
        async () => {
          const res = await fetch(USGS_ELEVATED_URL, {
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
            signal: AbortSignal.timeout(30_000),
          })
          if (!res.ok) throw Object.assign(new Error(`USGS Volcano: HTTP ${res.status}`), { statusCode: res.status })
          return res.json() as Promise<ElevatedVolcano[]>
        },
      )
    } catch (err) {
      if (err instanceof CircuitOpenError) return
      throw err
    }

    if (!Array.isArray(volcanoes)) {
      log.warn('Unexpected response from the USGS elevated volcano list')
      return
    }

    const elevated = volcanoes.filter(v =>
      v.vnum && v.volcano_name && (ALERT_RANK[(v.alert_level ?? '').toUpperCase()] ?? 1) > 0,
    )
    const previous = await redis.hgetall(LEVELS_KEY)
    // Keep the last reported level of volcanoes that are still elevated; ones
    // that went back to normal drop out, so a later rise is reported again
    const next: Record<string, string> = {}
    for (const v of elevated) if (previous[v.vnum]) next[v.vnum] = previous[v.vnum]

    const notices = new Map<string, Promise<NoticeSection[]>>()
    let ingested = 0

    for (const v of volcanoLevelChanges(elevated, previous).slice(0, 15)) {
      const level = volcanoLevel(v)
      const noticeData = v.notice_data?.startsWith(USGS_ORIGIN) ? v.notice_data : null
      if (noticeData && !notices.has(noticeData)) notices.set(noticeData, fetchNoticeSections(noticeData))
      const sections = noticeData ? await notices.get(noticeData)! : []
      const section = sections.find(s => String(s.vnum ?? '') === v.vnum)
      const location = lookupVolcanoCoords(v.volcano_name, section?.lat ?? null, section?.lng ?? null)
      const synopsis = (section?.synopsis ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      const colorLabel = v.color_code ? ` | Aviation: ${v.color_code.toUpperCase()}` : ''

      const signalData = {
        title: `Volcanic Alert — ${v.volcano_name}: ${v.alert_level.toUpperCase()}${colorLabel}`.slice(0, 500),
        summary: [
          synopsis,
          describeLevelChange(previous[v.vnum], level),
          `Observatory: ${v.obs_fullname ?? 'USGS'}`,
          `Alert Level: ${v.alert_level.toUpperCase()}`,
          `Aviation Color Code: ${v.color_code ? v.color_code.toUpperCase() : 'N/A'}`,
        ].filter(Boolean).join('\n').slice(0, 2000),
        original_urls: [v.notice_url?.startsWith(USGS_ORIGIN) ? v.notice_url : 'https://volcanoes.usgs.gov/hans-public/'],
        source_ids: [],
        category: 'disaster',
        severity: volcanoSeverity(v.alert_level, v.color_code),
        status: 'pending',
        reliability_score: RELIABILITY,
        location: location ? db.raw('ST_MakePoint(?, ?)', [location.lon, location.lat]) : null,
        location_name: section?.region ? `${v.volcano_name}, ${section.region}` : v.volcano_name,
        country_code: 'US',
        region: null,
        tags: ['osint', 'volcano', 'volcanic', 'usgs', ...(v.obs_abbr ? [v.obs_abbr.toLowerCase()] : [])],
        language: 'en',
        event_time: sentAt(v),
        source_count: 1,
      }

      try {
        const signal = await insertAndCorrelate(signalData, { lat: location?.lat ?? null, lng: location?.lon ?? null, sourceId: 'gvp-volcano' })

        if (producer) {
          await producer.send({
            topic: 'signals.verified',
            messages: [{ value: JSON.stringify(signal) }],
          })
        }

        next[v.vnum] = level
        ingested++
      } catch (err) {
        log.warn({ err, volcano: v.volcano_name }, 'Failed to ingest volcano alert')
      }
    }

    const save = redis.multi().del(LEVELS_KEY)
    if (Object.keys(next).length > 0) save.hset(LEVELS_KEY, next).expire(LEVELS_KEY, LEVELS_TTL_S)
    await save.exec()

    if (ingested > 0) {
      log.info({ ingested, elevated: elevated.length }, 'Volcano alerts ingested')
    }
  } catch (err) {
    log.error({ err }, 'Volcano alert poll failed')
  }
}

export function startGvpVolcanoPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  log.info('Starting USGS volcano alert poller (30-min interval)')
  pollVolcanoAlerts(db, redis, producer)

  const timer = setInterval(() => pollVolcanoAlerts(db, redis, producer), POLL_INTERVAL_MS)
  return () => clearInterval(timer)
}
