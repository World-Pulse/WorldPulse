import { describe, it, expect } from 'vitest'
import { aircraftPopupHtml, altitudeLabel, planeRotation } from '../map-aircraft'

describe('map aircraft', () => {
  it('turns the plane icon to its heading (the glyph points north-east)', () => {
    expect(planeRotation(45)).toBe(0)
    expect(planeRotation(0)).toBe(315)
    expect(planeRotation(180)).toBe(135)
    expect(planeRotation(null)).toBe(0)
  })
  it('altitudes read as flight levels up high', () => {
    expect(altitudeLabel(31000)).toBe('FL310 (31,000 ft)')
    expect(altitudeLabel(4500)).toBe('4,500 ft')
    expect(altitudeLabel('ground')).toBe('On the ground')
    expect(altitudeLabel(null)).toBe('')
  })
  it('the popup names it, says what it is, and escapes what it shows', () => {
    const html = aircraftPopupHtml({ hex: 'ae1234', callsign: 'RCH123', reg: '07-7180', type: 'C17', desc: '<b>C-17</b>', operator: 'USAF',
      alt: 31000, speed: 452, track: 93, squawk: '7700', emergency: 'Emergency', military: true }, '2026-10-19T17:40:00.000Z')
    expect(html).toContain('EMERGENCY · SQUAWK 7700')
    expect(html).toContain('RCH123')
    expect(html).toContain('&lt;b&gt;C-17&lt;/b&gt; · USAF')
    expect(html).toContain('FL310 (31,000 ft) · 452 kt · heading 93°')
    expect(html).toContain('17:40 UTC')
    expect(html).toContain('adsb.lol (ODbL)')
  })
})
