/**
 * The home page's "Developing Stories": the stories most outlets are reporting
 * right now, from GET /api/v1/stories (plan item 12e). Until Oct 11, 2026 the
 * block read event threads, which put a death-row case ("ESCALATING · 3,247
 * signals"), an F1 sprint and an op-ed marked "critical" at the top.
 */

export interface DevelopingStory {
  /** The story's id */
  id: string
  /** The signal to open: its page lists every outlet's report */
  leadId: string
  title: string
  place: string | null
  severity: string
  /** Signals in the story */
  size: number
  /** Websites that reported it (the API sends at most 12 names) */
  outlets: string[]
  /** How many websites reported it */
  outletCount: number
  firstSeenAt: string
  updatedAt: string
  verifiedAt: string | null
}

/** Stories from a GET /api/v1/stories answer; anything malformed is left out */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toDevelopingStories(json: any): DevelopingStory[] {
  const list = json?.data?.stories
  if (!Array.isArray(list)) return []
  const out: DevelopingStory[] = []
  for (const s of list) {
    if (!s || typeof s.id !== 'string' || typeof s.leadId !== 'string' || typeof s.title !== 'string' || s.title.trim() === '') continue
    const outlets = Array.isArray(s.outlets) ? s.outlets.filter((o: unknown): o is string => typeof o === 'string' && o !== '') : []
    const count = Number(s.outletCount)
    out.push({
      id:          s.id,
      leadId:      s.leadId,
      title:       s.title.trim(),
      place:       typeof s.place === 'string' && s.place.trim() !== '' ? s.place.trim() : null,
      severity:    typeof s.severity === 'string' ? s.severity : 'info',
      size:        Number(s.size) > 0 ? Number(s.size) : 1,
      outlets,
      outletCount: Number.isFinite(count) && count >= outlets.length ? count : outlets.length,
      firstSeenAt: typeof s.firstSeenAt === 'string' ? s.firstSeenAt : '',
      updatedAt:   typeof s.updatedAt === 'string' ? s.updatedAt : '',
      verifiedAt:  typeof s.verifiedAt === 'string' ? s.verifiedAt : null,
    })
  }
  return out
}

/** "just now", "12m ago", "3h ago", "2d ago" ("" for a missing time) */
export function sinceLabel(iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const minutes = Math.floor(Math.max(0, now - t) / 60_000)
  if (minutes < 2) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** The badge: "✓ Verified · 12 outlets" or "4 outlets" */
export function outletBadge(story: Pick<DevelopingStory, 'outletCount' | 'verifiedAt'>): { label: string; verified: boolean } {
  const n = story.outletCount
  const outlets = `${n} outlet${n === 1 ? '' : 's'}`
  return story.verifiedAt ? { label: `✓ Verified · ${outlets}`, verified: true } : { label: outlets, verified: false }
}

/** The outlets named on a row, and how many more reported it */
export function namedOutlets(story: Pick<DevelopingStory, 'outlets' | 'outletCount'>, shown = 3): { names: string[]; more: number } {
  const names = story.outlets.slice(0, shown)
  return { names, more: Math.max(0, story.outletCount - names.length) }
}

/**
 * The outlets line's hover text: the names the API sent (at most 12) and how
 * many more there are, so it doesn't read as the full list. The story's page
 * lists them all.
 */
export function outletsTitle(story: Pick<DevelopingStory, 'outlets' | 'outletCount'>): string {
  const more = story.outletCount - story.outlets.length
  const names = story.outlets.join(', ')
  return more > 0 ? `${names} and ${more} more (all on the story's page)` : names
}

/** Severities worth a label on the row (medium and low are the norm) */
export const LOUD_SEVERITIES = new Set(['critical', 'high'])
