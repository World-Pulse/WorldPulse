/**
 * Fact-checks beside verified stories (Nov 11, 2026; Devon, Nov 10: "Set this up, what is the process").
 *
 * The scraper reads fact-checkers' feeds (apps/scraper/src/sources/fact-checks.ts: PolitiFact, FactCheck.org,
 * Full Fact) into Redis, each check with its fingerprint. A check is about a story when both hold:
 *   • by meaning: its fingerprint is close to the story's (the average of its reports' fingerprints), 0.55 or more
 *   • by words: two or more words of the check's headline are in two or more of the story's report headlines,
 *     leaving out everyday news and fact-check words ("Trump", "election", "viral", "fake", "video"...)
 * and it was published between 3 days before the story's first report and 30 days after its latest.
 *
 * Tried on Nov 11, 2026 against 64 of the week's top stories and the 40 checks in the three feeds: the two checks
 * of claims about the Florida jet crash (Full Fact's and PolitiFact's) found that story, and nothing else
 * matched. Meaning alone isn't enough: FactCheck.org's "FactChecking Trump's Post-Election '60 Minutes'
 * Interview" came closer by meaning (0.68) to a story of midterm predictions than the jet crash checks did to
 * theirs (0.67 and 0.60), and the two share no headline word that isn't everyday election news.
 *
 * WorldPulse never rules on a claim: a match shows the checker's own headline, claim and rating, credited and
 * linked, and a check never counts as an outlet that carried the story.
 */

import { redis } from '../db/redis'
import { FINGERPRINT_DIMS, FINGERPRINT_MODEL } from './fingerprint'

export const FACT_CHECKS_KEY = 'factchecks:items'
export const MATCH_MIN_SCORE = 0.55
export const MATCH_MIN_SHARED = 2
export const MATCH_MAX = 3
const BEFORE_MS = 3 * 86_400_000
const AFTER_MS = 30 * 86_400_000
const CACHE_MS = 5 * 60_000

/** The fact-checkers the scraper reads, credited by name and site */
export const CHECKER_SITES: Record<string, { name: string; url: string }> = {
  politifact: { name: 'PolitiFact', url: 'https://www.politifact.com' },
  'factcheck-org': { name: 'FactCheck.org', url: 'https://www.factcheck.org' },
  'full-fact': { name: 'Full Fact', url: 'https://fullfact.org' },
}

/** As the scraper keeps them */
export interface StoredFactCheck {
  id: string
  checker: string
  name: string
  title: string
  url: string
  published: string
  claim: string | null
  rating: string | null
  summary: string | null
  language: string
  model: string | null
  vec: string | null
}

export interface StoredCheckerStatus { id: string; name: string; ok: boolean; read_at: string; items: number; error?: string }
export interface StoredFactChecks { updated_at: string; checkers: StoredCheckerStatus[]; items: StoredFactCheck[] }

/** A check as shown: the checker's own words, with its name, site and link */
export interface FactCheck {
  checker: string
  checkerUrl: string | null
  title: string
  url: string
  published: string
  claim: string | null
  rating: string | null
  summary: string | null
}

export interface FactCheckMatch extends FactCheck {
  /** How close it is to the story by meaning (0 to 1) */
  score: number
  /** The headline words it shares with the story's reports */
  shared: string[]
}

export interface LoadedFactCheck { check: StoredFactCheck; vector: Float32Array | null }
export interface LoadedFactChecks { updatedAt: string; checkers: StoredCheckerStatus[]; items: LoadedFactCheck[] }

/** A fingerprint from the scraper's base64 (Float32), or null */
export function decodeVec(b64: string | null | undefined): Float32Array | null {
  if (!b64) return null
  try {
    const buf = Buffer.from(b64, 'base64')
    if (buf.byteLength !== FINGERPRINT_DIMS * 4) return null
    // (a copy: the buffer's offset in Node's pool needn't be a multiple of 4)
    return new Float32Array(Uint8Array.from(buf).buffer)
  } catch {
    return null
  }
}

/** pgvector's text form, "[0.1,-0.2,...]", as numbers; null when it isn't one */
export function parseVectorText(text: unknown): Float32Array | null {
  if (typeof text !== 'string' || !text.startsWith('[')) return null
  const parts = text.slice(1, -1).split(',')
  if (parts.length !== FINGERPRINT_DIMS) return null
  const v = new Float32Array(parts.length)
  for (let i = 0; i < parts.length; i++) {
    const x = Number(parts[i])
    if (!Number.isFinite(x)) return null
    v[i] = x
  }
  return v
}

/** Everyday words of news, fact-checks and US and UK politics: too common to tie a check to one story */
const EVERYDAY = new Set((
  'the and for but nor not are was were been being has have had its this that these those than then there their they them ' +
  'what why how who whom when where which while with without within into onto from over under about after before during since until ' +
  'amid among against between despite also just still even only very more most less least much many some any all each every ' +
  'can could will would should may might must shall does did done doing don isn wasn aren weren hasn haven hadn won didn doesn ' +
  'says said say saying tells told claims claim claimed claiming fact facts factcheck factchecking checked checking check checks ' +
  'false falsely fake faked hoax real true truth misleading misleads mislead wrong untrue baseless evidence viral video videos ' +
  'image images photo photos picture pictures footage clip clips post posts posted shared sharing share online social media ' +
  'generated show shows shown showing new news latest after report reports reported people year years day days week weeks ' +
  'month months time first last one two three four five million billion percent per trump biden obama president government ' +
  'minister prime election elections midterm midterms vote votes voters voting campaign ads senate house congress democrat ' +
  'democrats democratic republican republicans gop party parties state states national federal official officials world ' +
  'country countries american americans british explaining explained explainer'
).split(/\s+/))

/** A headline's words that can tie it to a story: 3 letters or more, not everyday, not a year; plurals as singulars */
export function contentWords(text: string): string[] {
  return text.toLowerCase()
    .normalize('NFKC')
    .replace(/[’']s\b/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w.length >= 3 && !EVERYDAY.has(w) && !/^(?:19|20)\d\d$/.test(w))
    .map(w => (w.length > 4 && /[^s]s$/.test(w) ? w.slice(0, -1) : w))
}

export interface StoryText {
  /** The average of its reports' fingerprints (any length), or null when none has one */
  centroid: Float32Array | null
  /** Its reports' headlines */
  titles: string[]
  /** Its first and latest report (ms) */
  firstAt: number
  latestAt: number
}

/** The checks about a story, closest first (see the top of this file) */
export function matchFactChecks(
  story: StoryText,
  items: readonly LoadedFactCheck[],
  opts: { minScore?: number; minShared?: number; max?: number } = {},
): FactCheckMatch[] {
  const { centroid, titles } = story
  if (!centroid || titles.length === 0) return []
  let norm = 0
  for (const x of centroid) norm += x * x
  norm = Math.sqrt(norm)
  if (!norm) return []
  // in how many of the story's headlines each word is
  const inTitles = new Map<string, number>()
  for (const t of titles) for (const w of new Set(contentWords(t))) inTitles.set(w, (inTitles.get(w) ?? 0) + 1)
  const need = Math.min(2, titles.length)
  const out: FactCheckMatch[] = []
  for (const { check, vector } of items) {
    if (!vector || vector.length !== centroid.length) continue
    const at = Date.parse(check.published)
    if (Number.isNaN(at) || at < story.firstAt - BEFORE_MS || at > story.latestAt + AFTER_MS) continue
    let dot = 0
    for (let i = 0; i < vector.length; i++) dot += vector[i]! * centroid[i]!
    const score = dot / norm
    if (score < (opts.minScore ?? MATCH_MIN_SCORE)) continue
    const shared = [...new Set(contentWords(check.title))].filter(w => (inTitles.get(w) ?? 0) >= need)
    if (shared.length < (opts.minShared ?? MATCH_MIN_SHARED)) continue
    out.push({ ...shown(check), score: Math.round(score * 1000) / 1000, shared })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, opts.max ?? MATCH_MAX)
}

/** A check as shown */
export function shown(check: StoredFactCheck): FactCheck {
  return {
    checker: check.name,
    checkerUrl: CHECKER_SITES[check.checker]?.url ?? null,
    title: check.title,
    url: check.url,
    published: check.published,
    claim: check.claim,
    rating: check.rating,
    summary: check.summary,
  }
}

let kept: { at: number; value: LoadedFactChecks | null } | null = null

/** The scraper's checks with their fingerprints read, kept 5 minutes; null before the scraper's first read */
export async function loadFactChecks(now = Date.now()): Promise<LoadedFactChecks | null> {
  if (kept && now - kept.at < CACHE_MS) return kept.value
  let value: LoadedFactChecks | null = null
  try {
    const raw = await redis.get(FACT_CHECKS_KEY)
    const snap = raw ? (JSON.parse(raw) as StoredFactChecks) : null
    if (snap && Array.isArray(snap.items)) {
      value = {
        updatedAt: snap.updated_at,
        checkers: Array.isArray(snap.checkers) ? snap.checkers : [],
        items: snap.items.map(check => ({ check, vector: check.model === FINGERPRINT_MODEL ? decodeVec(check.vec) : null })),
      }
    }
  } catch {
    value = null
  }
  kept = { at: now, value }
  return value
}

/** For tests: forget the kept checks */
export function resetFactChecks(): void {
  kept = null
}
