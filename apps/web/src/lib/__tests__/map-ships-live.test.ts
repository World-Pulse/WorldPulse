import { describe, it, expect } from 'vitest'
import { liveShipIconId, liveShipPopupHtml, shipRotation, type LiveShipProps } from '../map-ships-live'
import { MAP_ICON } from '../map-icons'

const ship = (o: Partial<LiveShipProps> = {}): LiveShipProps => ({
  mmsi: '353136000', name: 'EVER GIVEN', kind: 'tanker', sog: 12.34, cog: 87.5, heading: 88, nav: 0,
  dest: 'FUJAIRAH', area: 'Strait of Hormuz', seen: '2026-10-20T03:00:00.000Z', ...o,
})

describe('live ships on the map', () => {
  it('colours a ship by what it is', () => {
    expect(liveShipIconId('tanker')).toBe(MAP_ICON.shipTanker.id)
    expect(liveShipIconId('cargo')).toBe(MAP_ICON.shipCargo.id)
    expect(liveShipIconId('fishing')).toBe(MAP_ICON.shipOther.id)
  })

  it('points the arrow at the heading, else the course, else north', () => {
    expect(shipRotation(88, 87.5)).toBe(88)
    expect(shipRotation(null, 87.5)).toBe(87.5)
    expect(shipRotation(null, null)).toBe(0)
  })

  it('says what the ship is, how it moves, where it goes and when it was heard', () => {
    const html = liveShipPopupHtml(ship(), Date.parse('2026-10-20T03:04:00Z'))
    for (const t of ['LIVE SHIP · TANKER', 'EVER GIVEN', '12.3 kn', 'course 88°', 'Under way', 'Bound for FUJAIRAH', 'Strait of Hormuz', 'heard 4 min ago', 'aisstream.io']) expect(html).toContain(t)
  })

  it("leaves out a moored ship's course, and escapes what the ship sends", () => {
    const html = liveShipPopupHtml(ship({ sog: 0, nav: 5, name: '<b>X</b>', dest: null }), Date.parse('2026-10-20T03:00:20Z'))
    expect(html).toContain('Moored')
    expect(html).not.toContain('course')
    expect(html).not.toContain('<b>X</b>')
    expect(html).toContain('heard just now')
  })
})
