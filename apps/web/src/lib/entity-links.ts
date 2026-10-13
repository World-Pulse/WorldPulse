/**
 * Addresses of entity pages (Oct 13, 2026): world-pulse.io/entities/<name>-<id>,
 * e.g. /entities/houthis-5f2c9a1b3d4e6f70. The name is for people and search
 * engines; the id after the last dash is what the page looks up, so a renamed
 * entity's old links still work (the page redirects them to its current name).
 */

/** "Médecins Sans Frontières" → "medecins-sans-frontieres"; "" when no Latin letters or digits are left */
export function entitySlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
}

/** The page's path for an entity */
export function entityPath(id: string, name: string): string {
  const slug = entitySlug(name)
  return `/entities/${slug ? `${slug}-` : ''}${encodeURIComponent(id)}`
}

const ID = /^[A-Za-z0-9_]{4,64}$/

/** The entity id in a page address segment, or null when there isn't one */
export function entityIdFromSlug(segment: string): string | null {
  let s = segment
  try { s = decodeURIComponent(segment) } catch { /* keep as is */ }
  const id = s.slice(s.lastIndexOf('-') + 1)
  return ID.test(id) ? id : null
}

const TYPE_LABEL: Record<string, string> = {
  person: 'Person', organisation: 'Organization', location: 'Place', event: 'Event',
  weapon_system: 'Weapon system', legislation: 'Law', commodity: 'Commodity', technology: 'Technology',
}
const TYPE_ICON: Record<string, string> = {
  person: '👤', organisation: '🏛', location: '📍', event: '📅',
  weapon_system: '🛡', legislation: '📜', commodity: '📦', technology: '💻',
}

export const entityTypeLabel = (type: string): string => TYPE_LABEL[type] ?? 'Entity'
export const entityTypeIcon = (type: string): string => TYPE_ICON[type] ?? '🔹'
