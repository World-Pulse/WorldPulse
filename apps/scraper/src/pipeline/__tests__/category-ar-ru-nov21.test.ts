/**
 * Arabic and Russian topics (Nov 21, 2026): a Saudi league preview, an Apple assistant and a black-hole image from
 * a Yemeni outlet, and a Kazakh outlet's film sequel sat under the outlets' own "Politics" (live read, Nov 21).
 */
import { describe, it, expect } from 'vitest'
import { categorizeText } from '../categories'

describe('Arabic and Russian topics', () => {
  it('reads Arabic sports, technology, science and culture', () => {
    expect(categorizeText('رونالدو في مواجهة "عقدة" ركلات الجزاء بالدوري السعودي', '', 'ar')).toBe('sports')
    expect(categorizeText('ريال مدريد يطارد صدارة الليغا في مواجهة قوية أمام سيلتا فيجو', '', 'ar')).toBe('sports')
    expect(categorizeText('موعد مباراة الأهلي والشمال في دوري أبطال آسيا للنخبة والقنوات الناقلة', '', 'ar')).toBe('sports')
    expect(categorizeText('آبل تطور مساعد ذكاء اصطناعي يتحكم بأجهزة "ماك" بحلول 2027', '', 'ar')).toBe('technology')
    expect(categorizeText('الذكاء الاصطناعي يؤكد صحة أول صورة لثقب أسود في التاريخ', '', 'ar')).toBe('science')
    expect(categorizeText('عرض الفيلم الجديد في مهرجان السينما', '', 'ar')).toBe('culture')
  })

  it('leaves Arabic words with a political sense alone', () => {
    expect(categorizeText('الرئيس المنتخب يلتقي وزير الخارجية', '', 'ar')).toBeNull()
    expect(categorizeText('تقرير دوري عن الأوضاع في تعز', '', 'ar')).toBeNull()
    expect(categorizeText('وزير العدل يتفقد ماكينة إصدار الشهادات بمحكمة بنها', '', 'ar')).toBeNull()
  })

  it('reads Russian', () => {
    expect(categorizeText('Маколей Калкин вернётся в “Один дома“: что известно о продолжении культового фильма', '', 'ru')).toBe('culture')
    expect(categorizeText('Сборная Казахстана по футболу сыграет с Бельгией', '', 'ru')).toBe('sports')
    expect(categorizeText('Врачи рассказали о новой вакцине от гриппа', '', 'ru')).toBe('health')
  })

  it('leaves a theatre of war and a government statement alone', () => {
    expect(categorizeText('Театр военных действий расширился', '', 'ru')).toBeNull()
    expect(categorizeText('Президент подписал указ о бюджете', '', 'ru')).toBeNull()
  })
})
