/**
 * Plain links at the foot of a story page (Oct 19, 2026, plan G16 slice 4): the
 * story's country page and the pages of the people, places and organisations
 * it names. The page's own entity panel loads in the browser, so a search
 * engine saw no link from a story to anything else.
 */
import { entityPath } from '@/lib/entity-links'
import { countryLabel } from '@/lib/country-connections'
import { isoWeekName, weekSpan, weekStart } from '@/lib/week'

export interface StoryLink {
  href:  string
  label: string
}

export interface StoryLinks {
  country:  StoryLink | null
  entities: StoryLink[]
}

/** The country page for a code like "sd" or "SD"; null when it isn't a two-letter code */
export function countryLink(code: string | null | undefined): StoryLink | null {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return null
  const upper = code.toUpperCase()
  return { href: `/countries/${upper}`, label: countryLabel(upper) || upper }
}

/**
 * The "WorldPulse Week" a story's first report fell in (G21, Oct 20, 2026):
 * /week while that week is under way, /week/<YYYY>-W<ww> once it has ended.
 * Story pages linked to no week, so search engines reached the weeks only
 * from the sitemap.
 */
export function weekLink(at: string | null | undefined, now: Date = new Date()): StoryLink | null {
  if (!at) return null
  const when = new Date(at)
  if (Number.isNaN(when.getTime()) || when.getTime() > now.getTime() + 60_000) return null
  const name = isoWeekName(when)
  const start = weekStart(name)
  if (!start) return null
  if (name === isoWeekName(now)) return { href: '/week', label: `this week (${weekSpan(start)})` }
  return { href: `/week/${name}`, label: weekSpan(start) }
}

/** Up to `max` entity pages, one per entity, skipping entries without an id or name */
export function entityLinks(
  entities: Array<{ id?: unknown; name?: unknown }> | null | undefined,
  max = 6,
): StoryLink[] {
  const seen = new Set<string>()
  const links: StoryLink[] = []
  for (const e of entities ?? []) {
    if (typeof e.id !== 'string' || typeof e.name !== 'string') continue
    const name = e.name.trim()
    if (!e.id || !name || seen.has(e.id)) continue
    seen.add(e.id)
    links.push({ href: entityPath(e.id, name), label: name })
    if (links.length >= max) break
  }
  return links
}
