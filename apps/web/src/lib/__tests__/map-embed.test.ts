import { describe, it, expect } from 'vitest'
import { embedMapUrl, embedMapCode, embedBackLink, regionView } from '../map-embed'

const O = 'https://world-pulse.io'

describe('map embed (G17)', () => {
  it('leaves defaults out of the address', () => {
    expect(embedMapUrl(O, { cat: 'all', sev: 'all', tr: '24h' })).toBe(`${O}/embed/map`)
  })

  it('carries topic, severity, window, region and view', () => {
    const url = embedMapUrl(O, { cat: 'conflict', sev: 'high', tr: '7d', region: 'europe' })
    expect(url).toBe(`${O}/embed/map?cat=conflict&sev=high&tr=7d&region=europe`)
    expect(embedMapUrl(O, { lat: 33.123, lng: 44.5, z: 4.26 })).toBe(`${O}/embed/map?lat=33.12&lng=44.50&z=4.3`)
  })

  it('drops an unknown region', () => {
    expect(embedMapUrl(O, { region: 'mars' })).toBe(`${O}/embed/map`)
  })

  it('makes iframe code with escaped ampersands', () => {
    const code = embedMapCode(O, { cat: 'health', sev: 'high' })
    expect(code).toContain('<iframe src="https://world-pulse.io/embed/map?cat=health&amp;sev=high"')
    expect(code).toContain('loading="lazy"')
  })

  it('links back to the full map with the embed tags', () => {
    expect(embedBackLink(O, { cat: 'health' })).toBe(`${O}/map?cat=health&utm_source=embed&utm_campaign=map`)
  })

  it('centres a region', () => {
    const v = regionView('europe')!
    expect(v.lat).toBe(53)
    expect(v.z).toBeGreaterThan(1)
    expect(regionView('nope')).toBeNull()
  })
})
