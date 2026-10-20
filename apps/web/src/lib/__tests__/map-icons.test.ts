/**
 * Map icons for planes, ships and cameras (plan M4): the map font has no
 * emoji, so these layers draw SVG icons.
 */
import { describe, it, expect } from 'vitest'
import { iconSvg, MAP_ICON, ensureMapIcon } from '../map-icons'

describe('iconSvg', () => {
  it('draws a ringed disc in the layer colour with the glyph inside', () => {
    const svg = iconSvg('plane', '#22d3ee')
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('stroke="#22d3ee"')
    expect(svg).toContain('<circle')
    expect(svg).toContain('M17.8 19.2') // the plane's outline
  })

  it('has an icon for each emoji the layers used to draw', () => {
    // (planeMil and planeSos: the live aircraft's military and emergency colours, Oct 19, 2026)
    expect(Object.keys(MAP_ICON).sort()).toEqual(['camera', 'plane', 'planeMil', 'planeSos', 'ship', 'shipCargo', 'shipMilitary', 'shipOther', 'shipPassenger', 'shipTanker'])
    for (const icon of Object.values(MAP_ICON)) expect(icon.id.startsWith('wp-icon-')).toBe(true)
  })
})

describe('ensureMapIcon', () => {
  it('does nothing when the map already has the image', async () => {
    let added = 0
    const map = { hasImage: () => true, addImage: () => { added++ } }
    expect(await ensureMapIcon(map, MAP_ICON.ship)).toBe(true)
    expect(added).toBe(0)
  })
})
