/**
 * Arabic names of Latin American, African and other countries (QA review, Nov 6, 2026, 8:44 PM): Syria TV's "Paraguay's
 * Senate impeaches President Peña" was pinned in Damascus, because "باراغواي" named no place.
 */

import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, inferGeo } from '../news-rss'
import { withLocalNames } from '../../pipeline/local-names'

const syriaTv = NEWS_SOURCE_REGISTRY.find(x => x.id === 'syria-tv-ar')!
const at = (title: string) => inferGeo(title, '', syriaTv).countryCode

describe('Arabic world names (Nov 6, 2026)', () => {
  it('reads the countries and cities, with the article and joined little words', () => {
    expect(at('مجلس الشيوخ في باراغواي يعزل الرئيس سانتياغو بينيا')).toBe('PY')
    expect(at('انتخابات الأرجنتين وأوروغواي')).not.toBe('SY')
    expect(at('زلزال يضرب النيبال')).toBe('NP')
    expect(at('الحكومة الغانية تعلن ميزانية جديدة في أكرا بغانا')).toBe('GH')
    expect(at('رئيس الإكوادور يعلن حالة الطوارئ')).toBe('EC')
    expect(at('اجتماع في العاصمة الكينية نيروبي')).toBe('KE')
  })

  it('leaves everyday words alone: financial is not Mali, a cup is not Cuba', () => {
    expect(withLocalNames('الوضع المالي للشركة', 'ar')).not.toMatch(/Mali/)
    expect(withLocalNames('كوبا من الشاي', 'ar')).not.toMatch(/Cuba/)
  })
})
