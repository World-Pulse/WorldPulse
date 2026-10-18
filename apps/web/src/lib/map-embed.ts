/**
 * The live map on other people's sites (plan G17): the address of the
 * embedded map, the iframe code to paste, and the link back to the full map.
 */

import { mapRegion } from '@/lib/map-regions'

/** What an embedded map shows, as it appears in the address */
export interface MapEmbedView {
  cat?: string
  sev?: string
  tr?: string
  region?: string
  lat?: number
  lng?: number
  z?: number
}

function query(view: MapEmbedView, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams()
  if (view.cat && view.cat !== 'all') p.set('cat', view.cat)
  if (view.sev && view.sev !== 'all') p.set('sev', view.sev)
  if (view.tr && view.tr !== '24h') p.set('tr', view.tr)
  if (view.region && mapRegion(view.region)) p.set('region', view.region)
  if (view.lat !== undefined && view.lng !== undefined && view.z !== undefined) {
    p.set('lat', view.lat.toFixed(2))
    p.set('lng', view.lng.toFixed(2))
    p.set('z', view.z.toFixed(1))
  }
  for (const [k, v] of Object.entries(extra)) p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ''
}

/** The embedded map's address */
export function embedMapUrl(origin: string, view: MapEmbedView): string {
  return `${origin}/embed/map${query(view)}`
}

/** The code to paste into a page */
export function embedMapCode(origin: string, view: MapEmbedView): string {
  const src = embedMapUrl(origin, view).replace(/&/g, '&amp;')
  return `<iframe src="${src}" width="100%" height="480" style="border:0;border-radius:12px" loading="lazy" title="WorldPulse live map"></iframe>`
}

/** The "Live map · WorldPulse" link: the same view on the full map, tagged as coming from an embed */
export function embedBackLink(origin: string, view: MapEmbedView): string {
  return `${origin}/map${query(view, { utm_source: 'embed', utm_campaign: 'map' })}`
}

/** A region's centre and a zoom that fits it in a frame of about 600 px, or null */
export function regionView(key: string | null | undefined): { lat: number; lng: number; z: number } | null {
  const region = mapRegion(key)
  if (!region) return null
  const [[west, south], [east, north]] = region.bounds
  const z = Math.log2((600 / 512) * (360 / (east - west))) - 0.2
  return { lat: (south + north) / 2, lng: (west + east) / 2, z: Math.min(4, Math.max(1, z)) }
}
