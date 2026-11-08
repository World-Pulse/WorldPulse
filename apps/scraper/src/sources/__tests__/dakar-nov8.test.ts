/**
 * Nov 8, 2026 (M78 part 11): "Dakar 2026" is the Youth Olympic Games in the city, not the rally that left Africa.
 */

import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, inferGeo } from '../news-rss'

const at = (i: number, title: string, summary = '') => inferGeo(title, summary, NEWS_SOURCE_REGISTRY[i])

describe('Dakar 2026', () => {
  it('is pinned at Dakar', () => {
    const g = at(0, 'JOJ Dakar 2026 : le Sénégal s’offre ses premières médailles d’or')
    expect(g).toMatchObject({ locationName: expect.stringContaining('Dakar'), countryCode: 'SN' })
  })
  it('still leaves the rally alone', () => {
    const g = at(0, 'El Dakar 2027 arrancará en Portugal')
    expect(g?.locationName || '').not.toContain('Dakar')
    const h = at(0, 'Rallye Dakar 2026 : la dernière étape')
    expect(h?.locationName || '').not.toContain('Dakar')
  })
})
