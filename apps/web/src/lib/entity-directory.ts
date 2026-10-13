/**
 * Who's in the news (Oct 13, 2026): the people, places and organizations
 * named in the most reports in the last 7 days, from
 * GET /api/v1/knowledge-graph/directory (apps/api/src/lib/entity-directory.ts).
 * Read by world-pulse.io/entities and its share picture.
 */

const API_BASE = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'https://api.world-pulse.io'

export interface DirectoryEntity {
  id: string
  type: string
  name: string
  last24h: number
  last7d: number
  previous7d: number
  /** how many times more than the 7 days before; null with fewer than 3 reports before */
  change: number | null
}

export interface DirectoryGroup {
  key: 'people' | 'places' | 'organisations' | 'more'
  label: string
  entities: DirectoryEntity[]
}

export interface EntityDirectory {
  groups: DirectoryGroup[]
  total: number
  generatedAt: string
}

/** The directory, or null when the API didn't answer (the page then fails rather than show an empty list) */
export async function fetchDirectory(): Promise<EntityDirectory | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/knowledge-graph/directory`, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const json = await res.json() as { success?: boolean; data?: EntityDirectory }
    return json.success && json.data && Array.isArray(json.data.groups) ? json.data : null
  } catch {
    return null
  }
}

/** "Oct 6 – 13" or "Sep 30 – Oct 6": the 7 days ending at `iso` (UTC) */
export function weekRange(iso: string): string {
  const end = new Date(Number.isFinite(Date.parse(iso)) ? iso : Date.now())
  const start = new Date(end.getTime() - 7 * 86_400_000)
  const month = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  const day = (d: Date) => d.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'UTC' })
  return month(start) === month(end)
    ? `${month(start)} ${day(start)} – ${day(end)}`
    : `${month(start)} ${day(start)} – ${month(end)} ${day(end)}`
}
