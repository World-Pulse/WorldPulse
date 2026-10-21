/**
 * A second read of the big stories few outlets carry (plan 11; Devon, Oct 21,
 * 2026: "Yes, with Claude Haiku", about $0.10 a day inside the $20 cap).
 *
 * A report's severity comes from word rules at intake (severity.ts: the dead
 * and injured it counts, the kind of event), and a high or critical one
 * lights up the map and the feed before a second outlet has carried it.
 * Every 10 minutes Claude's small model reads the newest high and critical
 * reports with fewer than 3 outlets, on the same scale as the rules, and
 * says whether each is a specific new event and how serious it is. The
 * story page shows the second read beside the rules': "Second read agrees:
 * HIGH", or "Second read: MEDIUM, not HIGH", or "Second read: analysis, not
 * a new event". Nothing changes the report's severity or status.
 *
 * Its verdicts go to verification_log (check_type second_read; verdict
 * agree, lower, higher or not_event), each report once. At most 400 reports
 * a day, 8 to a call: about 50 calls, a few cents a day.
 */

import type { SignalSeverity } from '@worldpulse/types'
import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import { askClaude, claudeConfigured } from '../lib/claude'
import { jsonIn } from './verify'

export const SECOND_READ_INTERVAL_MS = 10 * 60_000
/** Reports a call, calls a pass, reports a day */
const BATCH = 8
const CALLS_A_PASS = 3
export const DAILY_MAX = 400
/** How far back a pass looks; younger than SETTLE they wait (intake may still add outlets) */
const LOOKBACK_HOURS = 6
const SETTLE_MS = 2 * 60_000
const LOCK_KEY = 'ai:second:lock'
const DONE_KEY = (id: string) => `ai:second:done:${id}`
const COUNTS_KEY = (day: string) => `ai:second:counts:${day}`
export const SECOND_READ_PROMPT_VERSION = 1

export type SecondReadKind = 'event' | 'analysis' | 'roundup' | 'other'
export type SecondReadVerdict = 'agree' | 'lower' | 'higher' | 'not_event'

const RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 }

export const SECOND_READ_SYSTEM = `You give the second read of WorldPulse, a global news service. Word rules rated each numbered report high or critical, and only one or two outlets carry it so far. Judge each report only from its headline and summary.
- kind: "event" when it reports a specific new occurrence (an attack, a disaster, a death, an arrest, a decision, a result), "analysis" for opinion, analysis, an explainer, a preview or an anniversary, "roundup" for a digest or live blog of several items, "other" for anything else (adverts, features, sport).
- severity, on WorldPulse's scale: "critical" for mass casualties (100 or more dead), a nuclear or chemical attack or threat, or a major disaster happening now; "high" for 5 or more dead or 100 or more injured, strikes, bombings, coups, massacres, major earthquakes or storms, or hundreds of thousands without power or displaced; "medium" for any death or 10 or more injured, fighting, protests, disasters, arrests, policy changes or notable accidents; "low" for routine news and minor events.
Answer with only this JSON, one entry per report, in order: {"reports": [{"report": 1, "kind": "event", "severity": "high", "note": "a few words why"}]}`

export interface SecondReadRow { id: string; title: string; summary: string | null; severity: string }

/** The reports as Claude reads them: each headline, and the start of its summary when it says more */
export function secondReadPrompt(rows: SecondReadRow[]): string {
  return rows.map((r, i) => {
    const title = r.title.replace(/\s+/g, ' ').trim()
    const summary = (r.summary ?? '').replace(/\s+/g, ' ').trim()
    const more = summary && !summary.toLowerCase().startsWith(title.toLowerCase().slice(0, 40)) ? ` — ${summary.slice(0, 300)}` : ''
    return `Report ${i + 1}: ${title}${more}`
  }).join('\n')
}

export interface SecondRead { kind: SecondReadKind; severity: SignalSeverity; note: string }

/** Claude's answer as one read per report, in order (null where it said nothing usable) */
export function readSecondReads(text: string, count: number): Array<SecondRead | null> {
  const out: Array<SecondRead | null> = Array.from({ length: count }, () => null)
  const json = jsonIn(text)
  if (!json) return out
  let parsed: { reports?: unknown }
  try { parsed = JSON.parse(json) as { reports?: unknown } } catch { return out }
  if (!Array.isArray(parsed.reports)) return out
  parsed.reports.forEach((entry, i) => {
    const e = entry as { report?: unknown; kind?: unknown; severity?: unknown; note?: unknown }
    const at = typeof e.report === 'number' && Number.isInteger(e.report) ? e.report - 1 : i
    if (at < 0 || at >= count) return
    const kind = String(e.kind ?? '').toLowerCase()
    const severity = String(e.severity ?? '').toLowerCase()
    if (!['event', 'analysis', 'roundup', 'other'].includes(kind)) return
    if (!['critical', 'high', 'medium', 'low'].includes(severity)) return
    out[at] = { kind: kind as SecondReadKind, severity: severity as SignalSeverity, note: String(e.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) }
  })
  return out
}

/** The second read against the rules' severity */
export function verdictOf(rules: string, read: SecondRead): SecondReadVerdict {
  if (read.kind !== 'event') return 'not_event'
  const a = RANK[rules] ?? 0, b = RANK[read.severity] ?? 0
  return b === a ? 'agree' : b < a ? 'lower' : 'higher'
}

const KIND_WORDS: Record<SecondReadKind, string> = { event: 'a new event', analysis: 'analysis', roundup: 'a roundup', other: 'not news of an event' }

/** The line on the report's page (its verification timeline) */
export function timelineNote(rules: string, read: SecondRead, verdict: SecondReadVerdict): string {
  const why = read.note ? ` ${read.note.replace(/[.\s]+$/, '')}.` : ''
  const up = (s: string) => s.toUpperCase()
  if (verdict === 'agree') return `[Claude, second read] Agrees: ${up(read.severity)}, ${KIND_WORDS.event}.${why}`
  if (verdict === 'not_event') return `[Claude, second read] Reads as ${KIND_WORDS[read.kind]}, not a new event.${why}`
  return `[Claude, second read] Rates it ${up(read.severity)}, not ${up(rules)}.${why}`
}

export interface SecondReadStats { read: number; agree: number; lower: number; higher: number; not_event: number; unread: number; calls: number }

/** One pass: the newest high and critical reports with fewer than 3 outlets, each once */
export async function runSecondReads(now = new Date()): Promise<SecondReadStats> {
  const stats: SecondReadStats = { read: 0, agree: 0, lower: 0, higher: 0, not_event: 0, unread: 0, calls: 0 }
  if (!claudeConfigured()) return stats
  if (await redis.set(LOCK_KEY, '1', 'EX', 300, 'NX') !== 'OK') return stats
  try {
    const day = now.toISOString().slice(0, 10)
    const doneToday = Number(await redis.hget(COUNTS_KEY(day), 'read')) || 0
    const room = Math.min(BATCH * CALLS_A_PASS, DAILY_MAX - doneToday)
    if (room <= 0) return stats
    const found = await db.raw(
      `SELECT s.id, s.title, s.summary, s.severity::text AS severity
         FROM signals s
        WHERE s.created_at > now() - make_interval(hours => ?) AND s.created_at <= ?
          AND s.severity IN ('high', 'critical')
          AND s.status IN ('pending', 'verified')
          AND coalesce(s.source_count, 1) < 3
          AND NOT EXISTS (SELECT 1 FROM verification_log v WHERE v.signal_id = s.id AND v.check_type = 'second_read')
        ORDER BY s.created_at DESC
        LIMIT ?`,
      [LOOKBACK_HOURS, new Date(now.getTime() - SETTLE_MS).toISOString(), room * 2],
    )
    const candidates = ((found as { rows?: SecondReadRow[] })?.rows ?? []).filter(r => typeof r.title === 'string' && r.title.trim())
    // each report once, even when two passes overlap
    const rows: SecondReadRow[] = []
    for (const r of candidates) {
      if (rows.length >= room) break
      if (await redis.set(DONE_KEY(r.id), '1', 'EX', 2 * 86_400, 'NX') === 'OK') rows.push(r)
    }
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      const reply = await askClaude({ purpose: 'second_read', system: SECOND_READ_SYSTEM, prompt: secondReadPrompt(batch), maxTokens: 60 + 45 * batch.length, timeoutMs: 20_000 })
      stats.calls += 1
      if (!reply) {
        // the cap, no key or an error: these reports and the rest wait for a later pass
        await Promise.all(rows.slice(i).map(r => redis.del(DONE_KEY(r.id)).catch(() => 0)))
        break
      }
      const reads = readSecondReads(reply.text, batch.length)
      const entries: Array<Record<string, unknown>> = []
      batch.forEach((r, j) => {
        const read = reads[j]
        stats.read += 1
        if (!read) { stats.unread += 1; return }
        const verdict = verdictOf(r.severity, read)
        stats[verdict] += 1
        entries.push({
          signal_id:     r.id,
          check_type:    'second_read',
          verifier_type: 'ai_analysis',
          result:        verdict === 'agree' ? 'confirmed' : 'warning',
          verdict,
          confidence:    verdict === 'agree' ? 0.8 : 0.5,
          notes:         timelineNote(r.severity, read, verdict),
        })
      })
      if (entries.length) await db('verification_log').insert(entries)
    }
    if (stats.read) {
      const key = COUNTS_KEY(day)
      const multi = redis.multi()
      for (const k of ['read', 'agree', 'lower', 'higher', 'not_event', 'unread'] as const) if (stats[k]) multi.hincrby(key, k, stats[k])
      await multi.expire(key, 40 * 86_400).exec()
    }
    return stats
  } finally {
    await redis.del(LOCK_KEY).catch(() => 0)
  }
}

export function startSecondReads(): void {
  if (!claudeConfigured()) {
    logger.info('Second read off: no Claude key')
    return
  }
  const run = () => {
    runSecondReads()
      .then(s => { if (s.read) logger.info(s, 'Second read pass') })
      .catch(err => logger.warn({ err }, 'Second read pass failed (non-fatal)'))
  }
  setTimeout(run, 3 * 60_000)
  setInterval(run, SECOND_READ_INTERVAL_MS)
}
