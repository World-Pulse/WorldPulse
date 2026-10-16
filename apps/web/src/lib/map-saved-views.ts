/**
 * Saved map views (plan C10, v1): a reader's own named shortcuts, such as
 * "Sahel watch" or "Red Sea shipping". A view is the map's address (the
 * filters in the query, the position and layers in the #hash), so opening
 * one restores exactly what a shared link would. Kept in this browser only.
 */

export const SAVED_VIEWS_KEY = 'wp_map_saved_views'
export const MAX_SAVED_VIEWS = 12
export const MAX_NAME_LENGTH = 40

export interface SavedView {
  id: string
  name: string
  /** Path, query and hash of /map, never another site */
  href: string
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Only addresses on the map itself are kept, so a tampered entry can't send anyone elsewhere */
export function isMapHref(href: unknown): href is string {
  return typeof href === 'string' && /^\/map(?:[?#]|$)/.test(href) && !href.includes('\n')
}

export function readSavedViews(storage: StorageLike | null | undefined): SavedView[] {
  try {
    const parsed = JSON.parse(storage?.getItem(SAVED_VIEWS_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((v): v is SavedView =>
        !!v && typeof v.id === 'string' && typeof v.name === 'string' && v.name.trim() !== '' && isMapHref(v.href))
      .slice(0, MAX_SAVED_VIEWS)
  } catch {
    return []
  }
}

export function writeSavedViews(storage: StorageLike | null | undefined, views: SavedView[]): void {
  try { storage?.setItem(SAVED_VIEWS_KEY, JSON.stringify(views.slice(0, MAX_SAVED_VIEWS))) } catch { /* private mode, blocked storage */ }
}

/** Adds a view (newest first). The same name replaces the old one; null if the name or address is unusable */
export function addSavedView(views: SavedView[], name: string, href: string, now = Date.now()): SavedView[] | null {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
  if (!clean || !isMapHref(href)) return null
  const rest = views.filter(v => v.name.toLowerCase() !== clean.toLowerCase())
  return [{ id: `v${now.toString(36)}`, name: clean, href }, ...rest].slice(0, MAX_SAVED_VIEWS)
}

export function removeSavedView(views: SavedView[], id: string): SavedView[] {
  return views.filter(v => v.id !== id)
}
