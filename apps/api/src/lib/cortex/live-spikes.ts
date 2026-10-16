/**
 * Same-day spikes (Oct 15, 2026).
 *
 * The nightly baselines only judge yesterday (3 AM UTC), so a story breaking
 * this morning couldn't show as a spike until tomorrow. This compares the last
 * few hours with the same hours of the clock on each of the 7 days before
 * (news has a daily rhythm), by category × place and by category worldwide,
 * with the same fair spread as the nightly alarms (honest.ts).
 *
 * Kept in Redis and remade in the background every 10 minutes with a longer
 * time limit (the API's statement limit is 5 seconds).
 *
 * @module cortex/live-spikes
 */

import type { Knex } from 'knex'
import { staleWhileRevalidate } from '../swr-cache'
import { longQuery } from '../long-query'
import { liveSpikes, liveMinCount, type LiveSpike, type WindowRow } from './honest'

export const LIVE_HOURS = [3, 6, 12, 24] as const
export type LiveHours = typeof LIVE_HOURS[number]

const PLACE = "LEFT(COALESCE(NULLIF(TRIM(location_name), ''), 'global'), 200)"
const WORLDWIDE = 'worldwide'
const MAX_SPIKES = 20

export interface LiveSpikeOut extends LiveSpike {
  headlines: Array<{ id: string; title: string; reliability: number | null; outlets: number | null; at: string | null; status: string | null }>
}

export interface LiveSpikesReport {
  success: true
  hours: number
  window: { from: string; to: string }
  history_days: number
  min_count: number
  spikes: LiveSpikeOut[]
  generated_at: string
}

/** Valid window, defaulting to 6 hours */
export function liveHours(h: unknown): LiveHours {
  const n = Number(h)
  return (LIVE_HOURS as readonly number[]).includes(n) ? (n as LiveHours) : 6
}

async function compute(trx: Knex.Transaction, hours: number): Promise<LiveSpikesReport> {
  const now = new Date()
  // day_back d covers [now - d days - hours, now - d days): the same hours of the clock, d days ago
  const res = await trx.raw(`
    WITH w AS (
      SELECT category, ${PLACE} AS region,
             FLOOR(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400)::int AS day_back,
             EXTRACT(EPOCH FROM (NOW() - created_at)) AS age_s
      FROM signals
      WHERE created_at >= NOW() - INTERVAL '8 days'
        AND created_at <= NOW()
        AND status IN ('verified', 'pending')
        AND category IS NOT NULL
    )
    SELECT category, region, day_back, COUNT(*)::int AS count
    FROM w
    WHERE age_s - day_back * 86400 < ? * 3600
      AND day_back BETWEEN 0 AND 7
    GROUP BY category, region, day_back
  `, [hours])
  const rows: WindowRow[] = (res.rows ?? []).map((r: any) => ({
    category: String(r.category), region: String(r.region), day_back: Number(r.day_back), count: Number(r.count),
  }))

  // category totals across every place, too: a surge spread over many places
  const totals = new Map<string, WindowRow>()
  for (const r of rows) {
    const key = `${r.category}\u0000${r.day_back}`
    const t = totals.get(key) ?? { category: r.category, region: WORLDWIDE, day_back: r.day_back, count: 0 }
    t.count += r.count
    totals.set(key, t)
  }

  const minCount = liveMinCount(hours)
  const spikes = liveSpikes([...rows, ...totals.values()], { hours, minCount }).slice(0, MAX_SPIKES)

  const out: LiveSpikeOut[] = []
  for (const s of spikes) {
    const q = trx('signals')
      .select('id', 'title', 'reliability_score', 'source_count', 'created_at', 'status')
      .where('created_at', '>=', trx.raw('NOW() - (? * INTERVAL \'1 hour\')', [hours]))
      .whereIn('status', ['verified', 'pending'])
      .where('category', s.category)
      .whereNotNull('title')
      .orderByRaw('source_count DESC NULLS LAST, reliability_score DESC NULLS LAST, created_at DESC')
      .limit(3)
    if (s.region !== WORLDWIDE) q.whereRaw(`${PLACE} = ?`, [s.region])
    const heads = await q
    out.push({
      ...s,
      headlines: (heads as any[]).map(h => ({
        id: String(h.id),
        title: String(h.title),
        reliability: h.reliability_score == null ? null : Math.round(Number(h.reliability_score) * 100) / 100,
        outlets: h.source_count == null ? null : Number(h.source_count),
        at: h.created_at ? new Date(h.created_at).toISOString() : null,
        status: h.status ?? null,
      })),
    })
  }

  return {
    success: true,
    hours,
    window: { from: new Date(now.getTime() - hours * 3600_000).toISOString(), to: now.toISOString() },
    history_days: 7,
    min_count: minCount,
    spikes: out,
    generated_at: now.toISOString(),
  }
}

/** Same-day spikes for the last `hours` hours, kept and remade every 10 minutes */
export function getLiveSpikes(hours: LiveHours): Promise<LiveSpikesReport> {
  return staleWhileRevalidate(
    `cortex:live-spikes:v1:${hours}`,
    { freshSeconds: 600, staleSeconds: 6 * 3600, lockSeconds: 180 },
    () => longQuery(90, trx => compute(trx, hours)),
  )
}
