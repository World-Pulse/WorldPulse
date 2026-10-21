/**
 * GET /api/v1/map/satellites — the World Map's Satellites layer (plan M53,
 * Oct 21, 2026; Devon: "Nice!"): the orbital elements of about 500
 * satellites in five of CelesTrak's groups (space stations, navigation,
 * weather, Earth observation, military), for the browser to work out where
 * each one is now (satellite.js).
 *
 * CelesTrak asks that its GP data be fetched no more than once every two
 * hours: each group is kept in Redis for 6 hours and remade in the
 * background, and a group that doesn't answer keeps its last copy.
 */

import type { FastifyPluginAsync } from 'fastify'
import { staleWhileRevalidate } from '../../lib/swr-cache'

export const SATELLITE_GROUPS = ['stations', 'gnss', 'weather', 'resource', 'military'] as const
export type SatelliteGroup = (typeof SATELLITE_GROUPS)[number]

export interface SatelliteTle {
  name: string
  norad: number
  group: SatelliteGroup
  tle1: string
  tle2: string
}

const CELESTRAK = 'https://celestrak.org/NORAD/elements/gp.php'
const UA = 'WorldPulse/1.0 (+https://world-pulse.io; map layer, cached 6 h)'
export const SATELLITES_FRESH_SECONDS = 6 * 3600

/** A TLE line: its number, a space, then 67 more characters (some feeds trim trailing spaces) */
const LINE = (n: 1 | 2) => new RegExp(`^${n} [0-9 ]{5}`)

/** CelesTrak's three-line text (name, line 1, line 2) as satellites of a group */
export function parseTle(text: string, group: SatelliteGroup): SatelliteTle[] {
  const lines = String(text ?? '').split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean)
  const out: SatelliteTle[] = []
  let i = 0
  while (i + 2 < lines.length) {
    const [name, l1, l2] = [lines[i], lines[i + 1], lines[i + 2]]
    if (!LINE(1).test(l1) || !LINE(2).test(l2) || l1.length < 60 || l2.length < 60) { i += 1; continue }
    const norad = Number(l1.slice(2, 7).trim())
    if (Number.isFinite(norad) && norad > 0) out.push({ name: name.trim(), norad, group, tle1: l1, tle2: l2 })
    i += 3
  }
  return out
}

/** Each satellite once (the ISS can be in two groups): the first group listed wins */
export function mergeGroups(lists: SatelliteTle[][]): SatelliteTle[] {
  const seen = new Set<number>()
  const out: SatelliteTle[] = []
  for (const list of lists) for (const s of list) {
    if (seen.has(s.norad)) continue
    seen.add(s.norad)
    out.push(s)
  }
  return out
}

async function fetchGroup(group: SatelliteGroup, fetchImpl: typeof fetch = fetch): Promise<SatelliteTle[]> {
  const res = await fetchImpl(`${CELESTRAK}?GROUP=${group}&FORMAT=tle`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`CelesTrak ${group}: HTTP ${res.status}`)
  const list = parseTle(await res.text(), group)
  if (!list.length) throw new Error(`CelesTrak ${group}: no satellites in the answer`)
  return list
}

export const registerMapSatelliteRoutes: FastifyPluginAsync = async (app) => {
  app.get('/satellites', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['map'],
      summary: 'Orbital elements (TLE) of about 500 satellites, for the map to place them',
      description: `CelesTrak's groups ${SATELLITE_GROUPS.join(', ')}, each kept 6 hours. Work out positions with an SGP4 library (the map uses satellite.js).`,
    },
  }, async (_req, reply) => {
    const lists = await Promise.all(SATELLITE_GROUPS.map(group =>
      staleWhileRevalidate(`map:satellites:${group}:v1`, { freshSeconds: SATELLITES_FRESH_SECONDS, staleSeconds: 48 * 3600, lockSeconds: 60 },
        () => fetchGroup(group))
        .catch(err => { app.log.warn({ err: String(err), group }, 'satellites group unavailable'); return [] as SatelliteTle[] })))
    const satellites = mergeGroups(lists)
    const groups = Object.fromEntries(SATELLITE_GROUPS.map((g, i) => [g, lists[i].length]))
    void reply.header('Cache-Control', 'public, max-age=3600')
    return reply.send({ success: true, source: 'CelesTrak (celestrak.org)', groups, count: satellites.length, satellites })
  })
}
