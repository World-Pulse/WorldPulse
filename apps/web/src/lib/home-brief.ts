/**
 * The home page's first block for the 7 AM reader (plan N6, Oct 30, 2026):
 * what changed and what to watch, in one line each, from the Daily Briefing
 * (GET /api/v1/briefing/structured: its executive summary and its "What to
 * Watch" section). The API keeps each briefing 4 hours; here it is read from
 * the website's server, kept 10 minutes, and never waited on for more than
 * 2.5 seconds: the home page doesn't hang on it, and its visitors make at most
 * one call per 10 minutes, so no more briefings get written than the API's own
 * keep allows.
 */
import { cachedFetch } from '@/lib/server-fetch'

export interface HomeBrief {
  /** The briefing's lead: the most important thing that happened, one sentence */
  changed: string | null
  /** One thing to watch, from its "What to Watch" section */
  watch: string | null
}

const NONE: HomeBrief = { changed: null, watch: null }

/** How long the brief is kept, and how long a failed read is not retried */
const KEEP_MS = 600_000
const RETRY_MS = 120_000
/** One read waits at most this long */
const WAIT_MS = 2_500
/** The longest line shown */
const MAX_CHARS = 280

/** Titles and abbreviations whose full stop doesn't end a sentence ("Dr. Tedros", "U.S. Senate") */
const ABBREVIATION = /(?:^|[\s(])(?:Mr|Mrs|Ms|Dr|St|Gen|Lt|Col|Sgt|Capt|Sen|Rep|Gov|Pres|Prof|No|Jr|Sr|vs|U\.S|U\.K|U\.N|E\.U)\.$/

/** The first sentence of a text: up to a full stop, question or exclamation mark followed by a capital */
export function firstSentence(text: unknown): string | null {
  const s = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  if (!s) return null
  const end = /[.!?](?=\s+["“‘(]?\p{Lu})/gu
  for (const m of s.matchAll(end)) {
    const upTo = s.slice(0, (m.index ?? 0) + 1)
    if (!ABBREVIATION.test(upTo)) return upTo.trim()
  }
  return s
}

/** At most MAX_CHARS, cut at a word with "…" */
export function clip(text: string, max = MAX_CHARS): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/, '')}…`
}

/** Sentences that say there is nothing to watch */
const NOTHING = /\b(?:no|not|nothing)\b[^.]*\bscheduled\b|\bdo not describe any\b|\bnothing to watch\b/i

/** The two lines from a structured briefing (the API's answer); nulls for anything missing */
export function briefOf(briefing: unknown): HomeBrief {
  if (!briefing || typeof briefing !== 'object') return NONE
  const b = briefing as { executive_summary?: unknown; sections?: unknown }
  const lead = firstSentence(b.executive_summary)
  const sections = Array.isArray(b.sections) ? b.sections : []
  const watchSection = sections.find((x): x is { id?: unknown; body?: unknown } => !!x && typeof x === 'object' && (x as { id?: unknown }).id === 'what_to_watch')
  const body = typeof watchSection?.body === 'string' ? watchSection.body : ''
  // The first sentence of "What to Watch" that names something to watch
  let watch: string | null = null
  let rest = body.replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 4 && rest; i++) {
    const sentence = firstSentence(rest)
    if (!sentence) break
    if (!NOTHING.test(sentence)) { watch = sentence; break }
    rest = rest.slice(sentence.length).trim()
  }
  return { changed: lead ? clip(lead) : null, watch: watch ? clip(watch) : null }
}

let failedAt = 0

/** The home page's two lines, kept 10 minutes; nulls when the briefing doesn't answer in time */
export async function fetchHomeBrief(apiBase: string, now = Date.now()): Promise<HomeBrief> {
  if (failedAt && now - failedAt < RETRY_MS) return NONE
  try {
    const res = await cachedFetch(`${apiBase}/api/v1/briefing/structured`, KEEP_MS, WAIT_MS)
    if (!res.ok) { failedAt = now; return NONE }
    return briefOf(await res.json())
  } catch {
    failedAt = now
    return NONE
  }
}
