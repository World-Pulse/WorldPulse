'use client'
/**
 * The map's country-economics and price-move layers (Oct 23, 2026; Devon: "Add ... CME like data and
 * the Lloyd's bank like data and layers to the map too"). Each shades the countries from one API answer:
 *   - Country economics: one World Bank indicator (growth, inflation, unemployment, GDP per person,
 *     trade, current account)
 *   - Price moves: how the World Bank's monthly prices moved each country's commodity exports
 * The shading is scenery: a click goes through to the country, whose brief shows its economy.
 */

import { useEffect, useState, type MutableRefObject } from 'react'
import { loadCountryShapes, countryCodeOf } from '@/lib/country-shapes'
import { whenStyleUsable } from '@/lib/map-utils'
import { ECON_SCALES, MOVE_SCALE, colorOn, type EconIndicator, type EconRow, type PriceMoveRow } from '@/lib/trade-layers'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MapRef = MutableRefObject<any>

interface Shading { iso: string; color: string }

/** One shading layer: countries filled with their colour, outlined faintly */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function shade(map: any, ids: { src: string; fill: string; line: string }, rows: Shading[], opacity = 0.42): Promise<boolean> {
  const shapes = await loadCountryShapes().catch(() => null)
  if (!shapes) return false
  const byIso = new Map(rows.map(r => [r.iso, r.color]))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geo = shapes as unknown as { type: string; features: any[] }
  const data = {
    ...geo,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    features: geo.features.map((f: any) => {
      const color = byIso.get(countryCodeOf(f.properties) ?? '')
      return { ...f, properties: { ...f.properties, wpHas: !!color, wpColor: color ?? 'rgba(0,0,0,0)' } }
    }),
  }
  if (!map.getSource(ids.src)) map.addSource(ids.src, { type: 'geojson', data })
  else map.getSource(ids.src).setData(data)
  const before = map.getLayer('cluster-halo') ? 'cluster-halo' : undefined
  if (!map.getLayer(ids.fill)) {
    map.addLayer({ id: ids.fill, type: 'fill', source: ids.src, paint: { 'fill-color': ['get', 'wpColor'], 'fill-opacity': ['case', ['get', 'wpHas'], opacity, 0] } }, before)
    map.addLayer({ id: ids.line, type: 'line', source: ids.src, paint: { 'line-color': ['get', 'wpColor'], 'line-width': 0.6, 'line-opacity': ['case', ['get', 'wpHas'], 0.7, 0] } }, before)
  }
  return true
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unshade(map: any, ids: { src: string; fill: string; line: string }): void {
  try {
    for (const id of [ids.line, ids.fill]) if (map.getLayer(id)) map.removeLayer(id)
    if (map.getSource(ids.src)) map.removeSource(ids.src)
  } catch { /* the style was replaced: nothing to remove */ }
}

const ECON_IDS = { src: 'econ-geo', fill: 'econ-fill', line: 'econ-border' }
const MOVE_IDS = { src: 'pricemove-geo', fill: 'pricemove-fill', line: 'pricemove-border' }

/** Country economics: one indicator for every country */
export function useEconomyLayer(mapRef: MapRef, mapReady: boolean, on: boolean, indicator: string) {
  const [loading, setLoading] = useState(false)
  const [count, setCount] = useState(0)
  const [meta, setMeta] = useState<{ indicator: EconIndicator; indicators: EconIndicator[]; year: number | null } | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    let cancelled = false
    async function apply() {
      if (!on) { unshade(map, ECON_IDS); setCount(0); return }
      setLoading(true)
      try {
        const res = await fetch(`${API_URL}/api/v1/economy?indicator=${encodeURIComponent(indicator)}`)
        const json = res.ok ? await res.json() as { success?: boolean; data?: { available?: boolean; indicator?: EconIndicator; indicators?: EconIndicator[]; rows?: EconRow[] } } : null
        if (cancelled) return
        const d = json?.success && json.data?.available ? json.data : null
        const rows = d?.rows ?? []
        const scale = ECON_SCALES[indicator] ?? ECON_SCALES.growth!
        // The most common year, for the legend ("2025")
        const years = new Map<number, number>()
        for (const r of rows) years.set(r.year, (years.get(r.year) ?? 0) + 1)
        const year = [...years.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
        if (d?.indicator && d.indicators) setMeta({ indicator: d.indicator, indicators: d.indicators, year })
        setCount(rows.length)
        await shade(map, ECON_IDS, rows.map(r => ({ iso: r.iso, color: colorOn(scale, r.value) })))
      } catch (e) {
        console.warn('[map] Country economics layer error:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    whenStyleUsable(map, () => { void apply() })
    // The World Bank's figures change once a day at most
    const timer = on ? setInterval(() => { void apply() }, 60 * 60_000) : null
    return () => { cancelled = true; if (timer) clearInterval(timer) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, indicator, mapReady])
  return { loading, count, meta }
}

/** Price moves: how commodity prices moved each country's exports */
export function usePriceMovesLayer(mapRef: MapRef, mapReady: boolean, on: boolean) {
  const [loading, setLoading] = useState(false)
  const [count, setCount] = useState(0)
  const [month, setMonth] = useState<string | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    let cancelled = false
    async function apply() {
      if (!on) { unshade(map, MOVE_IDS); setCount(0); return }
      setLoading(true)
      try {
        const res = await fetch(`${API_URL}/api/v1/commodities/price-moves`)
        const json = res.ok ? await res.json() as { success?: boolean; data?: { available?: boolean; month?: string | null; rows?: PriceMoveRow[] } } : null
        if (cancelled) return
        const d = json?.success && json.data?.available ? json.data : null
        const rows = (d?.rows ?? []).filter(r => r.month_pct !== null)
        setMonth(d?.month ?? null)
        setCount(rows.length)
        await shade(map, MOVE_IDS, rows.map(r => ({ iso: r.iso, color: colorOn(MOVE_SCALE, r.month_pct as number) })))
      } catch (e) {
        console.warn('[map] Price moves layer error:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    whenStyleUsable(map, () => { void apply() })
    const timer = on ? setInterval(() => { void apply() }, 60 * 60_000) : null
    return () => { cancelled = true; if (timer) clearInterval(timer) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, mapReady])
  return { loading, count, month }
}
