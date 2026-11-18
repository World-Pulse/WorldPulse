/**
 * A guest's country after a role is not where the story is once the headline says who received them (geo.ts
 * GUEST_RECEIVED; Nov 18, 2026: the Times of Oman's "Royal Office Minister receives Deputy National Security Advisor of
 * India" sat in New Delhi).
 */

import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, inferGeo } from '../news-rss'
import { withoutNonPlaceNames } from '../../pipeline/geo'

const src = (id: string) => {
  const s = NEWS_SOURCE_REGISTRY.find(x => x.id === id)
  if (!s) throw new Error(`no feed ${id}`)
  return s
}

describe("a received guest's country", () => {
  it('is blanked out of the headline', () => {
    const [h] = withoutNonPlaceNames('Royal Office Minister receives Deputy National Security Advisor of India', '', 'OM')
    expect(h).not.toMatch(/India/)
    expect(h).toMatch(/Minister receives/)
  })

  it('leaves the place the story names, and other uses of "of"', () => {
    const [a] = withoutNonPlaceNames('Biden meets prime minister of Israel in Washington', '', 'US')
    expect(a).toMatch(/Washington/)
    expect(a).not.toMatch(/Israel/)
    const [b] = withoutNonPlaceNames('Minister receives report on the economy of India', '', 'OM')
    expect(b).toMatch(/India/)
  })

  it('pins the outlet’s own country', () => {
    const s = NEWS_SOURCE_REGISTRY.find(x => x.countryCode === 'OM')
    if (!s) throw new Error('no Omani feed')
    expect(inferGeo('Royal Office Minister receives Deputy National Security Advisor of India', '', s).countryCode).toBe('OM')
  })
})
