/**
 * The "Verified · 12 outlets" card other sites can embed (plan G20; Devon,
 * Oct 20, 2026: "only to each post, I don't want this to take up too much
 * space on the home screen"). It is offered on each story's page only, under
 * Share. world-pulse.io/embed/story/<id> shows the report's headline, how many
 * outlets (websites) carry its story and whether it is verified, as the story
 * page counts them (GET /api/v1/stories/:id), a few of those outlets, and a
 * link back to the story's page.
 *
 * Nothing here reaches the server, so the Share menu can build the code too.
 */

import { SITE_URL } from '@/lib/page-metadata'

/** How many outlets the card names; the rest are "and N more" */
export const OUTLETS_NAMED = 3
/** The frame's height in the code we hand out (the card fits it at 300 px wide and more) */
export const CARD_HEIGHT = 210

export type CardTheme = 'light' | 'dark'

export interface StoryCard {
  /** The report the card is for: its page is /signals/<id> */
  id: string
  title: string
  /** Websites that carried the story */
  outlets: number
  verified: boolean
  /** Up to OUTLETS_NAMED of them: this report's own first, then the most reliable reports' */
  named: string[]
  /** The story's newest report (ISO) */
  updatedAt: string | null
}

export type StoryCardResult = StoryCard | 'missing' | 'unavailable'

/** One report of the story, as GET /api/v1/stories/:id lists it */
interface StoryReport {
  id?: unknown
  title?: unknown
  outlet?: unknown
  reliabilityScore?: unknown
  createdAt?: unknown
}

/** GET /api/v1/stories/:id's data */
export interface StoryAnswer {
  outlets?: unknown
  outletNames?: unknown
  verifiedAt?: unknown
  signals?: unknown
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isStoryId(id: string): boolean {
  return UUID_RE.test(id)
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** The card for report `id`, from its story's answer; null when the answer has no reports */
export function cardFromStory(id: string, data: StoryAnswer): StoryCard | null {
  const reports = (Array.isArray(data.signals) ? data.signals : []) as StoryReport[]
  if (reports.length === 0) return null
  const own = reports.find(r => text(r.id) === id) ?? reports[0]!
  const title = text(own.title)
  if (!title) return null

  // This report's outlet first, then the outlets of the most reliable reports
  const byReliability = [...reports].sort((a, b) => (Number(b.reliabilityScore) || 0) - (Number(a.reliabilityScore) || 0))
  const named: string[] = []
  for (const r of [own, ...byReliability]) {
    const outlet = text(r.outlet)
    if (outlet && !named.includes(outlet)) named.push(outlet)
    if (named.length >= OUTLETS_NAMED) break
  }

  const listed = Array.isArray(data.outletNames) ? data.outletNames.length : 0
  const outlets = Math.max(Number(data.outlets) || 0, listed, named.length)
  const times = reports.map(r => text(r.createdAt)).filter(t => !Number.isNaN(Date.parse(t))).sort()
  return {
    id: text(own.id) || id,
    title,
    outlets,
    verified: typeof data.verifiedAt === 'string' && data.verifiedAt !== '',
    named,
    updatedAt: times.length ? times[times.length - 1]! : null,
  }
}

/** "✓ Verified · 12 outlets", "2 outlets", "1 outlet", as the site's story lists say it */
export function countLine(card: Pick<StoryCard, 'outlets' | 'verified'>): string {
  const n = `${card.outlets} outlet${card.outlets === 1 ? '' : 's'}`
  return card.verified ? `✓ Verified · ${n}` : n
}

/** "Only bbc.co.uk so far", "bbc.co.uk and dw.com", "bbc.co.uk, dw.com, cbsnews.com and 109 more" */
export function outletsLine(card: Pick<StoryCard, 'outlets' | 'named'>): string {
  const { named, outlets } = card
  if (named.length === 0) return ''
  if (outlets <= 1) return `Only ${named[0]} so far`
  const more = outlets - named.length
  if (more > 0) return `${named.join(', ')} and ${more} more`
  if (named.length === 1) return named[0]!
  return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`
}

/** "Updated Oct 20, 17:13 UTC" */
export function updatedLine(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `Updated ${month} ${d.getUTCDate()}, ${hh}:${mm} UTC`
}

/** The story's page, tagged as a visit from an embedded card */
export function cardLink(id: string): string {
  return `${SITE_URL}/signals/${encodeURIComponent(id)}?utm_source=embed&utm_medium=card&utm_campaign=story`
}

/** The card's own address */
export function cardUrl(origin: string, id: string, theme: CardTheme): string {
  return `${origin}/embed/story/${encodeURIComponent(id)}${theme === 'dark' ? '?theme=dark' : ''}`
}

const attr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The code to paste into a page */
export function storyEmbedCode(origin: string, id: string, title: string, theme: CardTheme): string {
  const name = title.replace(/\s+/g, ' ').trim().slice(0, 120)
  return `<iframe src="${attr(cardUrl(origin, id, theme))}" width="100%" height="${CARD_HEIGHT}" style="max-width:560px;border:0;border-radius:12px" loading="lazy" title="${attr(`${name} · WorldPulse`)}"></iframe>`
}

/**
 * The frame's page around the card: see-through, so the host page shows at the
 * card's rounded corners (the site's dark page showed there, Oct 20, 2026), and
 * in the card's own colour scheme (browsers paint a frame opaque when its
 * scheme differs from the host page's), without the site's noise layer
 */
export function cardPageStyle(theme: CardTheme): string {
  return `html, body { background: transparent !important; } body::before { display: none !important; } :root { color-scheme: ${theme === 'dark' ? 'dark' : 'light'}; }`
}
