/**
 * What may be called breaking news (Nov 8, 2026; Devon: "the banner should always be accurate"): never an aircraft
 * transponder alarm, a satellite or sensor reading or an opinion piece.
 */
import { describe, it, expect } from 'vitest'
import { notBreakingNews } from '../breaking-news'

describe('notBreakingNews', () => {
  it('tells a news report from an alarm, a sensor reading or an opinion piece', () => {
    expect(notBreakingNews('Aircraft N857ER squawking 7700 — General emergency (United States)')).toBe('transponder')
    expect(notBreakingNews('Major wildfire detected near Western Australia, Australia')).toBe('sensor')
    expect(notBreakingNews('M 6.2 - 120 km E of Miyako, Japan')).toBe('sensor')
    expect(notBreakingNews('Tsunami Alert: 75 miles SW of Eureka, California')).toBe('sensor')
    expect(notBreakingNews('US Midterms And The Emerging Paradoxes – OpEd')).toBe('opinion')
    expect(notBreakingNews('Opinion: The court got it wrong')).toBe('opinion')
    // a columnist's name or a bracketed byline before the headline (Nov 8: two "blue tsunami" columns were disasters)
    expect(notBreakingNews('DAVID MARCUS: Where does the blue tsunami leave old school Dems like John Fetterman?')).toBe('opinion')
    expect(notBreakingNews('[Aziz Huq] Utilizing US midterm tsunami')).toBe('opinion')
    // a figurative tsunami, with no byline to tell it (live on the list at 9:36 PM)
    expect(notBreakingNews('El tsunami azul y el fenómeno demócrata en las elecciones en Estados Unidos')).toBe('figurative')
    expect(notBreakingNews('Where does the blue tsunami leave old school Dems?')).toBe('figurative')
    expect(notBreakingNews('Tsunami warning issued after magnitude 7.6 quake off Japan')).toBeNull()
    for (const news of ['BREAKING: Dam bursts above Valencia', 'JUST IN: Strike on Kharkiv', 'Seven dead and more than 100 injured after trains collide in Egypt', 'UN says 2 million displaced in Sudan', 'M23 rebels take Goma airport']) {
      expect(notBreakingNews(news), news).toBeNull()
    }
  })
})
