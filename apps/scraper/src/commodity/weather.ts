/**
 * Weather risk over the crop regions (Oct 23, 2026; Devon: a crop looks healthy, "but nobody is
 * talking about how bad the weather forecast is").
 *
 * The forecast: MET Norway's Locationforecast (the Norwegian Meteorological Institute; global,
 * from ECMWF's model; about 9 days ahead; licensed CC BY 4.0, "Data from MET Norway"), read for
 * each region's point. What's normal: NASA's POWER climatology (each month's average rain at that
 * point, 2001 to 2025; NASA open data, no restrictions). What matters: the crop calendar, since
 * a dry week hurts flowering coffee and not a field after harvest.
 *
 * Four plain rules, each low, medium or high:
 *   dry    the forecast's rain against normal for the time of year, while the crop is in the field
 *   wet    far more rain than normal at harvest (delays, quality), or flooding rain at any time
 *   frost  a low at or under the crop's frost line, when frost can hurt it
 *   heat   highs at or over the crop's heat line while it flowers or fills
 * Flowering and filling count in full; planting and growing one step lower; out of season, none.
 * Normals are read between the monthly averages, day by day; irrigated regions skip the dry rule;
 * sugar beet and robusta coffee have their own frost and heat lines.
 */

import type { CropWeather, Stage, WatchCommodity } from './catalog'
import { stageWords } from './catalog'
import type { CropRegion } from './regions'

export const MET_CREDIT = 'Data from MET Norway (CC BY 4.0)'
export const POWER_CREDIT = 'NASA POWER climatology'

/** Six hours of forecast: the lowest and highest temperature (°C) and the rain (mm) */
export interface Window6h {
  /** UTC start, "2026-10-24T00:00:00Z" */
  start: string
  min: number | null
  max: number | null
  rain: number
}

export interface PointForecast {
  /** When MET Norway's model run was made */
  updated: string | null
  windows: Window6h[]
}

/** MET Norway's complete.json into six-hour windows (00, 06, 12 and 18 UTC), none counted twice */
export function readLocationforecast(json: unknown): PointForecast {
  const props = (json as { properties?: { meta?: { updated_at?: string }; timeseries?: unknown[] } })?.properties
  const series = Array.isArray(props?.timeseries) ? props!.timeseries! : []
  const windows: Window6h[] = []
  let last = ''
  for (const step of series as Array<{ time?: string; data?: { next_6_hours?: { details?: Record<string, number> } } }>) {
    const time = typeof step?.time === 'string' ? step.time : ''
    const d = step?.data?.next_6_hours?.details
    if (!time || !d || Number(time.slice(11, 13)) % 6 !== 0 || time <= last) continue
    last = time
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    windows.push({ start: time, min: num(d.air_temperature_min), max: num(d.air_temperature_max), rain: num(d.precipitation_amount) ?? 0 })
  }
  return { updated: props?.meta?.updated_at ?? null, windows }
}

const MONTH_KEYS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** NASA POWER's climatology answer into each month's normal rain (mm a day), January first */
export function readPowerClimatology(json: unknown): number[] | null {
  const p = (json as { properties?: { parameter?: { PRECTOTCORR?: Record<string, number> } } })?.properties?.parameter?.PRECTOTCORR
  if (!p) return null
  const out = MONTH_KEYS.map(k => p[k])
  return out.every(v => typeof v === 'number' && v >= 0) ? (out as number[]) : null
}

/**
 * The normal rain (mm a day) on a date: between the monthly averages, each taken as the middle of
 * its month (so late October leans towards a dry November, not the wet early October)
 */
export function normalOn(normals: readonly number[], iso: string): number {
  const d = new Date(iso)
  const m = d.getUTCMonth()
  const day = d.getUTCDate() + d.getUTCHours() / 24
  const days = new Date(Date.UTC(d.getUTCFullYear(), m + 1, 0)).getUTCDate()
  const mid = (days + 1) / 2
  const here = normals[m]!
  const there = day >= mid ? normals[(m + 1) % 12]! : normals[(m + 11) % 12]!
  return here + (there - here) * (Math.abs(day - mid) / days)
}

export type Level = 0 | 1 | 2 | 3

export interface Risk {
  kind: 'dry' | 'wet' | 'frost' | 'heat'
  level: 1 | 2 | 3
  text: string
}

export interface RegionWeather {
  id: string
  commodity: string
  iso: string
  country: string
  name: string
  lat: number
  lon: number
  share: number
  stage: Stage
  /** "flowering" */
  doing: string
  /** How many days the forecast covers */
  days: number
  rain_mm: number
  /** Normal rain for those days, from the monthly averages; null when not known yet */
  normal_mm: number | null
  rain_pct: number | null
  low_c: number | null
  low_on: string | null
  high_c: number | null
  high_on: string | null
  /** Days with a high at or over the crop's heat line; nights at or under its frost line */
  hot_days: number
  frost_nights: number
  level: Level
  risks: Risk[]
  forecast_updated: string | null
}

const DAY_MS = 86_400_000
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayOf = (iso: string): string => `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`
const r1 = (n: number): number => Math.round(n * 10) / 10

/** Lower a risk one step at planting and growing, keep it at flowering and filling */
function atStage(level: number, stage: Stage): Level {
  if (stage === 'O') return 0
  if (stage === 'P' || stage === 'G') return Math.max(0, level - 1) as Level
  return Math.min(3, Math.max(0, level)) as Level
}

/** One region's weather risk from its forecast, its normals and its crop calendar */
export function assessRegion(region: CropRegion, commodity: WatchCommodity, forecast: PointForecast | null, normals: number[] | null, now: Date = new Date()): RegionWeather {
  const base0: CropWeather = commodity.weather ?? { frost: 'never', frostC: 0, heatC: 99 }
  // Sugar beet takes frost that would kill cane; robusta coffee takes heat that hurts arabica
  const w: CropWeather = region.variant === 'beet' ? { ...base0, frost: 'field', frostC: -3, heatC: 35 }
    : region.variant === 'robusta' ? { ...base0, heatC: base0.heatC + 3 }
    : base0
  const windows = forecast?.windows ?? []
  const days = Math.round((windows.length / 4) * 10) / 10
  // The stage halfway through the forecast
  const mid = new Date(now.getTime() + (days / 2) * DAY_MS)
  const stage = region.calendar[mid.getUTCMonth()] ?? 'O'
  const doing = stageWords(commodity, stage)
  // ("the grass" on the meat and dairy cards' pastures, CM9)
  const crop = w.pasture ? 'the grass' : 'the crop'
  const base: RegionWeather = {
    id: region.id, commodity: region.commodity, iso: region.iso, country: region.country, name: region.name,
    lat: region.lat, lon: region.lon, share: region.share, stage, doing, days,
    rain_mm: 0, normal_mm: null, rain_pct: null, low_c: null, low_on: null, high_c: null, high_on: null,
    hot_days: 0, frost_nights: 0, level: 0, risks: [], forecast_updated: forecast?.updated ?? null,
  }
  if (windows.length < 8) return base

  const rain = windows.reduce((s, x) => s + x.rain, 0)
  let normal: number | null = null
  if (normals) {
    normal = 0
    for (const x of windows) normal += normalOn(normals, new Date(Date.parse(x.start) + 3 * 3_600_000).toISOString()) / 4
  }
  const lows = windows.filter(x => x.min !== null)
  const highs = windows.filter(x => x.max !== null)
  const low = lows.length ? lows.reduce((a, b) => (b.min! < a.min! ? b : a)) : null
  const high = highs.length ? highs.reduce((a, b) => (b.max! > a.max! ? b : a)) : null
  const hotDays = new Set(highs.filter(x => x.max! >= w.heatC).map(x => x.start.slice(0, 10))).size
  const frostNights = new Set(lows.filter(x => x.min! <= w.frostC).map(x => x.start.slice(0, 10))).size
  const out: RegionWeather = {
    ...base,
    rain_mm: r1(rain),
    normal_mm: normal === null ? null : r1(normal),
    rain_pct: normal ? Math.round((rain / normal) * 100) : null,
    low_c: low ? r1(low.min!) : null,
    low_on: low ? dayOf(low.start) : null,
    high_c: high ? r1(high.max!) : null,
    high_on: high ? dayOf(high.start) : null,
    hot_days: hotDays,
    frost_nights: frostNights,
  }
  const span = `the next ${Math.round(days)} days`
  const risks: Risk[] = []
  const add = (kind: Risk['kind'], level: number, text: string): void => {
    if (level >= 1) risks.push({ kind, level: Math.min(3, level) as 1 | 2 | 3, text })
  }
  const inField = stage === 'P' || stage === 'G' || stage === 'B' || stage === 'F'

  // Dry: only where the time of year is normally wet enough to matter (about 1.7 mm a day), and
  // not where the crop is mostly irrigated
  if (normal !== null && normal >= 15 && inField && !region.irrigated) {
    const ratio = rain / normal
    const raw = ratio < 0.25 ? 3 : ratio < 0.5 ? 2 : ratio < 0.75 ? 1 : 0
    add('dry', atStage(raw, stage), `${r1(rain)} mm of rain forecast in ${span}, ${Math.round(ratio * 100)}% of normal, while ${crop} is ${doing}`)
  }
  // Wet: flooding rain at any stage the crop is in the field or being harvested (at least twice normal:
  // some places are always this wet), or far above normal at harvest. Not out of season (Oct 30, 2026:
  // Paraná's corn was flagged for 186 mm of rain while the second crop its calendar follows waits for January)
  if (stage !== 'O' && rain >= 150 && (normal === null || rain >= 2 * normal)) {
    add('wet', rain >= 200 && (normal === null || rain >= 2.5 * normal) ? 3 : 2, `${Math.round(rain)} mm of rain forecast in ${span}${normal ? `, ${r1(rain / normal)} times normal` : ''}: a flooding risk while ${crop} is ${doing}`)
  } else if (stage === 'H' && normal !== null && normal > 0) {
    const ratio = rain / normal
    const raw = ratio >= 3 && rain >= 100 ? 3 : ratio >= 2 && rain >= 60 ? 2 : ratio >= 1.5 && rain >= 40 ? 1 : 0
    add('wet', raw, `${Math.round(rain)} mm of rain forecast in ${span}, ${r1(ratio)} times normal, while ${crop} is being harvested`)
  }
  // Frost
  const frostMatters = w.frost === 'always' || (w.frost === 'field' && inField) || (w.frost === 'flowering' && (stage === 'B' || stage === 'F'))
  if (frostMatters && low && low.min !== null) {
    const raw = low.min <= w.frostC - 2 ? 3 : low.min <= w.frostC ? 2 : low.min <= w.frostC + 2 ? 1 : 0
    const lvl = w.frost === 'always' ? raw : atStage(raw, stage)
    add('frost', lvl, `Lows of ${r1(low.min)}°C forecast on ${dayOf(low.start)}${frostNights > 1 ? `, ${frostNights} nights at ${w.frostC}°C or less` : ''}, while ${crop} is ${doing}`)
  }
  // Heat, at flowering and filling
  if ((stage === 'B' || stage === 'F') && high && high.max !== null) {
    // One hot afternoon is a low risk; two or more days a medium one; four, or two well over the line, high
    const raw = hotDays >= 4 || (hotDays >= 2 && high.max >= w.heatC + 3) ? 3 : hotDays >= 2 ? 2 : hotDays === 1 || high.max >= w.heatC - 2 ? 1 : 0
    add('heat', raw, `Highs of ${r1(high.max)}°C forecast${hotDays ? `, ${hotDays} day${hotDays > 1 ? 's' : ''} at ${w.heatC}°C or more` : ''}, while ${crop} is ${doing}`)
  }
  risks.sort((a, b) => b.level - a.level)
  out.risks = risks
  out.level = (risks[0]?.level ?? 0) as Level
  return out
}

export interface CountryWeather {
  commodity: string
  iso: string
  /** The worst risk in the regions growing a good part of the crop (15% or more; else those with half the biggest share or more) */
  level: Level
  /** The regions' risk weighted by their share of the crop, 0 to 3 */
  weighted: number
  /** The worst region's worst risk, in words */
  summary: string | null
  regions: RegionWeather[]
}

/** A country's weather risk for a commodity from its regions */
export function countryWeather(commodity: string, iso: string, regions: RegionWeather[]): CountryWeather {
  const sorted = [...regions].sort((a, b) => b.level - a.level || b.share - a.share)
  const big = sorted.filter(r => r.share >= 0.15)
  // Where no region grows 15% (Russia's wheat, CM9, Oct 30, 2026), the biggest ones set the level: those with half
  // the biggest share or more, so a dry week in a small region (Samara, 2%) doesn't flag the country
  const top = regions.reduce((m, r) => Math.max(m, r.share), 0)
  const pool = big.length ? big : sorted.filter(r => r.share >= top / 2)
  const level = pool.reduce<number>((m, r) => Math.max(m, r.level), 0) as Level
  const total = regions.reduce((s, r) => s + r.share, 0)
  const weighted = total > 0 ? Math.round((regions.reduce((s, r) => s + r.share * r.level, 0) / total) * 100) / 100 : 0
  const worst = pool.find(r => r.level === level && r.risks.length)
  return {
    commodity, iso, level, weighted,
    summary: worst && level > 0 ? `${worst.name}: ${worst.risks[0]!.text}` : null,
    regions: sorted,
  }
}
