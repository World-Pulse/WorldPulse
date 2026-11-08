/**
 * Nov 7, 2026 (part 10): the Gulf of Oman. Headlines of Nov 7 about ships there sat at Tehran (The National)
 * and Washington (Korea Herald), the outlets' home pins.
 */

import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, inferGeo } from '../news-rss'

const first = (n: number) => NEWS_SOURCE_REGISTRY.slice(0, n)
const at = (i: number, title: string, summary = '') => inferGeo(title, summary, NEWS_SOURCE_REGISTRY[i])

describe('Gulf of Oman', () => {
  it('is pinned at sea, not at the outlet home', () => {
    expect(first(1).length).toBe(1)
    for (let i = 0; i < NEWS_SOURCE_REGISTRY.length; i += 40) {
      const g = at(i, 'US military says it fired on commercial vessel in Gulf of Oman')
      expect(g).toMatchObject({ locationName: 'Gulf of Oman' })
    }
  })
})

describe('Gulf of Aden', () => {
  it('is pinned at sea', () => {
    expect(at(0, 'Pirates seize a tanker in the Gulf of Aden')).toMatchObject({ locationName: 'Gulf of Aden' })
  })
})
