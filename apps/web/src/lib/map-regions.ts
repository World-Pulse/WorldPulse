/**
 * Quick jumps to a region of the World Map (plan item M18), like WorldMonitor's
 * "Regional Focus" presets. Bounds are [[west, south], [east, north]].
 */

export interface MapRegion {
  key: string
  label: string
  bounds: [[number, number], [number, number]]
}

export const MAP_REGIONS: MapRegion[] = [
  { key: 'americas',    label: 'Americas',                  bounds: [[-168, -56], [-34, 72]] },
  { key: 'europe',      label: 'Europe',                    bounds: [[-25, 35], [45, 71]] },
  { key: 'mena',        label: 'Middle East & North Africa', bounds: [[-17, 12], [63, 42]] },
  { key: 'africa',      label: 'Africa',                    bounds: [[-19, -35], [52, 38]] },
  { key: 'asia',        label: 'Asia',                      bounds: [[60, -11], [150, 55]] },
  { key: 'oceania',     label: 'Oceania',                   bounds: [[110, -48], [180, 2]] },
]

/** A region by its key, or undefined */
export function mapRegion(key: string | null | undefined): MapRegion | undefined {
  return MAP_REGIONS.find(region => region.key === key)
}

/** Whether a point lies in a region's bounds */
export function inRegion(region: MapRegion, lat: number, lng: number): boolean {
  const [[west, south], [east, north]] = region.bounds
  return lat >= south && lat <= north && lng >= west && lng <= east
}
