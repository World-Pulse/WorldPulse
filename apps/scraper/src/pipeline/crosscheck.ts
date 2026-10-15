/**
 * Ledger's cross-check of verifications (Oct 11, 2026, in-house plan).
 *
 * A story turns verified when a second independent outlet reports it, and
 * whether two reports are "the same story" is judged by their headlines'
 * words (correlate.ts isSameStory). When that happens, Claude reads the
 * reports and says whether they describe the same event, and whether they
 * agree on its main facts.
 *
 * It records its verdicts: today's counts and the newest doubtful ones in
 * ops-status, and on each report's page a line in the verification timeline
 * ("the outlets differ: …" when they disagree on facts). Calls stay within
 * the Claude spending cap (lib/claude.ts), about a thousand a day at a few
 * hundredths of a cent each.
 *
 * The gate (plan D6, Oct 15, 2026): a "different event" verdict puts the
 * reports this verification promoted back to pending, with a line on their
 * pages, and ops-status counts them ("held"). Read first: of the 30 newest
 * version-3 "different event" verdicts on Oct 15, 28 were right (the bar was
 * 25). The two wrong ones: one analysis republished under another headline,
 * and a documentary's announcement and its trailer. When Claude gives no
 * answer, nothing is held: the story stays verified, as before.
 */

import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import { askClaude, claudeConfigured } from '../lib/claude'
import { jsonIn } from './verify'

/**
 * What Claude is asked (version 3, Oct 14, 2026).
 *
 * Version 1 asked whether the reports were "the same event" and nothing
 * more: of its 30 newest "different event" verdicts, about 14 were one event
 * told differently (the IMF's world and country forecasts from one release, a
 * death toll and a later one, a live blog and the day's recap, an explainer,
 * one column under two headlines), and a later development counted as
 * disagreement ("the outlets differ": arrested, then released).
 *
 * Version 2 (Oct 13) said what counts, and compared the report that just
 * verified the story with the ones it already had. Of its 25 "different
 * event" verdicts, the ones about stories the grouping joined wrongly were
 * right (two campaign councils, two football matches, unrelated companies at
 * one conference), but it went wrong three ways: a roundup or live blog that
 * includes Report 1's event (a missile story inside a markets roundup, a
 * tanker attack inside a four-alert roundup); one off-topic report in a group
 * whose others match, where its one answer said the whole story differed;
 * and two figures from one release (OPEC's 2026 and 2027 forecasts).
 *
 * Version 3 asks report by report, and the code decides: "different" only
 * when no other report covers Report 1's event, "conflicting" only from the
 * reports that do.
 */
export const CROSSCHECK_PROMPT_VERSION = 3

export const CROSSCHECK_SYSTEM = `You check the verification of WorldPulse, a global news service. A story turns verified when a second independent outlet reports it. Report 1 is the report that just verified this story; the others are reports the story already had. They were matched as one story by the words of their headlines, which can join reports that only share words.
For each other report, answer on its own:
- same_event: true when it covers Report 1's news event (or one of Report 1's events, when Report 1 is itself a roundup). Reports of one event often differ, and that is still the same event: other angles or detail; updated figures (a death toll that rose, a release that followed an arrest); reactions and follow-ups within days (a vow to respond, further strikes in the same campaign); other figures from the same announcement, release, report or meeting (a forecast's figures for two years, a country's and the world's numbers); a live blog, a recap, an explainer or analysis of it; a roundup, digest or briefing that includes it among other items; the same article or column under another headline. false only when it describes a separate occurrence: another incident of the same kind (arrests in another city, another earthquake, a raid on another town), other people doing a similar thing (another country's minister at the same meeting), a gallery or digest naming no specific event, or a topic in common and nothing more.
- agree: false only when it states facts about the same event that can't both be true with Report 1's (where it happened, who did it, a figure for the same moment). A later report adding news or updated figures is not disagreement.
Answer with only this JSON, one entry per other report, in order: {"reports": [{"report": 2, "same_event": true or false, "agree": true or false}], "note": "one short sentence"}`

export type CrossCheckVerdict = 'same' | 'conflicting' | 'different'

export interface CrossCheckReport { title: string; summary?: string | null }

/** The reports as Claude reads them: each headline, and the start of its summary when it says more */
export function crossCheckPrompt(reports: CrossCheckReport[]): string {
  return reports.slice(0, 4).map((r, i) => {
    const title = r.title.replace(/\s+/g, ' ').trim()
    const summary = (r.summary ?? '').replace(/\s+/g, ' ').trim()
    const more = summary && !summary.toLowerCase().startsWith(title.toLowerCase().slice(0, 40)) ? ` — ${summary.slice(0, 240)}` : ''
    return `Report ${i + 1}: ${title}${more}`
  }).join('\n')
}

export interface CrossCheckRead {
  verdict: CrossCheckVerdict
  note:    string
  /** Version 3: whether each other report (Report 2 on) covers Report 1's event */
  matches?: boolean[]
}

interface ReportAnswer { report?: unknown; same_event?: unknown; agree?: unknown }

/**
 * Claude's answer as a verdict, or null when it can't be read. Version 3
 * answers report by report, and the verdict is worked out here: "different"
 * only when no other report covers Report 1's event (one off-topic report in
 * a group whose others match doesn't make the story different), and
 * "conflicting" only when a report that covers it disagrees. A single
 * same_event/agree answer (version 2) is still read.
 */
export function readVerdict(text: string): CrossCheckRead | null {
  const json = jsonIn(text)
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as { reports?: unknown; same_event?: unknown; agree?: unknown; note?: unknown }
    const note = String(parsed.note ?? '').slice(0, 200)
    if (Array.isArray(parsed.reports)) {
      const answers = (parsed.reports as ReportAnswer[])
        .filter(a => !!a && typeof a.same_event === 'boolean')
        .sort((a, b) => (Number(a.report) || 0) - (Number(b.report) || 0))
      if (answers.length === 0) return null
      const matches = answers.map(a => a.same_event === true)
      const verdict: CrossCheckVerdict = !matches.some(Boolean) ? 'different'
        : answers.some(a => a.same_event === true && a.agree === false) ? 'conflicting'
        : 'same'
      return { verdict, note, matches }
    }
    if (typeof parsed.same_event !== 'boolean') return null
    const verdict: CrossCheckVerdict = !parsed.same_event ? 'different' : parsed.agree === false ? 'conflicting' : 'same'
    return { verdict, note }
  } catch {
    return null
  }
}

const COUNTS_KEY = (now: Date) => `ai:verify:counts:${now.toISOString().slice(0, 10)}`
const RECENT_KEY = 'ai:verify:recent'
/** The newest "different event" verdicts alone (30), so a day of them can be
 * read before they may hold a story at pending (ops-status crosscheck_different) */
const DIFFERENT_KEY = 'ai:verify:different'

/**
 * Cross-check a story that just turned verified: its signals (by id) and any
 * report that isn't saved as a signal (an article merged into it). Records
 * the verdict, and on a "different event" verdict puts the reports this
 * verification promoted (`promoted`) back to pending. Null when nothing was asked.
 */
export async function crossCheckVerification(
  storyIds: string[],
  extra: CrossCheckReport[] = [],
  now = new Date(),
  promoted: string[] = [],
): Promise<CrossCheckVerdict | null> {
  if (!claudeConfigured()) return null
  // The report that just turned verified (the first id), and the story's oldest ones
  const found = await db.raw(
    'SELECT id, title, summary FROM signals WHERE id = ANY(?::uuid[]) ORDER BY (id = ?::uuid) DESC, created_at ASC LIMIT 4',
    [[...new Set(storyIds)], storyIds[0]],
  )
  const saved = ((found as { rows?: Array<{ id: string; title: string; summary: string | null }> })?.rows ?? [])
    .filter(r => typeof r.title === 'string' && r.title.trim())
  const reports: CrossCheckReport[] = [...saved, ...extra.filter(r => typeof r.title === 'string' && r.title.trim())]
  if (reports.length < 2) return null

  // (an answer per report: room for three of them and the note)
  const reply = await askClaude({ purpose: 'crosscheck', system: CROSSCHECK_SYSTEM, prompt: crossCheckPrompt(reports), maxTokens: 220, timeoutMs: 20_000 })
  const read = reply ? readVerdict(reply.text) : null
  const key = COUNTS_KEY(now)
  const multi = redis.multi().hincrby(key, read ? read.verdict : 'unread', 1).expire(key, 40 * 86_400)
  if (read && read.verdict !== 'same') {
    const entry = JSON.stringify({
      at:      now.toISOString(),
      id:      storyIds[0],
      verdict: read.verdict,
      note:    read.note,
      // every headline Claude read (Report 1 first), so a reader can judge the verdict
      titles:  reports.slice(0, 4).map(r => r.title.slice(0, 90)),
      // version 3: whether each of Report 2 on covers Report 1's event
      ...(read.matches ? { matches: read.matches } : {}),
      prompt:  CROSSCHECK_PROMPT_VERSION,
    })
    multi.lpush(RECENT_KEY, entry).ltrim(RECENT_KEY, 0, 19).expire(RECENT_KEY, 7 * 86_400)
    if (read.verdict === 'different') multi.lpush(DIFFERENT_KEY, entry).ltrim(DIFFERENT_KEY, 0, 29).expire(DIFFERENT_KEY, 7 * 86_400)
  }
  await multi.exec()
  if (read && read.verdict !== 'same') logger.info({ storyId: storyIds[0], verdict: read.verdict, note: read.note }, 'Cross-check: a verified story Claude doubts')
  // The gate: no other report covers this event, so what this verification promoted goes back to pending
  const held = read?.verdict === 'different' ? await holdAtPending(promoted, now) : []
  // (only on the pages of the reports Claude read; "different" only on the ones it held)
  const pages = read?.verdict === 'different' ? held : saved.map(r => r.id)
  if (read) await logOnSignalPages(pages, read).catch(err => logger.warn({ err }, 'Cross-check not logged on the signal pages'))
  return read?.verdict ?? null
}

/**
 * Put back to pending the reports a verification promoted, when no other
 * report covers their event. Only ones still verified (nothing else has
 * changed them since); their outlets and reliability stay as counted, and a
 * later report that turns them verified again is cross-checked again.
 * Returns the ids it held.
 */
async function holdAtPending(ids: string[], now: Date): Promise<string[]> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return []
  const rows = await db('signals')
    .whereIn('id', unique)
    .where('status', 'verified')
    .update({ status: 'pending', verified_at: null })
    .returning('id') as Array<{ id: string }>
  const held = rows.map(r => r.id)
  if (held.length > 0) {
    await redis.hincrby(COUNTS_KEY(now), 'held', held.length)
    logger.info({ held }, 'Cross-check: held at pending (the other reports are a different event)')
  }
  return held
}

/** What a verdict shows in a signal page's verification timeline (verification_log) */
export function timelineEntry(read: { verdict: CrossCheckVerdict; note: string }): { result: string; confidence: number; notes: string } {
  if (read.verdict === 'same') return { result: 'confirmed', confidence: 0.9, notes: `[Claude] ${read.note}` }
  if (read.verdict === 'conflicting') return { result: 'warning', confidence: 0.6, notes: `[Claude] The outlets differ: ${read.note}` }
  // Only on the reports the gate held back
  return { result: 'pending', confidence: 0.3, notes: `[Claude] Back to pending: the other outlets reported a different event. ${read.note}` }
}

/**
 * The verdict in the verification timeline of each report's page, once per
 * report: a story is checked again when a new outlet's report turns
 * verified, and only the reports not logged in the last 6 hours get a line.
 */
async function logOnSignalPages(storyIds: string[], read: { verdict: CrossCheckVerdict; note: string }): Promise<void> {
  const entry = timelineEntry(read)
  const fresh: string[] = []
  for (const id of new Set(storyIds.filter(Boolean))) {
    if (await redis.set(`ai:verify:logged:${id}`, '1', 'EX', 6 * 3_600, 'NX') === 'OK') fresh.push(id)
  }
  if (fresh.length === 0) return
  // (only the table's first columns: the later ones come from a migration production may not have run)
  await db('verification_log').insert(fresh.map(id => ({
    signal_id:  id,
    check_type: 'cross_check',
    result:     entry.result,
    confidence: entry.confidence,
    notes:      entry.notes,
  })))
}

/**
 * Fire and forget: a failed cross-check never holds up the pipeline.
 * `promoted`: the reports this verification turned verified (the ones the gate may hold back).
 */
export function crossCheckLater(storyIds: string[], extra: CrossCheckReport[] = [], promoted: string[] = []): void {
  crossCheckVerification(storyIds, extra, new Date(), promoted).catch(err => logger.warn({ err }, 'Cross-check failed (non-fatal)'))
}
