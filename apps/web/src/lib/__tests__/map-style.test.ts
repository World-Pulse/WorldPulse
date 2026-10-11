/**
 * The World Map's look (lib/map-style.ts): basemap modes, the recoloured dark
 * style and the switch between basemaps.
 */

import { describe, it, expect } from 'vitest'
import {
  toBasemapMode, recolorDarkStyle, applyBasemap, baseLayerIds, fallbackStyle,
  SEVERITY_COLOR, RANK_COLOR, SEVERITY_RANK, MAP_PALETTE,
} from '../map-style'

describe('toBasemapMode', () => {
  it('accepts the three basemaps and reads old "terrain" links as dark', () => {
    expect(toBasemapMode('dark')).toBe('dark')
    expect(toBasemapMode('night')).toBe('night')
    expect(toBasemapMode('satellite')).toBe('satellite')
    expect(toBasemapMode('terrain')).toBe('dark')
    expect(toBasemapMode('anything')).toBeNull()
    expect(toBasemapMode(undefined)).toBeNull()
  })
})

describe('severity palette', () => {
  it('gives high and medium clearly different colours (they were nearly the same)', () => {
    expect(SEVERITY_COLOR.high).not.toBe(SEVERITY_COLOR.medium)
    expect(SEVERITY_COLOR.high.toLowerCase()).toBe('#ff8a3d')
  })

  it('maps each rank to its severity colour', () => {
    for (const [sev, rank] of Object.entries(SEVERITY_RANK)) {
      expect(RANK_COLOR[rank]).toBe(SEVERITY_COLOR[sev])
    }
  })
})

describe('recolorDarkStyle', () => {
  const style = () => ({
    version: 8,
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': 'rgb(12,12,12)' } },
      { id: 'water', type: 'fill', paint: { 'fill-color': 'rgb(27,27,29)' } },
      { id: 'boundary_country_z0-4', type: 'line', paint: { 'line-color': 'grey' } },
      { id: 'place_country_major', type: 'symbol', layout: { 'text-field': '{name}' }, paint: {} },
      { id: 'place_state', type: 'symbol', layout: {}, paint: {} },
      { id: 'something_new', type: 'fill', paint: { 'fill-color': 'red' } },
    ],
  })

  it('paints land, water and borders in the WorldPulse palette', () => {
    const s = recolorDarkStyle(style())
    expect(s.layers[0].paint['background-color']).toBe(MAP_PALETTE.land)
    expect(s.layers[1].paint['fill-color']).toBe(MAP_PALETTE.water)
    expect(s.layers[2].paint['line-color']).toBe(MAP_PALETTE.boundaryCountry)
  })

  it('names places in English where it can, countries in quiet capitals', () => {
    const country = recolorDarkStyle(style()).layers[3]
    expect(country.layout['text-field'][0]).toBe('coalesce')
    expect(country.layout['text-transform']).toBe('uppercase')
    expect(country.paint['text-color']).toBe(MAP_PALETTE.labelCountry)
  })

  it('leaves region names out until zoomed in, and unknown layers alone', () => {
    const s = recolorDarkStyle(style())
    expect(s.layers[4].minzoom).toBe(5)
    expect(s.layers[5].paint['fill-color']).toBe('red')
  })
})

describe('applyBasemap', () => {
  function fakeMap(layers: Array<{ id: string; type: string }>) {
    const visibility = new Map<string, string>()
    return {
      visibility,
      getLayer: (id: string) => layers.find(l => l.id === id) ?? (id.startsWith('wp-imagery') ? { id, type: 'raster' } : undefined),
      setLayoutProperty: (id: string, _k: string, v: string) => { visibility.set(id, v) },
    }
  }
  const layers = [
    { id: 'background', type: 'background' },
    { id: 'water', type: 'fill' },
    { id: 'highway_minor', type: 'line' },
    { id: 'boundary_country_z5-', type: 'line' },
    { id: 'place_city', type: 'symbol' },
    { id: 'highway_name_other', type: 'symbol' },
  ]
  const ids = baseLayerIds({ layers })

  it('dark: the whole vector map, no imagery', () => {
    const map = fakeMap(layers)
    applyBasemap(map, 'dark', ids)
    expect(map.visibility.get('water')).toBe('visible')
    expect(map.visibility.get('highway_minor')).toBe('visible')
    expect(map.visibility.get('wp-imagery-night')).toBe('none')
    expect(map.visibility.get('wp-imagery-satellite')).toBe('none')
  })

  it('night: city lights with borders and place names on top, no fills or roads', () => {
    const map = fakeMap(layers)
    applyBasemap(map, 'night', ids)
    expect(map.visibility.get('wp-imagery-night')).toBe('visible')
    expect(map.visibility.get('water')).toBe('none')
    expect(map.visibility.get('highway_minor')).toBe('none')
    expect(map.visibility.get('highway_name_other')).toBe('none')
    expect(map.visibility.get('boundary_country_z5-')).toBe('visible')
    expect(map.visibility.get('place_city')).toBe('visible')
  })

  it('satellite: the imagery instead of the night lights', () => {
    const map = fakeMap(layers)
    applyBasemap(map, 'satellite', ids)
    expect(map.visibility.get('wp-imagery-satellite')).toBe('visible')
    expect(map.visibility.get('wp-imagery-night')).toBe('none')
  })
})

describe('fallbackStyle', () => {
  it('is a valid empty style with fonts, used when the vector map is unreachable', () => {
    const s = fallbackStyle()
    expect(s.version).toBe(8)
    expect(s.glyphs).toContain('openfreemap')
    expect(s.layers).toHaveLength(1)
  })
})
