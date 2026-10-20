/**
 * The stories many outlets are reporting right now, for the home page's
 * "Developing Stories" block (plan item 12e). A story is the signals the
 * scraper's same-story rule linked (signals.story_id), or one signal whose
 * links come from several outlets.
 *
 * Until Oct 11, 2026 that block read event threads, which put a death-row case
 * ("ESCALATING · 3,247 signals"), an F1 sprint, an op-ed marked "critical" and
 * a bridal-craft story filed under conflict at the top, every one with 0 sources.
 */

import { outletsOf } from './stories'

/** One story as the list query returns it (see routes/stories.ts) */
export interface StoryCandidate {
  /** The story's id: the id of its first signal (or the signal's own id) */
  key: string
  /** The member a reader opens: a recent, reliable one with a real headline */
  leadId: string
  title: string
  category: string | null
  /** The place most members are pinned to */
  place: string | null
  /** The highest severity among members */
  severity: string
  /** Signals in the story */
  size: number
  /** Every member's article links */
  urls: string[]
  /**
   * The links of the members reported in the story's counted window (its last
   * STORY_COUNT_HOURS, lib/story-window.ts); all of them for a week's page.
   * Missing: every link counts
   */
  recentUrls?: string[]
  firstSeenAt: Date
  /** Its newest signal */
  updatedAt: Date
  /** When it first turned verified */
  verifiedAt: Date | null
}

export interface ListedStory {
  id: string
  leadId: string
  title: string
  category: string | null
  place: string | null
  severity: string
  size: number
  /** Websites that reported it, at most OUTLETS_LISTED, those of its most reliable signals first */
  outlets: string[]
  /** How many websites reported it in its last two days (lib/story-window.ts) */
  outletCount: number
  /** How many websites reported it since it began */
  outletCountAll: number
  firstSeenAt: string
  updatedAt: string
  verifiedAt: string | null
}

/** Outlet names sent per story (the count covers all of them) */
export const OUTLETS_LISTED = 12

/** Outlets beyond this don't raise a story's rank further */
const MAX_COUNTED_OUTLETS = 30

const SEVERITY_WEIGHT: Record<string, number> = { critical: 3, high: 2, medium: 1.3, low: 1 }

/** A story's rank halves for every this many hours since its newest report */
export const HALF_LIFE_HOURS = 6

/**
 * How high a story ranks: how many outlets report it (square root, so a story
 * every outlet copies doesn't bury a serious one fewer have reached yet),
 * weighted by how serious it is, halving every HALF_LIFE_HOURS since it was
 * last reported.
 */
export function storyScore(outletCount: number, severity: string, updatedAt: Date, now: number): number {
  const ageHours = Math.max(0, (now - updatedAt.getTime()) / 3_600_000)
  return Math.sqrt(Math.min(outletCount, MAX_COUNTED_OUTLETS))
    * (SEVERITY_WEIGHT[severity] ?? 0.8)
    * 0.5 ** (ageHours / HALF_LIFE_HOURS)
}

/**
 * GDELT's "<event label> in <place>" titles ("Disapproval in Riyadh, Saudi
 * Arabia") say what kind of event was coded where, not which story it is.
 * Same labels as the scraper's pipeline/event-titles.ts.
 */
const EVENT_LABELS = [
  'Public statement', 'Appeal', 'Intent to cooperate', 'Consultation', 'Diplomatic cooperation',
  'Material cooperation', 'Humanitarian aid', 'Concession', 'Investigation', 'Demand', 'Disapproval',
  'Rejection', 'Threat', 'Protest', 'Military show of force', 'Diplomatic reduction', 'Coercion',
  'Assault', 'Armed conflict', 'Mass atrocity',
]
const TEMPLATE_START = new RegExp(`^(?:${EVENT_LABELS.join('|')}|CAMEO-\\d+)(?: in |$)`)

/** The same test for Postgres (`title ~ ?`), used to pick a real headline as the lead */
export const EVENT_TEMPLATE_SQL = `^(${EVENT_LABELS.join('|')}|CAMEO-[0-9]+)( in |$)`

export function looksLikeEventTemplate(title: string): boolean {
  return TEMPLATE_START.test(title.trim())
}

/** A headline without a trailing " | Site name" ("… tiger enclosure | LBC") */
export function tidyHeadline(title: string): string {
  const t = title.trim()
  const cut = t.replace(/\s+\|\s+[^|]{1,40}$/, '')
  return cut.length >= 20 ? cut : t
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'from', 'with', 'after', 'over', 'into', 'are', 'was', 'were', 'been', 'has', 'have',
  'had', 'its', 'his', 'her', 'their', 'this', 'that', 'says', 'said', 'say', 'new', 'get', 'gets', 'will',
  'would', 'could', 'should', 'can', 'may', 'not', 'more', 'than', 'out', 'about', 'amid', 'against',
  'under', 'how', 'why', 'what', 'who', 'when', 'where', 'live', 'news', 'update', 'updates', 'report',
  'reports', 'video', 'watch', 'breaking', 'latest', 'least', 'one', 'two', 'three',
])

/** A word without its common endings, so "killed", "kills" and "killing" match */
export function stem(word: string): string {
  let w = word
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3)
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2)
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1)
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1)
  return w
}

/** The words of a headline that say what it's about */
export function headlineWords(title: string): Set<string> {
  const words = title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+/g) ?? []
  const out = new Set<string>()
  for (const w of words) {
    if (STOP_WORDS.has(w)) continue
    if (/^\d+$/.test(w) ? w.length < 2 : w.length < 3) continue
    out.add(stem(w))
  }
  return out
}

/** A place's first part ("kharkiv" for "Kharkiv, Ukraine") */
function placeHead(place: string): string {
  return place.toLowerCase().split(',')[0]!.trim()
}

/** Whether a headline names a place ("Pennsylvania mass shooting…" names "Pennsylvania") */
function names(title: string, place: string): boolean {
  const head = placeHead(place)
  if (head.length < 3) return false
  return new RegExp(`(^|[^a-z])${head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z])`).test(title.toLowerCase())
}

/**
 * Whether two stories' places can be the same: either is unknown, one names
 * the other's first part ("Riyadh" and "Riyadh, Saudi Arabia"), or one's
 * headline names the other's place (a story pinned to "Erie" headlined
 * "Pennsylvania mass shooting…" and one pinned to "Pennsylvania").
 */
function samePlace(a: { title: string; place: string | null }, b: { title: string; place: string | null }): boolean {
  if (!a.place || !b.place) return true
  const pa = a.place.toLowerCase()
  const pb = b.place.toLowerCase()
  const headA = placeHead(a.place)
  const headB = placeHead(b.place)
  return headA === headB || pa.includes(headB) || pb.includes(headA) || names(a.title, b.place) || names(b.title, a.place)
}

/**
 * Whether two stories report the same event: their headlines share at least
 * three words that say what it's about (two-fifths of the shorter one's) and
 * their places can agree. The scraper sometimes files one event as several
 * stories ("Twelve killed and 300 injured in attack on airport in Saudi
 * capital Riyadh", "At least 12 dead in Riyadh airport attack"); strikes on
 * two different cities share words but not places, so they stay apart.
 */
export function sameEvent(a: { title: string; place: string | null }, b: { title: string; place: string | null }): boolean {
  const wa = headlineWords(a.title)
  const wb = headlineWords(b.title)
  const smaller = Math.min(wa.size, wb.size)
  if (smaller === 0) return false
  let shared = 0
  for (const w of wa) if (wb.has(w)) shared++
  return shared >= 3 && shared / smaller >= 0.4 && samePlace(a, b)
}

/**
 * The stories to show: those at least two outlets report, with a real
 * headline, highest rank first, each event once (the best-ranked of its
 * stories), at most `limit`.
 */
/**
 * `decay: false` ranks by outlets and severity only, for a finished stretch of
 * time (a week's top stories: one from Monday counts as much as one from Sunday)
 */
export function rankStories(candidates: StoryCandidate[], limit: number, now = Date.now(), opts: { decay?: boolean } = {}): ListedStory[] {
  const scored: Array<{ story: ListedStory; score: number }> = []
  for (const c of candidates) {
    if (!c.title || looksLikeEventTemplate(c.title)) continue
    // (every outlet of the story's last two days, so the count matches the
    // story's page, GET /stories/:id; lib/story-window.ts)
    const outlets = outletsOf(c.recentUrls && c.recentUrls.length > 0 ? c.recentUrls : c.urls, 1000)
    if (outlets.length < 2) continue
    const outletCountAll = Math.max(outletsOf(c.urls, 1000).length, outlets.length)
    scored.push({
      score: storyScore(outlets.length, c.severity, opts.decay === false ? new Date(now) : c.updatedAt, now),
      story: {
        id:          c.key,
        leadId:      c.leadId,
        title:       tidyHeadline(c.title),
        category:    c.category,
        place:       c.place,
        severity:    c.severity,
        size:        c.size,
        outlets:     outlets.slice(0, OUTLETS_LISTED),
        outletCount: outlets.length,
        outletCountAll,
        firstSeenAt: c.firstSeenAt.toISOString(),
        updatedAt:   c.updatedAt.toISOString(),
        verifiedAt:  c.verifiedAt ? c.verifiedAt.toISOString() : null,
      },
    })
  }
  scored.sort((x, y) => y.score - x.score || y.story.updatedAt.localeCompare(x.story.updatedAt))

  const kept: ListedStory[] = []
  for (const { story } of scored) {
    if (kept.length >= limit) break
    if (kept.some(k => sameEvent(k, story))) continue
    kept.push(story)
  }
  return kept
}

/** A Postgres text[] as node-pg returns it, or its "{a,b}" text form */
export function textArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v !== '')
  if (typeof value !== 'string' || !value.startsWith('{') || !value.endsWith('}')) return []
  const inner = value.slice(1, -1)
  if (inner === '') return []
  const out: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|([^,]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(inner)) !== null) {
    const v = m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]!.trim()
    if (v !== '' && v !== 'NULL') out.push(v)
  }
  return out
}
