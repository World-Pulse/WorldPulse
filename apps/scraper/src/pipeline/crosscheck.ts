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
 * ("the outlets differ: …" when they disagree on facts). It doesn't change a
 * story's status yet: once a day's verdicts have been read, a "different
 * event" verdict can hold a story back from verified. Calls stay within the Claude spending cap (lib/claude.ts),
 * about a thousand a day at a few hundredths of a cent each.
 */

import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import { askClaude, claudeConfigured } from '../lib/claude'
import { jsonIn } from './verify'

/**
 * What Claude is asked (version 2, Oct 13, 2026). Version 1 asked whether
 * the reports were "the same event" and nothing more: of its 30 newest
 * "different event" verdicts, about 14 were one event told differently (the
 * IMF's world and country forecasts from one release, a death toll and a
 * later one, a live blog and the day's recap, an explainer, one column under
 * two headlines), and a later development counted as disagreement ("the
 * outlets differ": arrested, then released). Too many to let a verdict hold
 * a story back, so the question now says what counts, and compares the
 * report that just verified the story with the ones it already had.
 */
export const CROSSCHECK_PROMPT_VERSION = 2

export const CROSSCHECK_SYSTEM = `You check the verification of WorldPulse, a global news service. A story turns verified when a second independent outlet reports it. Report 1 is the report that just verified this story; the others are reports the story already had. They were matched as one story by the words of their headlines, which can join reports that only share words.
Say:
- same_event: true when Report 1 reports the same news event as the other reports (or most of them). Reports of one event often differ, and that is still the same event: other angles or detail; updated figures (a death toll that rose, a release that followed an arrest); reactions and follow-ups within days (a vow to respond, further strikes in the same campaign); figures from one announcement or release (a forecast's world and country numbers); a live blog and a recap of the same day; an explainer or analysis of it; the same article or column under another headline. false only when Report 1 describes a separate occurrence: another incident of the same kind (arrests in another city, another earthquake, a raid on another town), other people doing a similar thing (another country's minister at the same meeting), a roundup, digest or photo gallery naming no specific event, or a topic in common and nothing more.
- agree: false only when the reports state facts about the event that can't both be true at once (where it happened, who did it, a figure for the same moment). A later report adding news or updated figures is not disagreement.
Answer with only this JSON: {"same_event": true or false, "agree": true or false, "note": "one short sentence"}`

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

/** Claude's answer as a verdict, or null when it can't be read */
export function readVerdict(text: string): { verdict: CrossCheckVerdict; note: string } | null {
  const json = jsonIn(text)
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as { same_event?: unknown; agree?: unknown; note?: unknown }
    if (typeof parsed.same_event !== 'boolean') return null
    const verdict: CrossCheckVerdict = !parsed.same_event ? 'different' : parsed.agree === false ? 'conflicting' : 'same'
    return { verdict, note: String(parsed.note ?? '').slice(0, 200) }
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
 * the verdict; never changes the story. Null when nothing was asked.
 */
export async function crossCheckVerification(
  storyIds: string[],
  extra: CrossCheckReport[] = [],
  now = new Date(),
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

  const reply = await askClaude({ purpose: 'crosscheck', system: CROSSCHECK_SYSTEM, prompt: crossCheckPrompt(reports), maxTokens: 150, timeoutMs: 20_000 })
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
      prompt:  CROSSCHECK_PROMPT_VERSION,
    })
    multi.lpush(RECENT_KEY, entry).ltrim(RECENT_KEY, 0, 19).expire(RECENT_KEY, 7 * 86_400)
    if (read.verdict === 'different') multi.lpush(DIFFERENT_KEY, entry).ltrim(DIFFERENT_KEY, 0, 29).expire(DIFFERENT_KEY, 7 * 86_400)
  }
  await multi.exec()
  if (read && read.verdict !== 'same') logger.info({ storyId: storyIds[0], verdict: read.verdict, note: read.note }, 'Cross-check: a verified story Claude doubts')
  // (only on the pages of the reports Claude read)
  if (read) await logOnSignalPages(saved.map(r => r.id), read).catch(err => logger.warn({ err }, 'Cross-check not logged on the signal pages'))
  return read?.verdict ?? null
}

/** What a verdict shows in a signal page's verification timeline (verification_log) */
export function timelineEntry(read: { verdict: CrossCheckVerdict; note: string }): { result: string; confidence: number; notes: string } | null {
  if (read.verdict === 'same') return { result: 'confirmed', confidence: 0.9, notes: `[Claude] ${read.note}` }
  if (read.verdict === 'conflicting') return { result: 'warning', confidence: 0.6, notes: `[Claude] The outlets differ: ${read.note}` }
  // "Different event" contradicts the story's Verified badge: it shows once it can hold a story back
  return null
}

/**
 * The verdict in the verification timeline of each report's page, once per
 * report: a story is checked again when a new outlet's report turns
 * verified, and only the reports not logged in the last 6 hours get a line.
 */
async function logOnSignalPages(storyIds: string[], read: { verdict: CrossCheckVerdict; note: string }): Promise<void> {
  const entry = timelineEntry(read)
  if (!entry) return
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

/** Fire and forget: a failed cross-check never holds up the pipeline */
export function crossCheckLater(storyIds: string[], extra: CrossCheckReport[] = []): void {
  crossCheckVerification(storyIds, extra).catch(err => logger.warn({ err }, 'Cross-check failed (non-fatal)'))
}
