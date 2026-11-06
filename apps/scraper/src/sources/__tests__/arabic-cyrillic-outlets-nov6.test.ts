/**
 * Jordan's and Kyrgyzstan's second newsrooms, in their own languages (Devon, Nov 6, 2026, 10:19 AM, on teaching the
 * matching to read Arabic and Cyrillic, then adding those outlets: "4 proceed with this"). The headlines are real ones
 * of Nov 6 from these feeds; the matching reads them since 648f9ae.
 */

import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, HOME_PIN_SOURCES, inferGeo } from '../news-rss'
import { arabicPlain, withLocalNames } from '../../pipeline/local-names'

const src = (id: string) => {
  const s = NEWS_SOURCE_REGISTRY.find(x => x.id === id)
  if (!s) throw new Error(`no feed ${id}`)
  return s
}
const at = (id: string, title: string) => inferGeo(title, '', src(id)).countryCode

describe("Jordan's Arabic newsrooms (Nov 6, 2026)", () => {
  it('adds Roya News and JO24 in Arabic, without a home pin (the region and the world are half their news)', () => {
    for (const id of ['roya-news-ar', 'jo24-ar']) {
      expect(src(id)).toMatchObject({ countryCode: 'JO', language: 'ar' })
      expect(HOME_PIN_SOURCES.has(id), id).toBe(false)
    }
  })

  it('reads the places their headlines name, with the article, joined little words and vowel marks', () => {
    expect(at('roya-news-ar', 'قاضية فدرالية توقف مؤقتا مشروع ترمب الضخم لبناء قوس النصر في واشنطن لمدة 14 يوما')).toBe('US')
    expect(at('roya-news-ar', 'احتراق شاحنة على طريق رأس النقب باتجاه العقبة')).toBe('JO')
    expect(at('roya-news-ar', 'توقيف 10 مشتبه بهم في قضايا سحر وشعوذة بمحافظة الحسكة السورية')).toBe('SY')
    expect(at('roya-news-ar', 'سلطة الطيران المدني العراقي تنفي فرض قيود جديدة على عبور الطائرات للأجواء العراقية')).toBe('IQ')
    expect(at('roya-news-ar', 'بوتين يستقبل البطريرك ثيوفيلوس الثالث في الكرملين ويقلده وسام الصداقة')).toBe('RU')
    // fully vowelled: "أَمْنُ الأُرْدُنِّ"
    expect(at('roya-news-ar', 'دعوات لِتَغْلِيظِ عُقُوبَاتِ الإِرْهَابِ وَتَطْوِيرِ التَّشْرِيعَاتِ: أَمْنُ الأُرْدُنِّ مَسْؤُولِيَّةٌ')).toBe('JO')
    expect(at('jo24-ar', 'إلغاء مباراة الأردن وإندونيسيا بسبب "مخاوف أمنية"')).toBe('JO')
    // no place named, no home pin: no pin
    expect(at('jo24-ar', 'أبل تستطلع آراء مستخدمي آيفون ديو.. الشاشة القابلة للطي والكاميرا تحت المجهر')).toBeNull()
    expect(arabicPlain('الأُرْدُنِّ وإربد')).toBe('الاردن واربد')
    // everyday words that are also names stay words: an arena is not Aleppo, kindergartens are not Riyadh
    expect(withLocalNames('افتتاح حلبة جديدة', 'ar')).not.toMatch(/Aleppo/)
    expect(withLocalNames('رياض الأطفال تفتح أبوابها', 'ar')).not.toMatch(/Riyadh/)
  })
})

describe("Kyrgyzstan's Russian-language newsrooms (Nov 6, 2026)", () => {
  it('adds 24.kg and Vesti.kg in Russian, pinned at home (mostly Kyrgyzstan\'s own news)', () => {
    for (const id of ['24kg-ru', 'vesti-kg']) {
      expect(src(id)).toMatchObject({ countryCode: 'KG', language: 'ru' })
      expect(HOME_PIN_SOURCES.has(id), id).toBe(true)
    }
  })

  it('reads the places their headlines name, in the cases Russian declines them', () => {
    expect(at('24kg-ru', 'Число выдворенных из России мигрантов выросло в полтора раза')).toBe('RU')
    expect(inferGeo('Угрожали выложить видео в интернет. В Ошской области задержали двоих граждан', '', src('24kg-ru')).locationName).toBe('Osh')
    expect(inferGeo('Жителям Баткена передадут 170 домов, полученных от Таджикистана', '', src('24kg-ru')).locationName).toBe('Batken')
    expect(at('24kg-ru', 'Состояние Илона Маска сократилось после выборов в США')).toBe('US')
    expect(at('24kg-ru', 'Узбекистан предложил странам ШОС объединиться против интернет-вербовки молодежи')).toBe('UZ')
    expect(inferGeo('Четверо детей остались одни в Токмоке', '', src('vesti-kg')).locationName).toBe('Tokmok')
    expect(at('vesti-kg', 'Смертельная авария в Таласской области – погибли четверо человек')).toBe('KG')
  })
})
