/**
 * The world's press, counted (Oct 22, 2026). The second outlet already reads
 * GDELT's list of the news articles it read every 15 minutes
 * (gdelt-articles.ts); each article there also carries the places it names
 * (V1LOCATIONS, FIPS country codes), its themes (V1THEMES: PROTEST,
 * NATURAL_DISASTER_FLOODS, ECON_INFLATION …) and its tone (V1.5TONE: about
 * -10 to +10). Counted per country and kind of event, hour by hour, they show
 * where the world's coverage jumps ("protest coverage of Kenya at four times
 * its usual for these hours"), often before WorldPulse's own feeds carry it.
 *
 * Kept in Redis, a hash an hour (gkg:pulse:2:<YYYYMMDDHH>, 9 days): "<ISO
 * country>|*|n" articles naming the country, "<ISO country>|*|t" their tone
 * (tenths, summed), "<ISO country>|<group>|n" the articles of each group,
 * "_articles" the articles that named any country, "_files" the files
 * counted that hour (a restart or a file GDELT skipped leaves fewer: readers
 * compare rates per file). A file is counted once
 * (gkg:pulse:2:files:<YYYYMMDD>), whatever restarts re-read. The analysis
 * engine's reading compares the last 6 hours with the same hours on the days
 * before.
 */

import { redis } from '../lib/redis'
import { isoFromFips } from './fips-countries'
import { fetchFileText, stampOf } from './gdelt-articles'

/**
 * Version 2 (Oct 22, 2026, 5:30 PM): tighter kinds of event, read from one real
 * file of 1,770 articles: "disaster" had counted GDELT's vague
 * MANMADE_DISASTER_IMPLIED (332 articles) and NATURAL_DISASTER_ICE (80, mostly
 * America's immigration agency), "health" every disease (cancer, brain
 * injury), "shipping" every mention of the sea and "conflict" every killing
 * and gun; killings now count apart as "casualties". Its own keys, so counts
 * of the two versions never mix.
 */
export const PULSE_PREFIX = 'gkg:pulse:2:'
export const PULSE_KEY = (hour: string) => `${PULSE_PREFIX}${hour}`
const FILES_KEY = (day: string) => `${PULSE_PREFIX}files:${day}`
const KEEP_S = 9 * 86_400

/** GDELT's themes, gathered into the kinds of event WorldPulse follows (an article counts once per group) */
export const PULSE_GROUPS: ReadonlyArray<readonly [string, RegExp]> = [
  ['conflict', /^(ARMEDCONFLICT|MILITARY$|CEASEFIRE|SEIGE|SIEGE|TAX_WEAPONS_(MISSILE|ROCKET|BOMB|EXPLOSIVE|DRONE|ARTILLERY|MORTAR|GRENADE|WARSHIP|AIRCRAFT_CARRIER|TANK))/],
  ['casualties', /^(KILL|WOUND|CRISISLEX_T03_DEAD|CRISISLEX_T02_INJURED)/],
  ['terror', /^(TERROR|SUICIDE_ATTACK)/],
  ['unrest', /^(PROTEST|RIOT|CURFEW|STATE_OF_EMERGENCY|REBELLION|GENERAL_STRIKE|UNREST_(?!BELLIGERENT|SELF_IDENTIFIED|NATIONAL_SELF_DEFENSE))/],
  ['coup', /^(COUP|REGIME_CHANGE)/],
  ['disaster', /^(NATURAL_DISASTER_(?!ICE)|MANMADE_DISASTER(?!_IMPLIED)|EVACUATION)/],
  ['health', /^(HEALTH_PANDEMIC|EPIDEMIC|TAX_DISEASE_(EPIDEMIC|OUTBREAK|PANDEMIC|INFECTIO|EBOLA|CHOLERA|MEASLES|MPOX|MONKEYPOX|MARBURG|DENGUE|MALARIA|POLIO|ANTHRAX|PLAGUE|AVIAN|BIRD_FLU|H5N1|INFLUENZA|FLU$|CORONAVIRUS|COVID|YELLOW_FEVER|LASSA|NIPAH|ZIKA|DIPHTHERIA|MENINGITIS|TYPHOID|HEPATITIS|CHIKUNGUNYA|RABIES|TUBERCULOSIS))/],
  ['election', /^ELECTION/],
  ['economy', /^ECON_/],
  ['energy', /^(ENV_OIL|ENV_NATURALGAS|FUELPRICES|ENERGY)/],
  ['shipping', /^(MARITIME_INCIDENT|MARITIME_PIRACY|PIRACY|BLOCKADE)/],
  ['cyber', /^CYBER/],
  ['displacement', /^(REFUGEES|DISPLACED)/],
  ['sanctions', /^(SANCTIONS|EMBARGO)/],
]

export type PulseCounts = Record<string, number>

/**
 * One GKG file's counts: for each web article (collection 1), each country it
 * names once, with its tone, and each group its themes fall in
 */
export function readPulse(text: string): PulseCounts {
  const out: PulseCounts = {}
  const add = (k: string, v: number) => { out[k] = (out[k] ?? 0) + v }
  for (const line of text.split('\n')) {
    if (!line) continue
    const f = line.split('\t')
    if (f.length < 16 || f[2] !== '1') continue
    const countries = new Set<string>()
    for (const loc of (f[9] ?? '').split(';')) {
      const iso = isoFromFips(loc.split('#')[2])
      if (iso) countries.add(iso)
    }
    if (!countries.size) continue
    add('_articles', 1)
    const themes = (f[7] ?? '').split(';').filter(Boolean)
    const groups = PULSE_GROUPS.filter(([, re]) => themes.some(t => re.test(t))).map(([g]) => g)
    const tone = Number((f[15] ?? '').split(',')[0])
    for (const c of countries) {
      add(`${c}|*|n`, 1)
      if (Number.isFinite(tone)) add(`${c}|*|t`, Math.round(tone * 10))
      for (const g of groups) add(`${c}|${g}|n`, 1)
    }
  }
  return out
}

/** Adds a file's counts to its hour, once per file */
export async function recordPulse(stamp: string, counts: PulseCounts): Promise<boolean> {
  const files = FILES_KEY(stamp.slice(0, 8))
  if (!(await redis.sadd(files, stamp))) return false
  const key = PULSE_KEY(stamp.slice(0, 10))
  const multi = redis.multi()
  for (const [k, v] of Object.entries(counts)) if (v) multi.hincrby(key, k, v)
  // the files counted in the hour: a restart or a file GDELT skipped leaves fewer, so readers compare rates per file
  multi.hincrby(key, '_files', 1)
  multi.expire(key, KEEP_S)
  multi.expire(files, KEEP_S)
  await multi.exec()
  return true
}

// ─── The week before ─────────────────────────────────────────────────────────

export const BACKFILL_DAYS = 7
export const BACKFILL_STATS = `${PULSE_PREFIX}backfill`

export interface BackfillDeps {
  counted(stamp: string): Promise<boolean>
  fetchText(stamp: string): Promise<string | null>
  record(stamp: string, counts: PulseCounts): Promise<boolean>
  progress(stats: BackfillStats): Promise<unknown>
  pause(ms: number): Promise<void>
}

export interface BackfillStats { files: number; skipped: number; missing: number; failed: number; last: string | null }

/**
 * The files to count for the week before `now`, newest first: two an hour
 * for the last day (:15 and :45), one an hour (:15) for the six before. Rates
 * per file make one file an hour comparable with the four a live hour has.
 */
export function backfillStamps(now: number, days = BACKFILL_DAYS): string[] {
  const hour = Math.floor(now / 3_600_000) * 3_600_000
  const out: string[] = []
  for (let h = 1; h <= days * 24; h++) {
    const start = hour - h * 3_600_000
    out.push(stampOf(new Date(start + 15 * 60_000)))
    if (h <= 24) out.push(stampOf(new Date(start + 45 * 60_000)))
  }
  return out
}

/**
 * Once, when the pulse began (Oct 22, 2026): the week before counted from
 * GDELT's kept files (it keeps every 15-minute file since 2015), so the last
 * 6 hours can be compared with the same hours on earlier days at once, not a
 * week later. About 190 files of some 7 MB, one every 3 seconds, newest
 * first; a file already counted is skipped, so a restart carries on. Stops
 * (and is tried again at the next start) after 10 failures in a row.
 */
export async function backfillPulse(deps: BackfillDeps = liveBackfillDeps, now = Date.now()): Promise<BackfillStats> {
  const stats: BackfillStats = { files: 0, skipped: 0, missing: 0, failed: 0, last: null }
  let failedInRow = 0
  for (const stamp of backfillStamps(now)) {
    if (await deps.counted(stamp)) { stats.skipped++; continue }
    try {
      const text = await deps.fetchText(stamp)
      failedInRow = 0
      if (text === null) stats.missing++
      else if (await deps.record(stamp, readPulse(text))) stats.files++
      else stats.skipped++
      stats.last = stamp
    } catch {
      stats.failed++
      if (++failedInRow >= 10) {
        await deps.progress(stats)
        throw new Error(`Pulse backfill: 10 files in a row failed (last ${stamp})`)
      }
    }
    if ((stats.files + stats.missing + stats.failed) % 10 === 0) await deps.progress(stats)
    await deps.pause(3_000)
  }
  await deps.progress(stats)
  return stats
}

const liveBackfillDeps: BackfillDeps = {
  counted: async (stamp) => (await redis.sismember(FILES_KEY(stamp.slice(0, 8)), stamp)) === 1,
  fetchText: fetchFileText,
  record: recordPulse,
  progress: (stats) => redis.multi()
    .hset(BACKFILL_STATS, { files: stats.files, skipped: stats.skipped, missing: stats.missing, failed: stats.failed, last: stats.last ?? '', updated_at: new Date().toISOString() })
    .expire(BACKFILL_STATS, 30 * 86_400)
    .exec(),
  pause: (ms) => new Promise(r => setTimeout(r, ms)),
}
