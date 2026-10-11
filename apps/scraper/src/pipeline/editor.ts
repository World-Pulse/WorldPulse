/**
 * The editor: Claude re-reads the newest stories, 25 headlines at a time, and
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
/**
 * Stories a call. 25: of the 57 calls of 50 in the first catch-up (Oct 11,
 * 2026), few changed any story, while passes of about 30 changed half of theirs
 */
const BATCH = 25
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

Answer with exactly one line per story, in the order given: the story's number, a space, and the category name in lower case, for example "7 conflict". Don't repeat the headlines, don't explain, and don't use markdown.`

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

const isCategory = (word: string | undefined): word is string => !!word && Object.hasOwn(EDITOR_CATEGORIES, word)

/**
 * The editor's answer as {story number → category}, keeping only known
 * categories. Reads "7 conflict" as asked, and the forms a reply drifts to:
 * "7. **conflict**", "| 7 | conflict |", "Story 7: conflict", "(7) conflict",
 * JSON ("7": "conflict"), several on one line ("1 conflict, 2 sports"), the
 * headline repeated before the category ("7. Strike hits port → conflict"),
 * or bare categories in order without numbers.
 */
export function parseEditorReply(text: string, count: number): Map<number, string> {
  const filed = new Map<number, string>()
  const file = (n: number, category: string | undefined) => {
    if (n >= 1 && n <= count && !filed.has(n) && isCategory(category)) filed.set(n, category)
  }
  const lines = text.split('\n').map(line => line.replace(/[*_`#|>•]/g, ' ').trim()).filter(Boolean)
  // A line per story: the category right after the number, or else the last one on the line
  for (const line of lines) {
    const m = /^(?:story\s*)?(\d{1,3})\b\s*[.):\-–—]?\s*(.*)$/i.exec(line)
    if (!m) continue
    const words = m[2]!.toLowerCase().match(/[a-z]+/g) ?? []
    file(Number(m[1]), isCategory(words[0]) ? words[0] : [...words].reverse().find(isCategory))
  }
  // Number and category pairs anywhere: JSON, brackets, several on a line
  for (const m of text.matchAll(/(\d{1,3})[^a-z0-9\n]{0,6}?([a-z]+)/gi)) file(Number(m[1]), m[2]!.toLowerCase())
  // Bare categories in order
  if (filed.size === 0) {
    const words = text.toLowerCase().split(/[\n,;]+/).map(w => w.replace(/[^a-z]/g, '')).filter(Boolean)
    if (words.length === count && words.every(isCategory)) words.forEach((w, i) => file(i + 1, w))
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

export interface EditorPassStats {
  read:       number
  /** Stories filed under a new category */
  changed:    number
  /** Rows Postgres says the updates wrote (should equal changed) */
  written:    number
  batches:    number
  costMicros: number
  /** Stories the reply gave no known category for, and the start of the first such reply */
  unparsed:   number
  replySample?: string
  stopped:    boolean
  /** Why the pass stopped early, when it did */
  error?:     string
  /** Of the last pass's re-filed stories: how many still carry the editor's category, and how many were changed back since */
  held:       number
  undone:     number
  /** A few of this pass's changes, and of the last pass's undone ones, to read in ops-status */
  examples:   Array<{ title: string; from: string; to: string }>
  undoneExamples: Array<{ title: string; filed: string; now: string }>
}

const FILED_KEY = 'ai:editor:filed'

/**
 * Whether the stories the last pass re-filed still carry its categories. A
 * story changed back since shows that something else re-files stories after
 * the editor (on Oct 11, 2026 a start-up repair re-applied the word rules to
 * three days of news, undoing the editor's work at every restart).
 */
async function checkLastPass(stats: EditorPassStats): Promise<void> {
  const raw = await redis.get(FILED_KEY)
  if (!raw) return
  let filed: Array<[string, string]>
  try { filed = JSON.parse(raw) as Array<[string, string]> } catch { return }
  if (!Array.isArray(filed) || filed.length === 0) return
  const found = await db.raw(
    'SELECT id, title, category::text AS category FROM signals WHERE id = ANY(?::uuid[])',
    [filed.map(([id]) => id)],
  )
  const now = new Map(((found as { rows?: Array<{ id: string; title: string; category: string }> })?.rows ?? []).map(r => [r.id, r]))
  for (const [id, category] of filed) {
    const row = now.get(id)
    if (!row) continue
    if (row.category === category) { stats.held++; continue }
    stats.undone++
    if (stats.undoneExamples.length < 3) stats.undoneExamples.push({ title: row.title.slice(0, 90), filed: category, now: row.category })
  }
}

/**
 * One pass over the stories saved since the last one (at most 300), looking
 * back at most an hour (or lookbackMs, for a catch-up)
 */
export async function runEditorPass(now = new Date(), lookbackMs = LOOKBACK_MS): Promise<EditorPassStats> {
  const stats: EditorPassStats = {
    read: 0, changed: 0, written: 0, batches: 0, costMicros: 0, unparsed: 0, stopped: false,
    held: 0, undone: 0, examples: [], undoneExamples: [],
  }
  if (!claudeConfigured()) return stats
  if (await redis.set(LOCK_KEY, '1', 'EX', 600, 'NX') !== 'OK') return stats
  try {
    await checkLastPass(stats).catch(err => logger.warn({ err }, 'Editor: check of the last pass failed'))
    const mark = Number(await redis.get(MARK_KEY)) || 0
    const since = new Date(Math.max(mark, now.getTime() - lookbackMs))
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
    const refiled: Array<[string, string]> = []

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      // (the stories of a batch that couldn't be filed are retried next pass)
      const retryFrom = new Date(batch[0]!.created_at).getTime() - 1
      const reply = await askClaude({
        purpose:   'editor',
        system:    EDITOR_SYSTEM,
        prompt:    editorPrompt(batch),
        maxTokens: 16 * batch.length + 50,
      })
      if (!reply) { stats.stopped = true; stats.error = 'no answer from Claude (the cap, or an error)'; doneUntil = Math.min(doneUntil, retryFrom); break }
      stats.batches++
      stats.read += batch.length
      stats.costMicros += reply.costMicros

      const filed = parseEditorReply(reply.text, batch.length)
      if (filed.size < batch.length) {
        stats.unparsed += batch.length - filed.size
        stats.replySample ??= reply.text.slice(0, 200)
      }
      const changes: Array<{ id: string; category: string; severity: string }> = []
      batch.forEach((row, k) => {
        const category = filed.get(k + 1)
        if (!category || !differs(row.category, category)) return
        changes.push({ id: row.id, category, severity: severityUnder(row, category) })
        if (stats.examples.length < 6) stats.examples.push({ title: row.title.slice(0, 90), from: row.category, to: category })
      })
      if (changes.length > 0) {
        try {
          // A row another write holds locked fails the batch after 10 s, rather than stalling every pass after it
          const written = await db.transaction(async trx => {
            await trx.raw(`SET LOCAL lock_timeout = '10s'`)
            const result: unknown = await trx.raw(
              `UPDATE signals AS s SET category = v.category::category, severity = v.severity::signal_severity
                 FROM (VALUES ${changes.map(() => '(?::uuid, ?::text, ?::text)').join(', ')}) AS v(id, category, severity)
                WHERE s.id = v.id
                RETURNING s.id`,
              changes.flatMap(c => [c.id, c.category, c.severity]),
            )
            return Number((result as { rowCount?: number } | undefined)?.rowCount ?? 0)
          })
          stats.written += written
        } catch (err) {
          stats.stopped = true
          stats.error = `update failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200)
          doneUntil = Math.min(doneUntil, retryFrom)
          break
        }
        stats.changed += changes.length
        for (const c of changes) refiled.push([c.id, c.category])
      }
      if (rows.length >= MAX_PER_PASS) doneUntil = new Date(batch[batch.length - 1]!.created_at).getTime()
    }

    await redis.set(MARK_KEY, String(doneUntil), 'EX', 7 * 86_400)
    if (refiled.length > 0) await redis.set(FILED_KEY, JSON.stringify(refiled), 'EX', 2 * 86_400)
    // The last 12 passes in brief (a catch-up runs several in a row), newest first
    const window = { at: now.toISOString(), since: since.toISOString(), until: new Date(doneUntil).toISOString() }
    let history: unknown[] = []
    try { history = (JSON.parse(await redis.get(STATS_KEY) ?? '{}') as { history?: unknown[] }).history ?? [] } catch { history = [] }
    const brief = {
      ...window, read: stats.read, changed: stats.changed, written: stats.written, unparsed: stats.unparsed,
      held: stats.held, undone: stats.undone, ...(stats.error ? { error: stats.error } : {}),
    }
    await redis.set(STATS_KEY, JSON.stringify({ ...window, ...stats, history: [brief, ...history].slice(0, 12) }), 'EX', 2 * 86_400)
    return stats
  } finally {
    await redis.del(LOCK_KEY).catch(() => {})
  }
}

/** A pass in the scraper's log: what it did, and anything that went wrong */
function reportPass(s: EditorPassStats): void {
  if (s.read > 0 || s.stopped) logger.info(s, 'Editor pass: stories re-filed by Claude')
  if (s.undone > 0) logger.warn({ undone: s.undone, held: s.held, examples: s.undoneExamples }, 'Editor: stories it re-filed were changed back')
  if (s.written < s.changed) logger.warn({ changed: s.changed, written: s.written }, 'Editor: some changes were not written')
  if (s.unparsed > 0) logger.warn({ unparsed: s.unparsed, read: s.read, sample: s.replySample }, "Editor: Claude's reply missed some stories")
}

/**
 * Once, at a start (index.ts): the last hours read again, pass after pass,
 * for the stories the editor's first passes couldn't read and those a
 * start-up repair filed back by the word rules (Oct 11, 2026). About 250
 * stories an hour, so 12 hours cost a few cents. A lock left by a stopped
 * process is cleared first: at a start no pass of this one is running yet.
 */
export async function catchUpEditor(hours: number, now = new Date()): Promise<{ passes: number; read: number; changed: number; stopped: boolean }> {
  const total = { passes: 0, read: 0, changed: 0, stopped: false }
  if (!claudeConfigured()) return total
  const lookbackMs = hours * 3_600_000
  await redis.del(LOCK_KEY)
  await redis.set(MARK_KEY, String(now.getTime() - lookbackMs), 'EX', 7 * 86_400)
  for (let i = 0; i < 25; i++) {
    const pass = await runEditorPass(new Date(), lookbackMs)
    reportPass(pass)
    total.passes++
    total.read += pass.read
    total.changed += pass.changed
    if (pass.stopped) { total.stopped = true; break }
    // Caught up once a pass has read up to the minute before it ran
    if (Number(await redis.get(MARK_KEY)) >= Date.now() - SETTLE_MS - 60_000) break
  }
  return total
}

/** Every 15 minutes while a Claude key is set (the first pass two minutes after start) */
export function startEditor(): void {
  if (!claudeConfigured()) {
    logger.info('Editor off: no Claude key (the word rules file every story)')
    return
  }
  const run = () => {
    runEditorPass()
      .then(reportPass)
      .catch(err => logger.warn({ err }, 'Editor pass failed (non-fatal)'))
  }
  setTimeout(run, 2 * 60_000)
  setInterval(run, EDITOR_INTERVAL_MS)
}
