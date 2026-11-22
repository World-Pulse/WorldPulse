'use client'
/**
 * The map's travel advisories layer (Nov 22, 2026): every country shaded by the US State Department's level
 * (lib/travel-levels.ts). Like the country economics layer, the shading is scenery: a click goes through to the
 * country, whose page has its advice.
 */

import { useEffect, useState, type MutableRefObject } from 'react'
import { whenStyleUsable } from '@/lib/map-utils'
import { travelShading, travelCounts } from '@/lib/travel-levels'
import { shade, unshade } from './useTradeLayers'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MapRef = MutableRefObject<any>

const IDS = { src: 'travel-geo', fill: 'travel-fill', line: 'travel-border' }

export function useTravelAdvisoryLayer(mapRef: MapRef, mapReady: boolean, on: boolean) {
  const [loading, setLoading] = useState(false)
  const [count, setCount] = useState(0)
  const [byLevel, setByLevel] = useState<[number, number, number, number]>([0, 0, 0, 0])
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    let cancelled = false
    async function apply() {
      if (!on) { unshade(map, IDS); setCount(0); return }
      setLoading(true)
      try {
        const res = await fetch(`${API_URL}/api/v1/public/travel-advice`)
        const json = res.ok ? await res.json() as { success?: boolean; data?: { levels?: unknown } } : null
        if (cancelled) return
        const rows = travelShading(json?.success ? json.data?.levels : [])
        setCount(rows.length)
        setByLevel(travelCounts(rows))
        // lighter than the economics layer: most of the world is at level 1 or 2
        await shade(map, IDS, rows, 0.34)
      } catch (e) {
        console.warn('[map] Travel advisories layer error:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    whenStyleUsable(map, () => { void apply() })
    // The scraper reads the State Department's feed hourly
    const timer = on ? setInterval(() => { void apply() }, 60 * 60_000) : null
    return () => { cancelled = true; if (timer) clearInterval(timer) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, mapReady])
  return { loading, count, byLevel }
}
