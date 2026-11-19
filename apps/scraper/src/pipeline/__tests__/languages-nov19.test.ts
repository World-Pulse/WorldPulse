/**
 * The second-outlet search in the languages of the most populous countries' own press (Nov 19, 2026; Devon, 5:33 PM:
 * "Proceed with 1-3 / More local language coverage"). Hindi, Bengali, Marathi, Tamil, Telugu, Vietnamese, Indonesian,
 * Turkish, Italian, Polish, Dutch, Romanian and Ukrainian reports were rated low unless their feed called them
 * fighting or a disaster, because no severity rules read them, so the search (medium and above) never looked for their
 * second outlet; and the languages of India's own scripts had no words story-matching could compare. GDELT's
 * translated list is read in them too (its 22:45 UTC file of Nov 19 held 80 Turkish, 60 Italian, 51 Romanian, 27 Dutch,
 * 18 Vietnamese, 11 Ukrainian, 8 Hindi and 8 Indonesian articles).
 */
import { describe, it, expect, vi } from 'vitest'
import type { HeldReport } from '../second-outlet'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})
vi.mock('../crosscheck', () => ({ crossCheckLater: vi.fn() }))

const { rateSeverity } = await import('../severity')
const { foreignCasualties } = await import('../severity-languages')
const { otherOutlets, waitingQuery, storyTokens, SEARCHED_LANGUAGES } = await import('../second-outlet')
const { TRANSLATED_LANGUAGES, siteOf } = await import('../gdelt-articles')
const { westernDigits, otherScriptWords, foldAccents, searchWords } = await import('../correlate')
const { withLocalNames } = await import('../local-names')

describe('severity in the new languages', () => {
  it('counts the dead and injured', () => {
    expect(foreignCasualties('सड़क हादसे में 5 लोगों की मौत, 12 घायल', 'hi')).toMatchObject({ dead: 5, injured: 12 })
    expect(foreignCasualties('बस खाई में गिरी, ७ यात्रियों की मौत', 'hi')?.dead).toBe(7)
    expect(foreignCasualties('সড়ক দুর্ঘটনায় নিহত ৩, আহত ১০', 'bn')).toMatchObject({ dead: 3, injured: 10 })
    expect(foreignCasualties('ট্রেন দুর্ঘটনায় ৫ জন নিহত', 'bn')?.dead).toBe(5)
    expect(foreignCasualties('अपघातात ४ जणांचा मृत्यू, ६ जखमी', 'mr')).toMatchObject({ dead: 4, injured: 6 })
    expect(foreignCasualties('விபத்தில் 6 பேர் பலி', 'ta')?.dead).toBe(6)
    expect(foreignCasualties('రోడ్డు ప్రమాదంలో 8 మంది మృతి', 'te')?.dead).toBe(8)
    expect(foreignCasualties('Lũ quét ở Lào Cai: 12 người chết, 5 người bị thương', 'vi')).toMatchObject({ dead: 12, injured: 5 })
    expect(foreignCasualties('Banjir bandang, sedikitnya 15 orang tewas', 'id')?.dead).toBe(15)
    expect(foreignCasualties('Korban tewas bertambah menjadi 23', 'id')?.dead).toBe(23)
    expect(foreignCasualties('Otobüs devrildi: en az 9 kişi hayatını kaybetti, 20 kişi yaralandı', 'TR'.toLowerCase())).toMatchObject({ dead: 9, injured: 20 })
    expect(foreignCasualties('Crollo a Napoli, 3 morti e 10 feriti', 'it')).toMatchObject({ dead: 3, injured: 10 })
    expect(foreignCasualties('Wypadek autokaru: zginęło co najmniej 6 osób', 'pl')?.dead).toBe(6)
    expect(foreignCasualties('Busongeluk in Duitsland: 4 doden en 30 gewonden', 'nl')).toMatchObject({ dead: 4, injured: 30 })
    expect(foreignCasualties('Accident pe DN1: 3 morți și 7 răniți', 'ro')).toMatchObject({ dead: 3, injured: 7 })
    expect(foreignCasualties('Росіяни вдарили по Дніпру: загинули 5 людей, поранено 18', 'uk')).toMatchObject({ dead: 5, injured: 18 })
  })

  it("doesn't count a budget, a victim of fraud or any verb's object as the dead", () => {
    expect(foreignCasualties('Il bilancio 2027 approvato con 5 voti di scarto', 'it')?.dead).toBe(0)
    expect(foreignCasualties('5 vittime di truffa online a Torino', 'it')?.dead).toBe(0)
    expect(foreignCasualties('Bilanțul a 5 ani de guvernare', 'ro')?.dead).toBe(0)
    expect(foreignCasualties('Làm 2 việc cùng lúc để kiếm sống', 'vi')?.dead).toBe(0)
    expect(foreignCasualties('Jumlah penduduk bertambah menjadi 5 juta', 'id')?.dead).toBe(0)
  })

  it('rates serious news above low', () => {
    expect(rateSeverity('सड़क हादसे में 5 लोगों की मौत', null, 'other', 'hi')).toBe('high')
    expect(rateSeverity('पाकिस्तान में आत्मघाती हमला', null, 'security', 'hi')).toBe('high')
    expect(rateSeverity('किसानों का विरोध प्रदर्शन जारी', null, 'politics', 'hi')).toBe('medium')
    expect(rateSeverity('ঢাকায় সংঘর্ষ, গ্রেপ্তার ২০', null, 'politics', 'bn')).toBe('medium')
    expect(rateSeverity('चेन्नईत चक्रीवादळ', null, 'other', 'mr')).toBe('high')
    expect(rateSeverity('சென்னையில் நிலநடுக்கம்', null, 'other', 'ta')).toBe('medium')
    expect(rateSeverity('హైదరాబాద్‌లో భారీ వరద', null, 'other', 'te')).toBe('medium')
    expect(rateSeverity('Không kích Israel nhắm vào Gaza', null, 'other', 'vi')).toBe('high')
    expect(rateSeverity('Demo mahasiswa di depan DPR ricuh', null, 'politics', 'id')).toBe('medium')
    expect(rateSeverity('İstanbul\'da deprem: 5,1 büyüklüğünde', null, 'other', 'tr')).toBe('medium')
    expect(rateSeverity('Sciopero dei treni venerdì', null, 'economy', 'it')).toBe('medium')
    expect(rateSeverity('Atak dronów na Lwów', null, 'other', 'pl')).toBe('medium')
    expect(rateSeverity('Explosie in Rotterdam', null, 'other', 'nl')).toBe('high')
    expect(rateSeverity('Cutremur puternic în Vrancea', null, 'other', 'ro')).toBe('medium')
    expect(rateSeverity('Масована атака дронів на Київ', null, 'other', 'uk')).toBe('high')
  })

  it("leaves everyday news low, and doesn't read a box-office hit or a politician's comment as a blast or an opinion", () => {
    expect(rateSeverity('बॉक्स ऑफिस पर फिल्म का धमाका', null, 'culture', 'hi')).not.toBe('high')
    expect(rateSeverity('नई ट्रेन सेवा शुरू', null, 'other', 'hi')).toBe('low')
    expect(rateSeverity('ঢাকায় নতুন বইমেলা শুরু', null, 'culture', 'bn')).toBe('low')
    expect(rateSeverity('Ra mắt mẫu điện thoại mới', null, 'technology', 'vi')).toBe('low')
    expect(rateSeverity('Harga emas hari ini naik', null, 'economy', 'id')).toBe('low')
    expect(rateSeverity('Yeni eylem planı açıklandı', null, 'politics', 'tr')).toBe('low')
    expect(rateSeverity('Nuova mostra a Firenze', null, 'culture', 'it')).toBe('low')
    expect(rateSeverity('ஸ்டாலின் கருத்து: 5 பேர் பலி', null, 'other', 'ta')).toBe('high')
  })
})

describe('words of the Indian scripts, for story matching', () => {
  it('reads their digits as digits', () => {
    expect(westernDigits('५ लोगों की मौत, ১২ জন আহত, ௭')).toBe('5 लोगों की मौत, 12 জন আহত, 7')
  })

  it('reads a word without its vowel signs and endings, and leaves out the little words', () => {
    const words = (t: string) => otherScriptWords(foldAccents(t))
    expect(words('दिल्ली में हमला')).toEqual(words('दिल्ली हमले'))
    expect(words('சென்னையில் தாக்குதல்')).toEqual(words('சென்னை தாக்குதலில்'))
    expect(words('ঢাকায় সংঘর্ষ')).toEqual(words('ঢাকার সংঘর্ষে'))
    expect(words('भारतात पाऊस')).toEqual(words('भारत पाऊस'))
    expect(words('በአዲስ አበባ')).toEqual(words('አዲስ አበባ'))
    expect(words('और यह भी')).toEqual([])
    expect(storyTokens('मुंबई में भारी बारिश, 5 लोगों की मौत', 'hi')).toContain('मबई')
  })

  it("searches the database by a word's letters up to its first virama, where its word index may break it", () => {
    expect(searchWords('दिल्ली में भारी बारिश')).toEqual(['दिल', 'भारी', 'बारिश'])
    expect(searchWords('சென்னையில் கனமழை')).toEqual(expect.arrayContaining(['சென', 'கனமழை']))
  })

  const AT = new Date('2026-11-19T10:00:00Z')
  const LATER = new Date(AT.getTime() + 3 * 3_600_000)
  const held = (over: Partial<HeldReport>): HeldReport => ({
    id: 'sig', title: '', category: 'disaster', severity: 'medium', published_at: AT, original_urls: [], source_ids: [],
    location_name: null, lat: null, lng: null, tags: ['news', 'rss'], ...over,
  })
  const article = (url: string, title: string, lang: string) =>
    ({ url, title, site: siteOf(new URL(url).hostname), at: new Date(AT.getTime() + 2 * 3_600_000), lang })

  it("finds a Hindi report's second outlet in Hindi, not in another language", () => {
    const report = held({ id: 'sig-hi', language: 'hi', title: 'मुंबई में भारी बारिश, लोकल ट्रेन सेवा ठप', original_urls: ['https://www.amarujala.com/a/1'] })
    const other = 'भारी बारिश से थमी मुंबई की रफ्तार, लोकल ट्रेनें रुकीं'
    expect(otherOutlets(report, [article('https://www.jagran.com/b/2', other, 'hi')], LATER).map(f => f.site)).toEqual(['jagran.com'])
    expect(otherOutlets(report, [article('https://www.jagran.com/b/3', other, 'mr')], LATER)).toEqual([])
    // (an outlet's copy with a word or two changed is no second outlet)
    expect(otherOutlets(report, [article('https://www.jagran.com/b/5', 'मुंबई में भारी बारिश से लोकल ट्रेन सेवा ठप', 'hi')], LATER)).toEqual([])
    expect(otherOutlets(report, [article('https://www.jagran.com/b/4', 'दिल्ली में नई मेट्रो लाइन का उद्घाटन', 'hi')], LATER)).toEqual([])
  })

  it("finds a Vietnamese and a Turkish report's", () => {
    const vi = held({ id: 'sig-vi', language: 'vi', title: 'Lũ quét ở Lào Cai, 12 người chết', original_urls: ['https://vnexpress.net/a-1'] })
    expect(otherOutlets(vi, [article('https://tuoitre.vn/b-2', 'Lào Cai: 12 người thiệt mạng do lũ quét sau mưa lớn', 'vi')], LATER).map(f => f.site)).toEqual(['tuoitre.vn'])
    const tr = held({ id: 'sig-tr', language: 'tr', title: "Zonguldak Kilimli'de otomobil park halindeki araca çarptı, 61 yaşındaki kadın öldü", original_urls: ['https://www.sabah.com.tr/a'] })
    expect(otherOutlets(tr, [article('https://www.haberler.com/b', "Kilimli'de park halindeki araca çarpan otomobilin savurduğu kadın yaşamını yitirdi", 'tr')], LATER)
      .map(f => f.site)).toEqual(['haberler.com'])
  })
})

describe('the search in these languages', () => {
  it("reads GDELT's translated list in them", () => {
    expect(TRANSLATED_LANGUAGES).toMatchObject({
      hin: 'hi', ben: 'bn', mar: 'mr', tam: 'ta', tel: 'te', kan: 'kn', mal: 'ml', vie: 'vi', ind: 'id', tur: 'tr', ita: 'it',
      pol: 'pl', nld: 'nl', ron: 'ro', ukr: 'uk', dan: 'da', hrv: 'hr', bul: 'bg', mkd: 'mk',
    })
  })

  it('takes their waiting reports, and every translated language is searched', () => {
    const { sql } = waitingQuery([], new Date('2026-11-20T04:00:00Z'))
    for (const lang of ['hi', 'bn', 'ta', 'te', 'vi', 'id', 'tr', 'it', 'pl', 'nl', 'ro', 'uk']) expect(sql).toContain(`'${lang}'`)
    for (const lang of new Set(Object.values(TRANSLATED_LANGUAGES))) expect(SEARCHED_LANGUAGES).toContain(lang)
  })
})

describe('place names in the languages of India, Sindhi and Amharic', () => {
  it('reads them in English for the place-finder, endings and all', () => {
    expect(withLocalNames('சென்னையில் கனமழை', 'ta')).toBe('Chennai கனமழை')
    expect(withLocalNames('హైదరాబాద్‌లో భారీ వర్షం', 'te')).toContain('Telangana')
    expect(withLocalNames('ಬೆಂಗಳೂರಿನಲ್ಲಿ ಭಾರಿ ಮಳೆ', 'kn')).toBe('Bengaluru ಭಾರಿ ಮಳೆ')
    expect(withLocalNames('കൊച്ചിയിൽ കനത്ത മഴ', 'ml')).toBe('Kochi കനത്ത മഴ')
    expect(withLocalNames('पुण्यात मुसळधार पाऊस', 'mr')).toBe('Pune मुसळधार पाऊस')
    expect(withLocalNames('અમદાવાદમાં ભારે વરસાદ', 'gu')).toBe('Ahmedabad ભારે વરસાદ')
    expect(withLocalNames('ଭୁବନେଶ୍ୱରରେ ବର୍ଷା', 'or')).toBe('Bhubaneswar ବର୍ଷା')
    expect(withLocalNames('গুৱাহাটীত বৰষুণ', 'as')).toBe('Guwahati বৰষুণ')
    expect(withLocalNames('ڪراچيءَ ۾ مينهن', 'sd')).toContain('Karachi')
    expect(withLocalNames('በአዲስ አበባ ከባድ ዝናብ', 'am')).toBe('Addis Ababa ከባድ ዝናብ')
    // a name inside another word is no place: Srinivasan is not China
    expect(withLocalNames('சீனிவாசன் பேட்டி', 'ta')).toBe('சீனிவாசன் பேட்டி')
  })
})
