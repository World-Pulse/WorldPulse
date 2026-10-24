/**
 * The map's economy, price-move and shipping-news layers (Oct 23, 2026): the words, the colours and
 * the shipping popup.
 */
import { describe, it, expect } from 'vitest'
import { dollars, formatEcon, signed, colorOn, scaleLabels, movesText, ECON_SCALES, MOVE_SCALE, type PriceMoveItem } from '@/lib/trade-layers'
import { shippingFeatures, shippingPopup } from '@/lib/map-overlays'

describe('words', () => {
  it('puts figures in words', () => {
    expect([dollars(2.17e12), dollars(48.2e9), dollars(512e9), dollars(9960.4), dollars(-3.5e6)]).toEqual(['$2.2 trillion', '$48.2 billion', '$512 billion', '$9,960', '−$3.5 million'])
    expect([formatEcon('pct', 2.286), formatEcon('pct', -1.04), formatEcon('pct_gdp', -2.75), formatEcon('people', 212_812_405)]).toEqual(['2.3%', '−1%', '−2.8% of GDP', '213 million'])
    expect([signed(8.7), signed(-8.9), signed(0), signed(null)]).toEqual(['+8.7%', '−8.9%', '0%', '—'])
  })

  it("names a country's export price moves", () => {
    const item = (name: string, m: number) => ({ name, price: { month_pct: m } }) as unknown as PriceMoveItem
    expect(movesText([item('Soybeans', 8.7), item('Crude oil', 28.5), item('Coffee', -8.9), item('Gold', 1)])).toBe('soybeans +8.7%, crude oil +28.5%, coffee −8.9%')
  })
})

describe('colours', () => {
  it('colours a value at its break', () => {
    const g = ECON_SCALES.growth!
    expect([colorOn(g, -5), colorOn(g, -2), colorOn(g, 2.286), colorOn(g, 9)]).toEqual([g.colors[0], g.colors[1], g.colors[3], g.colors[5]])
    expect(colorOn(MOVE_SCALE, 0)).toBe('#94a3b8')
  })

  it('labels each colour of the legend', () => {
    expect(scaleLabels(MOVE_SCALE)).toEqual(['under −10%', '−10% to −3%', '−3% to 3%', '3% to 10%', '10% and over'])
    expect(scaleLabels(ECON_SCALES.gdp_per_person!)[0]).toBe('under $1,500')
  })
})

describe("Lloyd's List's shipping news on the map", () => {
  const json = { success: true, data: { items: [
    { id: 'LL1', title: 'Hormuz fuels bad bunkers as Singapore biofuel sales plunge', url: 'https://www.lloydslist.com/LL1/Hormuz', published: '2026-10-23T10:06:49.000Z', kind: 'News',
      places: [{ key: 'sea:strait-of-hormuz', name: 'Strait of Hormuz', iso: null, lat: 26.57, lon: 56.25 }, { key: 'SG', name: 'Singapore', iso: 'SG', lat: 1.29, lon: 103.85 }] },
    { id: 'LL2', title: 'Crude tankers in correction mode', url: 'https://www.lloydslist.com/LL2/Crude', published: '2026-10-23T23:20:09.000Z', kind: 'Analysis',
      places: [{ key: 'sea:strait-of-hormuz', name: 'Strait of Hormuz', iso: null, lat: 26.57, lon: 56.25 }] },
    { id: 'LL3', title: 'Not theirs', url: 'https://example.com/x', published: '2026-10-23T23:20:09.000Z', kind: 'News', places: [{ key: 'GR', name: 'Greece', iso: 'GR', lat: 37.98, lon: 23.73 }] },
  ] } }

  it('makes a circle per place, sized by its headlines, with links only to lloydslist.com', () => {
    const f = shippingFeatures(json)
    expect(f.map(x => [x.properties.key, x.properties.count, x.properties.size])).toEqual([['sea:strait-of-hormuz', 2, 1], ['SG', 1, 0.5]])
    expect(f[0]!.geometry.coordinates).toEqual([56.25, 26.57])
  })

  it('lists the headlines in the popup, credited', () => {
    const html = shippingPopup(shippingFeatures(json)[0]!.properties)
    expect(html).toContain('SHIPPING NEWS · STRAIT OF HORMUZ')
    expect(html).toContain('href="https://www.lloydslist.com/LL1/Hormuz" target="_blank" rel="noopener noreferrer"')
    expect(html).toContain("Headlines: Lloyd&#39;s List (lloydslist.com)")
    expect(html).not.toContain('example.com')
  })
})
