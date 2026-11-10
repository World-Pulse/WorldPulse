/**
 * Russian and Arabic (Nov 10, 2026, evening; Devon, 2:51 PM: "Proceed with 1-5 all of them", 2: "Add Russian and
 * Arabic to the second-outlet search ... Kyrgyzstan, Syria, Bahrain and the Gulf"). Their reports were rated low
 * (the severity rules didn't read them: 419 of 467 waiting that afternoon), so the search, which takes medium and
 * above, never looked for their second outlet; and it read GDELT's translated list in four languages only. Headlines
 * from the live feeds and GDELT's translated list that day.
 */
import { describe, it, expect, vi } from 'vitest'
import type { HeldReport } from '../second-outlet'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../crosscheck', () => ({ crossCheckLater: vi.fn() }))

const { rateSeverity } = await import('../severity')
const { foreignCasualties } = await import('../severity-languages')
const { otherOutlets, storyTokens, nearCopy } = await import('../second-outlet')
const { TRANSLATED_LANGUAGES, siteOf } = await import('../gdelt-articles')

describe('severity in Russian and Arabic', () => {
  it('counts the dead and injured', () => {
    expect(rateSeverity('В Болгарии в ДТП столкнулись 86 автомобилей. Погибли 12 человек', null, 'disaster', 'ru')).toBe('high')
    expect(rateSeverity('حصيلة دامية لانتهاكات الحوثيين في تعز.. 54 قتيلاً و147 جريحاً في شهر', null, 'conflict', 'ar')).toBe('high')
    expect(foreignCasualties('حصيلة دامية لانتهاكات الحوثيين في تعز.. 54 قتيلاً و147 جريحاً في شهر', 'ar')).toMatchObject({ dead: 54, injured: 147 })
    // in Arabic-Indic digits too, and "killed and injured" as one count
    expect(foreignCasualties('مقتل ١٢ شخصا في انفجار', 'ar')?.dead).toBe(12)
    expect(rateSeverity('القوات اليمنية تعلن مقتل وإصابة نحو 127 من ميليشيا الحوثي', null, 'conflict', 'ar')).toBe('high')
    expect(rateSeverity('ارتفاع حصيلة ضحايا حادث قطار العياط في مصر إلى 7 وفيات و112 مصابا', null, 'disaster', 'ar')).toBe('high')
  })

  it('rates the kinds of event', () => {
    expect(rateSeverity('قصف إسرائيلي يستهدف بيت جن في ريف دمشق', null, 'conflict', 'ar')).toBe('high')
    expect(rateSeverity('مصر: إدراج نهائي لجماعة الإخوان و3 أشخاص على قوائم الإرهاب', null, 'security', 'ar')).toBe('medium')
    expect(rateSeverity('Минюст Польши: стрелок мог заранее готовиться к теракту в Кракове', null, 'security', 'ru')).toBe('high')
    expect(rateSeverity('В Бишкеке задержали подозреваемого в распространении синтетических наркотиков', null, 'security', 'ru')).toBe('medium')
    expect(rateSeverity('Садыр Жапаров подал заявление о выдвижении в президенты Кыргызстана', 'Выборы президента пройдут в январе.', 'elections', 'ru')).toBe('medium')
  })

  it("leaves everyday news low, and doesn't take a career, a league's top or a penalty for news", () => {
    expect(rateSeverity('Сегодня в Бишкеке. Погода, мероприятия, даты', null, 'other', 'ru')).toBe('low')
    expect(rateSeverity('وزيرة التنمية تبحث مع السفير الأذربيجاني تعزيز التعاون في مجالات التنمية', null, 'geopolitics', 'ar')).toBe('low')
    // "مسيرة" (a career, a march), "القمة" (the top of the table), "عقوبات" (a match's penalties)
    expect(rateSeverity('رسول الحداد.. مسيرة صنعت تاريخ «مرسيدس» في البحرين', null, 'economy', 'ar')).toBe('low')
    expect(rateSeverity('الفيصلي والرمثا يتقاسمان صدارة الدوري الأردني.. والوحدات يقترب من القمة', null, 'sports', 'ar')).toBe('low')
    expect(rateSeverity('في (الفرمان) الأسبوعي انحسار الشغب وعقوبات منطقية', null, 'sports', 'ar')).toBe('low')
    // the Bahraini crown prince's title names the armed forces
    expect(rateSeverity('سمو ولي العهد نائب القائد الأعلى للقوات المسلحة رئيس مجلس الوزراء يستقبل وفدا', null, 'geopolitics', 'ar')).toBe('low')
    // and English is read as before
    expect(rateSeverity('Tote bags are back in fashion')).toBe('low')
  })
})

describe('the second-outlet search in Russian and Arabic', () => {
  it("reads GDELT's translated list's Russian and Arabic articles", () => {
    expect(TRANSLATED_LANGUAGES).toMatchObject({ rus: 'ru', ara: 'ar' })
  })

  it('reads their headlines in one form of each word, without the little words', () => {
    const ru = storyTokens('Жапаров подписал закон о повышении зарплат учителям', 'ru')
    expect(ru).toEqual(expect.arrayContaining(storyTokens('Садыр Жапаров подписал закон о повышении зарплат учителей', 'ru')
      .filter(t => !t.startsWith('садыр'))))
    expect(ru).not.toContain('о')
    const ar = storyTokens('الحكومة السورية تعلن خطة لإعادة إعمار حلب', 'ar')
    expect(ar.length).toBeGreaterThanOrEqual(4)
    expect(ar).not.toContain('في')
  })

  const AT = new Date('2026-11-10T10:00:00Z')
  const LATER = new Date(AT.getTime() + 3 * 3_600_000)
  const held = (over: Partial<HeldReport>): HeldReport => ({
    id: 'sig', title: '', category: 'geopolitics', severity: 'medium', published_at: AT, original_urls: [], source_ids: [],
    location_name: null, lat: null, lng: null, tags: ['news', 'rss'], ...over,
  })
  const article = (url: string, title: string, lang: string) =>
    ({ url, title, site: siteOf(new URL(url).hostname), at: new Date(AT.getTime() + 2 * 3_600_000), lang })

  it("finds a Kyrgyz report's second outlet in Russian, and a Syrian one's in Arabic", () => {
    const kg = held({
      id: 'sig-kg', language: 'ru', title: 'Жапаров подписал закон о повышении зарплат учителям с 1 января',
      original_urls: ['https://24.kg/obschestvo/123_zhaparov_podpisal_zakon/'], location_name: 'Bishkek, Kyrgyzstan', lat: 42.87, lng: 74.6,
    })
    expect(otherOutlets(kg, [article('https://kaktus.media/doc/123', 'Садыр Жапаров подписал закон: зарплаты учителей вырастут с 1 января', 'ru')], LATER)
      .map(f => f.site)).toEqual(['kaktus.media'])
    // a Russian report isn't compared with Arabic or English articles
    expect(otherOutlets(kg, [article('https://kaktus.media/doc/124', 'Садыр Жапаров подписал закон: зарплаты учителей вырастут с 1 января', 'ar')], LATER)).toEqual([])

    const sy = held({
      id: 'sig-sy', language: 'ar', category: 'conflict', title: 'مقتل 12 شخصا في انفجار سيارة مفخخة بمدينة منبج',
      original_urls: ['https://www.sana.sy/?p=123'], location_name: 'Manbij, Syria', lat: 36.53, lng: 37.95,
    })
    expect(otherOutlets(sy, [article('https://www.enabbaladi.net/123', 'انفجار سيارة مفخخة في منبج يودي بحياة 12 شخصا', 'ar')], LATER)
      .map(f => f.site)).toEqual(['enabbaladi.net'])
  })

  it('takes a copy of the same Arabic or Russian headline for a copy', () => {
    expect(nearCopy('مقتل 12 شخصا في انفجار سيارة مفخخة بمدينة منبج', 'مقتل 12 شخصا في انفجار سيارة مفخخة بمدينة منبج السورية', 'ar')).toBe(true)
    expect(nearCopy('Жапаров подписал закон о повышении зарплат учителям', 'Жапаров подписал закон о повышении зарплат учителям — 24.kg', 'ru')).toBe(true)
  })
})
