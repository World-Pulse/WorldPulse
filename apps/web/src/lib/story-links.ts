/**
 * Plain links at the foot of a story page (Oct 19, 2026, plan G16 slice 4): the
 * story's country page and the pages of the people, places and organisations
 * it names. The page's own entity panel loads in the browser, so a search
 * engine saw no link from a story to anything else.
 */
import { entityPath } from '@/lib/entity-links'
import { countryLabel } from '@/lib/country-connections'

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

/**
 * "Related" on a story page (Oct 19, 2026, plan G18): stories from the same
 * country first, then the same topic. A story appears once, the story itself
 * never, and at most `max` are kept.
 */
export function rankRelated<T extends { id: string; category?: string }>(
  currentId: string,
  category: string,
  sameCountry: T[],
  sameTopic: T[],
  max = 5,
): T[] {
  // within a country, the same topic comes first (the sort is stable)
  const country = sameCountry.map((s, i) => ({ s, i }))
    .sort((a, b) => Number(b.s.category === category) - Number(a.s.category === category) || a.i - b.i)
    .map(x => x.s)
  const seen = new Set<string>([currentId])
  const out: T[] = []
  for (const s of [...country, ...sameTopic]) {
    if (seen.has(s.id)) continue
    seen.add(s.id)
    out.push(s)
    if (out.length >= max) break
  }
  return out
}
