/**
 * Two countries' leaders named and no place: a meeting, not a place (news-rss.ts leadersOnly; Nov 19, 2026: Japan Today's
 * "Xi-Trump-Putin summit seen as more optics than outcomes" sat in Moscow).
 */
import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, inferGeo } from '../news-rss'

const src = (id: string) => {
  const s = NEWS_SOURCE_REGISTRY.find(x => x.id === id)
  if (!s) throw new Error(`no feed ${id}`)
  return s
}

describe('leaders of two countries and no place', () => {
  it('is not Moscow', () => {
    const g = inferGeo('Xi-Trump-Putin summit seen as more optics than outcomes', '', src('japan-today'))
    expect(g.countryCode).not.toBe('RU')
  })
  it('is not Moscow for Nikkei Asia either', () => {
    const g = inferGeo('Trump tells Putin of long-standing ties at APEC', '', src('nikkei-asia'))
    expect(g.countryCode).not.toBe('RU')
  })
  it('keeps a single leader and a named country', () => {
    expect(inferGeo('Putin vows to respond', '', src('japan-today')).countryCode).toBe('RU')
    expect(inferGeo('Trump and Putin discuss Ukraine', '', src('japan-today')).countryCode).toBe('UA')
  })
})
