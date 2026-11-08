/**
 * Part 13 (Nov 8, 2026, 6 PM): a match or stadium story with no place in its headline goes where its summary says it
 * was played, not to the outlet's home (Vanguard's Bodo/Glimt stand collapse sat in Lagos; it was in Tromsø).
 */

import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, inferGeo } from '../news-rss'

const src = (id: string) => {
  const s = NEWS_SOURCE_REGISTRY.find(x => x.id === id)
  if (!s) throw new Error(`no feed ${id}`)
  return s
}
const title = 'Fan rushed to hospital after stadium stand collapses during Bodo/Glimt match'

describe('a match story without a place in its headline', () => {
  it('goes to the venue its summary names', () => {
    expect(inferGeo(title, 'A fan was taken to hospital after a stand collapsed at the stadium in Tromsø on Sunday.', src('vanguard-ng')))
      .toMatchObject({ countryCode: 'NO', locationName: 'Tromsø' })
  })
  it('stays at the outlet when the summary names no venue, or only a person\'s town', () => {
    expect(inferGeo(title, 'A fan was taken to hospital.', src('vanguard-ng')).countryCode).toBe('NG')
    expect(inferGeo(title, 'The fan, who is from Tromsø, was taken to hospital.', src('vanguard-ng')).countryCode).toBe('NG')
  })
  it('does not touch other stories', () => {
    expect(inferGeo('Police, DSS kill Ogun kidnapper, arrest teenager', 'The suspect fled to Tromsø.', src('vanguard-ng')).countryCode).toBe('NG')
  })
})
