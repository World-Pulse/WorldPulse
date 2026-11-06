/**
 * The Royal Gazette, SANA, Syria TV, Al-Watan, Al Bilad and Ikon.mn (Devon, Nov 6, 2026, 1:17 PM, "Ok to all": The
 * Royal Gazette's feed list page, and "Go in anyway or skip: Syria (SANA, Syria TV, Al-Watan), Bahrain (Al Bilad),
 * Mongolia (Ikon.mn)"). The headlines are real ones of Nov 6 from these feeds, read with the poller's own reader.
 */

import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, HOME_PIN_SOURCES, inferGeo } from '../news-rss'
import { withLocalNames } from '../../pipeline/local-names'

const src = (id: string) => {
  const s = NEWS_SOURCE_REGISTRY.find(x => x.id === id)
  if (!s) throw new Error(`no feed ${id}`)
  return s
}
const at = (id: string, title: string) => inferGeo(title, '', src(id))

describe('the six outlets (Nov 6, 2026, 2 PM)', () => {
  it('adds each in its own language, with a home pin only where its news is mostly its own country\'s', () => {
    const want: Array<[string, string, string, boolean]> = [
      ['royal-gazette-bm', 'BM', 'en', true], ['sana-sy-ar', 'SY', 'ar', true], ['syria-tv-ar', 'SY', 'ar', false],
      ['al-watan-sy-ar', 'SY', 'ar', true], ['al-bilad-bh-ar', 'BH', 'ar', false], ['ikon-mn', 'MN', 'mn', true],
    ]
    for (const [id, countryCode, language, pinned] of want) {
      expect(src(id), id).toMatchObject({ countryCode, language })
      expect(HOME_PIN_SOURCES.has(id), id).toBe(pinned)
    }
    // SANA is the government's agency: labelled state media
    expect(src('sana-sy-ar')).toMatchObject({ biasLabel: 'state-media' })
    expect(src('sana-sy-ar').reliability).toBeLessThan(0.6)
    expect(src('sana-sy-ar').extraTags).toContain('state-media')
  })

  it("pins The Royal Gazette's placeless headlines in Bermuda", () => {
    expect(at('royal-gazette-bm', 'Payroll taxes to be cut as bigger budget surplus is forecast').countryCode).toBe('BM')
  })
})

describe("Syria's and Bahrain's Arabic headlines", () => {
  it("reads Syria's other cities", () => {
    expect(at('sana-sy-ar', 'الزراعة بالبيوت البلاستيكية في ريف حماة زراعة واعدة توفر المحاصيل على مدار العام').locationName).toBe('Hama')
    expect(at('syria-tv-ar', 'قصف إسرائيلي يستهدف ريف القنيطرة وتوغل في وادي الرقاد بريف درعا').locationName).toBe('Quneitra')
    expect(at('syria-tv-ar', 'رفع حظر التجوال في البوكمال بعد اشتباكات عائلية والأمن يواصل الانتشار').locationName).toBe('Abu Kamal')
    // "حماة" is also protectors: an Egyptian party's name is not Hama
    expect(withLocalNames('حزب حماة الوطن يعقد مؤتمره السنوي', 'ar')).not.toMatch(/Hama/)
    // the Sulaymaniyya Takiyya is a Damascus mosque, not Iraq's Sulaymaniyah
    expect(at('sana-sy-ar', 'إقامة أول صلاة جمعة في مسجد التكية السليمانية بدمشق بعد 15 عاماً من الانقطاع').locationName).toBe('Damascus')
  })

  it('reads Israel with its hamza, and the countries the world news names', () => {
    // "الإسرائيلية" is "الاسراييلية" once its hamzas are dropped: it named no place before
    expect(at('al-bilad-bh-ar', 'آيزنكوت: تقدم كبير في مشاورات تشكيل الحكومة الإسرائيلية').countryCode).toBe('IL')
    expect(at('al-bilad-bh-ar', 'مرشح لرئاسة حكومة إسبانيا يرفض إقامة نهائي المونديال بالمغرب').countryCode).toBe('ES')
    expect(at('sana-sy-ar', 'بلجيكا تقر قانوناً يسمح بتفتيش منازل مهاجرين غير شرعيين').countryCode).toBe('BE')
  })

  it('puts a story in the country it happened in ("في", in), as in English', () => {
    expect(at('syria-tv-ar', 'ملاحقة قضائية للاجئ سوري في بلجيكا.. والنيابة تطالب بسجنه 18 شهرا').countryCode).toBe('BE')
    expect(at('syria-tv-ar', 'السجن 10 سنوات لأب سوري في النمسا بعد إدانته بتعنيف أبنائه الثلاثة').countryCode).toBe('AT')
  })

  it("reads a club named after a city as sport, not the city's news", () => {
    expect(at('al-bilad-bh-ar', '"تغير شيء ما".. ريال مدريد يدرس مورفولوجيا جسد فينيسيوس').countryCode).toBeNull()
  })
})

describe("Ikon.mn's Mongolian headlines", () => {
  it("reads Mongolia's provinces, also beside a donor's country", () => {
    const grant = at('ikon-mn', 'Японы ЗГ-ын буцалтгүй тусламжаар Булган аймгийн Хутаг-Өндөр сумын Эрүүл мэндийн төвийн хэвтэн эмчлүүлэх байрыг шинэчиллээ')
    expect(grant).toMatchObject({ countryCode: 'MN', locationName: 'Bulgan' })
    expect(at('ikon-mn', 'Архангай аймгийн Төвшрүүлэх суманд 4.6 магнитудын хүчтэй газар хөдөллөө').locationName).toBe('Arkhangai')
    expect(at('ikon-mn', 'Ц.Бямбасүрэн: Ачааны машины даацыг 44 тонноос хэтрүүлэхгүй байхыг уриалж байна').countryCode).toBe('MN')
  })

  it('reads the countries its world news names, in their cases', () => {
    expect(at('ikon-mn', 'Испанийн хөлбөмбөгийн ертөнц гашуудаж байна').countryCode).toBe('ES')
    expect(at('ikon-mn', 'Их Британийн шүүх жүжигчин Рассел Брэндийг хүчин, бэлгийн хүчирхийллийн хэрэгт буруутгалаа').countryCode).toBe('GB')
    expect(at('ikon-mn', 'Банк дампуурсны дараа Трампын холбоотон, Парагвай улсын ерөнхийлөгч албан тушаалаасаа огцров').countryCode).toBe('PY')
    expect(at('ikon-mn', 'Рио Тинто компани Аргентинд нийт $1.4 тэрбумын хөрөнгө оруулалттай литийн төслүүдээ нээжээ').countryCode).toBe('AR')
    expect(at('ikon-mn', 'Өвөр Монголын Хөх хотод болсон үзэсгэлэн').countryCode).toBe('CN')
  })

  it('keeps a language, and everyday words that are also names, from reading as a place', () => {
    expect(at('ikon-mn', 'Монгол хэл бичгийн 2026 оны өвлийн шалгалт арванхоёрдугаар сарын 19-нд болно').countryCode).toBe('MN')
    expect(withLocalNames('Орос хэлний багш нарын зөвлөгөөн', 'mn')).not.toMatch(/Russia/)
    expect(withLocalNames('Ерөнхий сайд Хятадад хэлсэн үгэндээ', 'mn')).toMatch(/China/)
    expect(withLocalNames('булган малгай, эрүүл мэндийн төвийн байр', 'mn')).not.toMatch(/Bulgan|Tov/)
    expect(withLocalNames('Дорнод Азийн орнуудын уулзалт', 'mn')).not.toMatch(/Dornod/)
    expect(withLocalNames('Төв аймгийн Зуунмод хотод', 'mn')).toMatch(/Tov Province/)
  })
})
