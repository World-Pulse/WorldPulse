/**
 * The editor: Claude re-reads the newest stories, 50 headlines at a time, and
 * files each under its category (Oct 11, 2026, Devon's in-house plan).
 *
 * The word rules (categories.ts) file every story at intake, instantly and
 * for free. Every 15 minutes the editor fixes what they miss: headlines in
 * other languages, stories without the rules' words, a news feed's own
 * category used as a fallback. Severity then follows the new category the way
 * classify.ts caps it. Sensor feeds (weather, quakes, fires, flights …) and
 * GDELT's event-label titles keep their category.
 *
 * Calls stay within the Claude spending cap (lib/claude.ts); when it's
 * reached, the rules' categories stand and the next pass tries again.
 */

import type { SignalSeverity } from '@worldpulse/types'
import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import { askClaude, claudeConfigured } from '../lib/claude'
import { EVENT_TEMPLATE_SQL } from './event-titles'
import { rateSeverity } from './severity'
import { maxSeverityForSourceCount } from './reliability-score'
import { repeatsTitle } from './text'

export const EDITOR_INTERVAL_MS = 15 * 60_000
const BATCH = 50
const MAX_PER_PASS = 300
/** How far back a pass looks without a mark, or with an old one */
const LOOKBACK_MS = 60 * 60_000
/** Stories younger than this wait for the next pass (intake may still be adding outlets) */
const SETTLE_MS = 60_000
const MARK_KEY  = 'ai:editor:since'
const LOCK_KEY  = 'ai:editor:lock'
const STATS_KEY = 'ai:editor:last'

/** The categories the editor gives, and what each covers (its instructions say so) */
export const EDITOR_CATEGORIES: Record<string, string> = {
  conflict:    'armed fighting, attacks, air and drone strikes, shootings, militant violence, military operations',
  geopolitics: 'diplomacy, relations between countries, governments and domestic politics, protests',
  elections:   'votes, election campaigns and candidates, results, referendums',
  economy:     'markets, trade, companies, jobs, prices, budgets, the economic effects of sanctions',
  health:      'disease and outbreaks, hospitals and health care, medicines, public health',
  disaster:    'earthquakes, storms, floods, wildfires, shipwrecks, crashes and other accidents with victims',
  climate:     'climate change, emissions, the energy transition, environmental policy',
  security:    'crime and policing, terrorist plots, espionage, cyber attacks, criminal trials',
  technology:  'technology companies and products, AI, the internet, telecoms',
  science:     'research findings, discoveries, archaeology',
  space:       'space missions, rockets, satellites, astronomy',
  sports:      'sport and athletes',
  culture:     'arts, film, TV, music, books, celebrities, religion, lifestyle',
  other:       'local human-interest stories, travel, shopping and adverts, anything that isn\'t news of wider interest',
}

export const EDITOR_SYSTEM = `You are the news desk editor of WorldPulse, a global news service. File each numbered story under exactly one category, by what the story is about. Headlines may be in any language.

Categories:
${Object.entries(EDITOR_CATEGORIES).map(([name, covers]) => `${name}: ${covers}`).join('\n')}

Answer with one line per story, in the order given: its number, a space, the category name. Nothing else.`

export interface EditorRow {
  id:           string
  title:        string
  summary:      string | null
  category:     string
  severity:     string
  source_count: number | null
  created_at:   Date | string
}

/** The numbered list the editor reads: each headline, and the start of its summary when it says more */
export function editorPrompt(rows: Array<Pick<EditorRow, 'title' | 'summary'>>): string {
  return rows.map((row, i) => {
    const title = row.title.replace(/\s+/g, ' ').trim()
    const summary = row.summary && !repeatsTitle(row.summary, row.title)
      ? ` | ${row.summary.replace(/\s+/g, ' ').trim().slice(0, 160)}`
      : ''
    return `${i + 1}. ${title}${summary}`
  }).join('\n')
}

/** The editor's answer as {story number → category}, keeping only known categories */
export function parseEditorReply(text: string, count: number): Map<number, string> {
  const filed = new Map<number, string>()
  for (const line of text.split('\n')) {
    const m = /^\s*(\d{1,3})\s*[.):\-–]?\s*([a-z]+)\b/i.exec(line)
    if (!m) continue
    const n = Number(m[1])
    const category = m[2]!.toLowerCase()
    if (n >= 1 && n <= count && category in EDITOR_CATEGORIES && !filed.has(n)) filed.set(n, category)
  }
  return filed
}

const RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 }
const BY_RANK: SignalSeverity[] = ['info', 'low', 'medium', 'high', 'critical']
const CAPPED_AT_MEDIUM = new Set(['culture', 'sports', 'science', 'space'])

/**
 * Severity under a new category: what the words earn, up to what the outlet
 * count allows, never below what the story had; then classify.ts's caps
 * ("other" at most low; culture, sports, science and space at most medium).
 */
export function severityUnder(row: Pick<EditorRow, 'title' | 'summary' | 'severity' | 'source_count'>, category: string): SignalSeverity {
  const current = RANK[row.severity] ?? RANK.low!
  const earned  = RANK[rateSeverity(row.title, row.summary, category)] ?? 0
  const allowed = RANK[maxSeverityForSourceCount(Number(row.source_count) || 1, category)] ?? RANK.medium!
  let rank = Math.max(current, Math.min(earned, allowed))
  if (category === 'other') rank = Math.min(rank, RANK.low!)
  else if (CAPPED_AT_MEDIUM.has(category)) rank = Math.min(rank, RANK.medium!)
  return BY_RANK[rank]!
}

/** Whether a new category is a change (a feed's "finance" is the editor's "economy") */
function differs(current: string, filed: string): boolean {
  return current !== filed && !(current === 'finance' && filed === 'economy')
}

export interface EditorPassStats { read: number; changed: number; batches: number; costMicros: number; stopped: boolean }

/** One pass over the stories saved since the last one (at most 300) */
export async function runEditorPass(now = new Date()): Promise<EditorPassStats> {
  const stats: EditorPassStats = { read: 0, changed: 0, batches: 0, costMicros: 0, stopped: false }
  if (!claudeConfigured()) return stats
  if (await redis.set(LOCK_KEY, '1', 'EX', 600, 'NX') !== 'OK') return stats
  try {
    const mark = Number(await redis.get(MARK_KEY)) || 0
    const since = new Date(Math.max(mark, now.getTime() - LOOKBACK_MS))
    const until = new Date(now.getTime() - SETTLE_MS)
    const found = await db.raw(
      `SELECT id, title, summary, category::text AS category, severity::text AS severity, source_count, created_at
         FROM signals
        WHERE created_at > ? AND created_at <= ?
          AND status IN ('pending', 'verified')
          AND (NOT (tags @> ARRAY['osint']::text[]) OR tags @> ARRAY['gdelt']::text[])
          AND title !~ ?
        ORDER BY created_at ASC
        LIMIT ${MAX_PER_PASS}`,
      [since.toISOString(), until.toISOString(), EVENT_TEMPLATE_SQL],
    )
    const rows = ((found as { rows?: EditorRow[] })?.rows ?? []).filter(r => typeof r.title === 'string' && r.title.trim())
    let doneUntil = rows.length < MAX_PER_PASS ? until.getTime() : since.getTime()

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      const reply = await askClaude({
        purpose:   'editor',
        system:    EDITOR_SYSTEM,
        prompt:    editorPrompt(batch),
        maxTokens: 16 * batch.length + 50,
      })
      if (!reply) { stats.stopped = true; doneUntil = Math.min(doneUntil, new Date(batch[0]!.created_at).getTime() - 1); break }
      stats.batches++
      stats.read += batch.length
      stats.costMicros += reply.costMicros

      const filed = parseEditorReply(reply.text, batch.length)
      const changes: Array<{ id: string; category: string; severity: string }> = []
      batch.forEach((row, k) => {
        const category = filed.get(k + 1)
        if (!category || !differs(row.category, category)) return
        changes.push({ id: row.id, category, severity: severityUnder(row, category) })
      })
      if (changes.length > 0) {
        await db.raw(
          `UPDATE signals AS s SET category = v.category::category, severity = v.severity::signal_severity
             FROM (VALUES ${changes.map(() => '(?::uuid, ?::text, ?::text)').join(', ')}) AS v(id, category, severity)
            WHERE s.id = v.id`,
          changes.flatMap(c => [c.id, c.category, c.severity]),
        )
        stats.changed += changes.length
      }
      if (rows.length >= MAX_PER_PASS) doneUntil = new Date(batch[batch.length - 1]!.created_at).getTime()
    }

    await redis.set(MARK_KEY, String(doneUntil), 'EX', 7 * 86_400)
    await redis.set(STATS_KEY, JSON.stringify({ at: now.toISOString(), ...stats }), 'EX', 2 * 86_400)
    return stats
  } finally {
    await redis.del(LOCK_KEY).catch(() => {})
  }
}

/** Every 15 minutes while a Claude key is set (the first pass two minutes after start) */
export function startEditor(): void {
  if (!claudeConfigured()) {
    logger.info('Editor off: no Claude key (the word rules file every story)')
    return
  }
  const run = () => {
    runEditorPass()
      .then(s => { if (s.read > 0 || s.stopped) logger.info(s, 'Editor pass: stories re-filed by Claude') })
      .catch(err => logger.warn({ err }, 'Editor pass failed (non-fatal)'))
  }
  setTimeout(run, 2 * 60_000)
  setInterval(run, EDITOR_INTERVAL_MS)
}
