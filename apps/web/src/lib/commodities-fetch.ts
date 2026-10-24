/**
 * The commodity watch's API, fetched on the website's server (Oct 23, 2026). Kept a minute in this
 * process (the watch changes every 6 hours).
 */

import { cachedFetch } from '@/lib/server-fetch'
import type { CommodityOverview, CountryCommodities, MapRow, PricesData } from '@/lib/commodities'

const API_BASE = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export type Unavailable = { available: false; message?: string }

async function getData<T>(path: string, ttlMs: number): Promise<T | Unavailable | null> {
  try {
    const res = await cachedFetch(`${API_BASE}/api/v1/commodities${path}`, ttlMs)
    if (res.status === 404) return null
    if (!res.ok) return { available: false }
    const json = await res.json() as { success?: boolean; data?: T | Unavailable }
    return json.success && json.data ? json.data : { available: false }
  } catch {
    return { available: false }
  }
}

/** Server side: the watch's overview, a commodity's countries, a country's cards, the prices */
export const fetchOverview = () => getData<CommodityOverview>('', 60_000)
export const fetchMap = (commodity?: string) => getData<{ available: true; updated_at: string; commodity: string | null; rows: MapRow[] }>(`/map${commodity ? `?commodity=${encodeURIComponent(commodity)}` : ''}`, 60_000)
export const fetchCountry = (iso: string) => getData<CountryCommodities>(`/country/${encodeURIComponent(iso.toLowerCase())}`, 60_000)
export const fetchPrices = () => getData<PricesData>('/prices', 300_000)
