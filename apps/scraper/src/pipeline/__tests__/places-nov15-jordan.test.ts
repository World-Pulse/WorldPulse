/**
 * Nov 15, 2026: Jordan's Arabic press (Roya, JO24) names its governorates' towns; "الكرك" (Karak) sat unpinned in a
 * verdict story about the Hamoud church attack, because the Arabic rules knew Irbid and Aqaba but not the rest.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { placeFromText } from '../geo'
import { withLocalNames } from '../local-names'

const place = (text: string) => placeFromText(withLocalNames(text, 'ar'))

describe('Jordan towns in Arabic', () => {
  it('pins Karak', () => {
    const p = place('محكمة أمن الدولة تعقد الأحد جلسة النطق بالحكم في قضية الهجوم الإرهابي على كنيسة حمود بالكرك')
    expect(p.countryCode).toBe('JO')
  })
  it.each([
    ['وفاة طفل في حادث سير في الزرقاء', 'Zarqa'],
    ['إغلاق طريق في المفرق بسبب الثلوج', 'Mafraq'],
    ['حريق في جرش', 'Jerash'],
    ['افتتاح مدرسة في مادبا', 'Madaba'],
    ['أمطار غزيرة في الطفيلة', 'Tafilah'],
    ['حادث في عجلون', 'Ajloun'],
  ])('%s', (text, name) => {
    const p = place(text)
    expect(p.countryCode).toBe('JO')
    expect(JSON.stringify(p)).toContain(name)
  })
})
