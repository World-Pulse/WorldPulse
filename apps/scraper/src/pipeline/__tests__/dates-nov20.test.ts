/**
 * Dates, weekdays and "today" in the reader's other languages (Nov 20, 2026). Of the 30 "different event" cross-check
 * verdicts on the morning of Nov 20, a third were two headlines of one day that shared little but the date, written
 * in Spanish, Italian, French, Arabic, Turkish or Vietnamese: takeDates read English month names only, so a day and a
 * year counted as two shared numbers and the month and the weekday as two shared words.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})

const { takeForeignDates, takeDates, numericDate, foldAccents, westernDigits, storyWords, searchWords, isSameStory, indicStem, arabicStem } =
  await import('../correlate')
type Candidate = Parameters<typeof isSameStory>[0]

const dates = (title: string) => takeForeignDates(foldAccents(westernDigits(title))).dates
const at = (source_id: string, title: string, category = 'economy'): Candidate => ({
  id: source_id, title, category, severity: 'low', source_id, location_name: null, lat: null, lng: null,
  published_at: '2026-11-20T12:00:00Z', reliability_score: 0.7, tags: [],
})

describe('dates in the other languages are one word', () => {
  it('reads a day and its month, with or without the year', () => {
    expect(dates('Dólar blue hoy: a cuánto opera este viernes 20 de noviembre')).toEqual(['~11-20'])
    expect(dates('Precio del dólar hoy 20 de noviembre de 2026')).toEqual(['~11-20'])
    expect(dates('Suivez Matinale.Sn de ce Vendredi 20 Novembre 2026')).toEqual(['~11-20'])
    expect(dates('Meteo Lombardia weekend: le previsioni dal 20 al 22 novembre')).toEqual(['~11-20'])
    expect(dates('Streik am 20. November 2026')).toEqual(['~11-20'])
    expect(dates('Hoje, 20 de novembro, Dia da Consciência Negra')).toEqual(['~11-20'])
    expect(dates('Altın fiyatları 20 Kasım 2026 Cuma')).toEqual(['~11-20'])
    expect(dates('Harga emas hari ini 20 November 2026')).toEqual(['~11-20'])
    expect(dates('Akcja 20 listopada 2026')).toEqual(['~11-20'])
    expect(dates('Vijesti, 20. studenoga 2026.')).toEqual(['~11-20'])
    expect(dates('Labari, 20 ga Nuwamba 2026')).toEqual(['~11-20'])
    expect(dates('Prezident 20-noyabr kuni')).toEqual(['~11-20'])
    expect(dates("Festa del 20 d'agost")).toEqual(['~8-20'])
    expect(dates('أسعار الدواجن اليوم الجمعة 20 نوفمبر 2026')).toEqual(['~11-20'])
    expect(dates('20 ноября 2026 года в Москве')).toEqual(['~11-20'])
    expect(dates('20 листопада у Києві')).toEqual(['~11-20'])
    expect(dates('Σεισμός στις 20 Νοεμβρίου 2026')).toEqual(['~11-20'])
    expect(dates('आज का राशिफल 20 नवंबर 2026')).toEqual(['~11-20'])
    expect(dates('২০ নভেম্বর ২০২৬ শুক্রবার')).toEqual(['~11-20'])
    expect(dates('ราคาทอง 20 พฤศจิกายน 2569')).toEqual(['~11-20'])
  })

  it('reads the month first where a language writes it so', () => {
    expect(dates('Ülés október 20.')).toEqual(['~10-20'])
    expect(dates('2026. szeptember 20-án')).toEqual(['~9-20'])
    expect(dates('Balita: Nobyembre 20, 2026')).toEqual(['~11-20'])
    // a count after a month is not a day
    expect(dates('En mayo 15 personas murieron')).toEqual([])
  })

  it("reads Vietnamese's, Chinese's, Japanese's and Korean's dates, and numbers", () => {
    expect(dates('Lãi suất ngân hàng hôm nay 20/11')).toEqual(['~11-20'])
    expect(dates('Giá vàng ngày 20 tháng 11 năm 2026')).toEqual(['~11-20'])
    expect(dates('2026年11月20日の政府発表')).toEqual(['~11-20'])
    expect(dates('11월 20일 정부 발표')).toEqual(['~11-20'])
    expect(dates('20日、政府は')).toEqual(['~d20'])
    expect(dates('日本20日本')).toEqual([])  // (not "日本", Japan)
    expect(dates('أسعار الكتاكيت اليوم 20-11-2026')).toEqual(['~11-20'])
  })

  it("reads Iran's and Afghanistan's solar months as their own", () => {
    expect(dates('قیمت طلا امروز ۲۹ آبان ۱۴۰۵')).toEqual(['~sh8-29'])
    expect(dates('۲۹ عقرب ۱۴۰۵')).toEqual(['~sh8-29'])
  })

  it('reads a day after a weekday, in brackets or ending a phrase, as a day', () => {
    expect(dates('Polícia prende suspeito nesta sexta-feira (20)')).toEqual(['~d20'])
    expect(dates('Operação da PF nesta sexta (20)')).toEqual(['~d20'])
    expect(dates('Huelga el próximo viernes 20')).toEqual(['~d20'])
    // not a toll after a weekday
    expect(dates('Ataque deja el martes 3 muertos')).toEqual([])
    expect(storyWords('Ataque deja el martes 3 muertos').has('#3')).toBe(true)
  })

  it('leaves decimals, counts and names alone', () => {
    expect(dates('Sismo de magnitud 6.2 y 6,2 en Chile')).toEqual([])
    expect(dates('20.11 results')).toEqual([])
    expect(dates('Inflation at 12.5%')).toEqual([])
    expect(dates('Marco 20 años después')).toEqual([])
    expect(dates('Kasım 20 yaşında')).toEqual([])
  })

  it('reads a date in numbers month first when the order shows', () => {
    expect(numericDate(20, 11)).toBe('~11-20')
    expect(numericDate(11, 20)).toBe('~11-20')
    expect(numericDate(5, 6)).toBe('~5-6')
    expect(numericDate(20, 20)).toBe('')
    expect(numericDate(40, 11)).toBe('')
    expect(takeDates('Ergebnisse vom 15.10.2026').dates).toEqual(['~10-15'])
    expect(takeDates('Horizons Middle East & Africa 10/15/2026 (Video)').dates).toEqual(['~10-15'])
  })
})

describe('weekdays, months and "today" are not story words', () => {
  it('in the Latin languages, and Turkish TV listings', () => {
    const es = storyWords('Dólar blue hoy: a cuánto opera este viernes 20 de noviembre')
    expect(es.has('~11-20')).toBe(true)
    expect([...es].some(w => ['hoy', 'viern', 'vierne', '#20', 'noviem'].includes(w))).toBe(false)
    const tr = storyWords('Galatasaray-Samsunspor maçı ne zaman, saat kaçta ve hangi kanalda? Galatasaray maçı şifresiz')
    expect([...tr].some(w => ['zaman', 'saat', 'kacta', 'hangi', 'kanald', 'sifres'].includes(w))).toBe(false)
    const fr = storyWords("Actualité du Sénégal : l'essentiel de ce vendredi 20 novembre 2026")
    expect([...fr].some(w => ['vendre', '#20', 'novemb', '#2026'].includes(w))).toBe(false)
  })

  it('in Arabic, Persian, Russian, Greek, Japanese and Hindi, whole', () => {
    const ar = storyWords('أسعار الدواجن اليوم الجمعة 20 نوفمبر 2026')
    expect(ar.has('~11-20')).toBe(true)
    expect([...ar].some(w => ['جمع', '#20', '#2026'].includes(w))).toBe(false)
    // an association, "جمعية", is still a word (Friday's stem is its too)
    expect(storyWords('جمعية خيرية توزع المساعدات في غزة').has(arabicStem('جمعية'))).toBe(true)
    // Persian's Tuesday is not three
    const fa = storyWords('قیمت طلا امروز سه‌شنبه ۲۹ آبان ۱۴۰۵')
    expect(fa.has('~sh8-29')).toBe(true)
    expect([...fa].some(w => ['#3', '#29', '#1405'].includes(w))).toBe(false)
    const ru = storyWords('В пятницу, 20 ноября, в Москве прошёл митинг')
    expect(ru.has('~11-20')).toBe(true)
    expect([...ru].some(w => w.startsWith('пятниц') || w === '#20')).toBe(false)
    // a quarterfinal is still a word (Thursday's stem begins it)
    expect([...storyWords('Спартак вышел в четвертьфинал Кубка России')].some(w => w.startsWith('четвер'))).toBe(true)
    const el = storyWords('Απεργία την Παρασκευή 20 Νοεμβρίου στην Αθήνα')
    expect(el.has('~11-20') && ![...el].some(w => w.startsWith('παρασκευ'))).toBe(true)
    const ja = storyWords('11月20日（金曜日）政府発表 東京で地震')
    expect(ja.has('~11-20') && !ja.has('金曜') && !ja.has('曜日')).toBe(true)
    const hi = storyWords('आज का राशिफल 20 नवंबर 2026, शुक्रवार')
    expect(hi.has('~11-20') && !hi.has(indicStem('शुक्रवार'))).toBe(true)
    // Shankar is still a word (Friday's stem is his too)
    expect(storyWords('शिव शंकर मंदिर में पूजा').has(indicStem('शंकर'))).toBe(true)
  })

  it('and the title search looks for none of them, nor the year', () => {
    const words = searchWords('Dólar blue hoy: a cuánto opera este viernes 20 de noviembre de 2026')
    expect(words).toEqual(expect.arrayContaining(['dolar', 'opera']))
    expect(words.some(w => ['hoy', 'viernes', 'vierne', 'noviembre', 'noviem', '2026'].includes(w))).toBe(false)
    const ar = searchWords('أسعار الدواجن اليوم الجمعة 20 نوفمبر 2026')
    expect(ar.some(w => w.includes('جمع') || w.includes('نوفمبر') || w === '2026')).toBe(false)
  })
})

describe('the morning of Nov 20, 2026', () => {
  it('no longer joins two stories of one day by their date', () => {
    for (const [a, b] of [
      ['Precio del dólar en República Dominicana hoy, viernes 20 de noviembre: así abre el mercado', 'Dólar blue hoy: a cuánto opera este viernes 20 de noviembre'],
      ['F1 Las Vegas GP ne zaman, saat kaçta, hangi kanalda? Şifresiz mi, sıralama', 'Galatasaray-Samsunspor maçı ne zaman, saat kaçta ve hangi kanalda? Galatasaray maçı şifresiz'],
      ['Meteo Lombardia weekend: le previsioni dal 20 al 22 novembre. Arriva il freddo', 'Ecco cosa vedere nei cinema pugliesi nel weekend dal 20 al 22 novembre'],
      ['Suivez Matinale.Sn de ce Vendredi 20 Novembre 2026', "Actualité du Sénégal : l'essentiel de ce vendredi 20 novembre 2026"],
      ['أسعار الكتاكيت اليوم اليوم الجمعة 20-11-2026 في بورصة الدواجن', 'أسعار الدواجن البيضاء اليوم الجمعة 20 نوفمبر 2026 في المزارع والأسواق'],
      ['Lãi suất ngân hàng hôm nay 20/11: Mua 100 triệu chứng chỉ tiền gửi', 'Việt Nam có ngân hàng chỉ cho phép chuyển khoản tối đa 20 triệu/ngày'],
    ]) expect(isSameStory(at('one.example', a!), at('two.example', b!))).toBe(false)
  })

  it('still joins one story whose headlines share its date and more', () => {
    for (const [a, b] of [
      ['Sismo de magnitud 6,1 sacude Oaxaca este viernes 20 de noviembre', 'Fuerte sismo de magnitud 6,1 sacude Oaxaca el 20 de noviembre'],
      ['Grève à la SNCF : le trafic très perturbé ce vendredi 20 novembre', 'Grève SNCF du vendredi 20 novembre : trafic très perturbé sur les TER'],
      ["İstanbul'da 4,2 büyüklüğünde deprem: AFAD 20 Kasım açıklaması", "AFAD duyurdu: İstanbul'da 4,2 büyüklüğünde deprem (20 Kasım 2026)"],
      ['زلزال بقوة 5 درجات يضرب جنوب إيران اليوم الجمعة 20 نوفمبر', 'زلزال بقوة 5 درجات يهز جنوب إيران الجمعة 20 نوفمبر 2026'],
    ]) expect(isSameStory(at('one.example', a!, 'disaster'), at('two.example', b!, 'disaster'))).toBe(true)
  })
})
