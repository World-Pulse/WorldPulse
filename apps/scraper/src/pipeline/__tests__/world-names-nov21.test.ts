/**
 * Names in every language (Nov 21, 2026; Devon, 10:39 AM: "Proceed"): a headline in another language than English is
 * read for the people, places and organisations its own language names them by, as the rules name them. The headlines
 * are the day's (Nov 20-21), from the two hand checks: those it reads, and the mistakes the checks found, which it no
 * longer makes.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK'), on: vi.fn() } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { namesInTitle, normName, endingOk, MAX_NAMES } from '../world-names'
import { ownLanguageNames } from '../insert-signal'

const names = (title: string, lang: string) => namesInTitle(title, lang).map(e => `${e.type}:${e.name}`).sort()

describe('names in the headline’s own language', () => {
  it('reads countries, cities and people in their own scripts and with their own endings', () => {
    expect(names('HELLENiQ ENERGY: Διευρύνει το ενεργειακό της χαρτοφυλάκιο στη Ρουμανία', 'el')).toEqual(['location:Romania'])
    expect(names('Півтора року розлуки та втеча від бабусі: як 12-річну Валерію вдалося повернути з Італії', 'uk')).toEqual(['location:Italy'])
    expect(names('VIDEO ⟩ Ukraina ar droniem Krievijā veikusi triecienu ķīmijas nozares uzņēmumam', 'lv')).toEqual(['location:Russia', 'location:Ukraine'])
    expect(names('30 تاجراً ماليزياً يقطعون 10 ساعات لعرض منتجاتهم بالبحرين', 'ar')).toEqual(['location:Bahrain'])
    expect(names('3 سيناريوهات أمام آيزنكوت لتشكيل الحكومة.. هل يعود نتنياهو؟', 'ar')).toEqual(['person:Benjamin Netanyahu'])
    expect(names('Trump, Şi ve Putin Başkan Erdoğan’ın dediğine geldi! 4 maddelik deklarasyonda sürpriz', 'tr')).toEqual(['person:Recep Tayyip Erdoğan'])
    expect(names('Türkiye’nin ilk insansız savaş uçağı KIZILELMA envantere girdi', 'tr')).toEqual(['location:Turkey'])
    expect(names('Մայր Աթոռում պահվող «Լուսավորչի տեսիլքը»` առաջին անգամ Հայաստանի ազգային պատկերասրահում', 'hy')).toEqual(['location:Armenia'])
    expect(names('ஹென்றி நிக்கோல்ஸ், கிளென் பிலிப்ஸ் சதம்; நியூசிலாந்து 368 ரன்களுக்கு ஆல் அவுட்', 'ta')).toEqual(['location:New Zealand'])
    expect(names('Angelina Jolie otputovala u Kambodžu nakon prodavanja imanja u Los Angelesu: Želi živjeti više kao nomad', 'bs'))
      .toEqual(['location:Cambodia', 'location:Los Angeles'])
    expect(names('Deutsch Tamás szerint Orbán Viktor nélkül nincs Fidesz, a vereséget nem a korrupció okozta', 'hu')).toEqual(['person:Viktor Orbán'])
    expect(names('Trump on India: ‘ভারতকে দেখুন…’, আমেরিকার নীতিকে দোষারোপ করে ভারতের ভূয়সী প্রশংসায় ট্রাম্প', 'bn')).toEqual(['location:India', 'location:United States'])
    // a name and a country's: the country ("Бразилии" is Brazil, not Brasília)
    expect(names('Экс-президента Бразилии Болсонару госпитализировали', 'ru')).toEqual(['location:Brazil'])
  })

  it('reads the languages written without spaces, the longest name first', () => {
    expect(names('名古屋市天白区の市道に倒れていた男性、搬送後に死亡　死亡ひき逃げ事件か、現場周辺に車の部品', 'ja')).toEqual(['location:Nagoya'])
    expect(names('特朗普晤普京熱情稱「我朋友」　澤連斯基被問看法　苦笑聳肩離去', 'zh')).toEqual(['person:Donald Trump', 'person:Vladimir Putin'])
    expect(names('[올댓차이나] 홍콩 증시, 美 반도체주 약세에 나흘째 속락 마감… H주 1.77%↓', 'ko')).toEqual(['location:Hong Kong'])
  })

  it('reads a city without its "city", as headlines write it, and leaves out the ones that are words or other names', () => {
    expect(names('馬斯克結束深圳APEC快閃上海工廠　讚超級工廠製造實力兼慰問員工', 'zh')).toEqual(['location:Shanghai', 'location:Shenzhen', 'person:Elon Musk'])
    expect(names('「声がでかいんだよ」マッサージ店で従業員に刃物突きつけ財布など奪って逃走か　51歳の男逮捕　東京・板橋区', 'ja')).toEqual(['location:Tokyo'])
    expect(names('‘준법투쟁’에도 잘 달린 서울 지하철…선로 장애에 출근길 \'삐걱\'', 'ko')).toEqual(['location:Seoul'])
    // Hokkaido, China Eastern Airlines, Texas: no Beihai, Dongfang or Dezhou
    expect(names('北海道甜點出事！', 'zh')).toEqual([])
    expect(names('中国东方航空股份公布业绩', 'zh')).toEqual(['location:China'])
    // Tokyo's Itabashi ward is no Banqiao
    expect(names('東京・板橋区で火事', 'ja')).toEqual(['location:Tokyo'])
    expect(names('德州州长签署法案', 'zh')).toEqual([])
    // Hideki Matsuyama's place in the ranking is no Matsuyama story
    expect(names('松山は３２位', 'ja')).toEqual([])
  })

  it('reads a few codes, as written', () => {
    expect(names('Aderarea Ucrainei la NATO, abordată în întâlniri cu ușile închise: scenariile luate în calcul de SUA', 'ro'))
      .toEqual(['location:Ukraine', 'location:United States', 'organisation:NATO'])
    expect(names('Junge Menschen profitieren: EU und Großbritannien nähern sich wieder an', 'de')).toEqual(['location:United Kingdom', 'organisation:EU'])
    expect(names('Un bébé de 14 mois oublié dans une crèche fermée, il est retrouvé seul en train de pleurer', 'fr')).toEqual([])
    expect(names('»Ude af proportioner«: De første mange måneder af året får de her nordsjællændere kun begrænset glæde', 'da')).toEqual([])
    expect(names('MONEY AND STOCK MARKET REVIEW วันที่ 16-20 พฤศจิกายน 2569', 'th')).toEqual([])
  })

  it('leaves out the everyday words, endings and names the hand checks found read as places', () => {
    expect(names('Macaulay Culkin va reveni într-un nou film „Singur acasă”, produs de Seth Rogen și Evan Goldberg', 'ro')).toEqual([])
    expect(names('इलाज के लिए नन्हे हाथी का एयरलिफ्ट: असम से जामनगर पहुंचाया गया, अनंत अंबानी की मदद से वनतारा में होगा इलाज', 'hi')).toEqual(['location:Jamnagar'])
    expect(names('Jaga Status Emerging Market, Pemerintah Diminta Percepat Reformasi Bursa', 'id')).toEqual([])
    expect(names('Kejagung Periksa Mantan Wali Kota Bekasi terkait Dugaan Korupsi Tata Kelola KSO Migas', 'id')).toEqual([])
    expect(names('阿曼達塞佛瑞的「石上鳥」項鍊飛抵台灣！TIFFANY珠寶展登台、4億紅鑽成焦點', 'zh')).toEqual([])
    expect(names('元BOØWY高橋まこと氏、タイトル獲得へ', 'ja')).toEqual([])
    expect(names('수능 커닝 대책 본 노량진 사람들…"안 걸린게 더 많을 듯"', 'ko')).toEqual([])
    expect(names('الربح السريع يغري الشباب… ثروة على الشاشة وخسائر في الواقع!', 'ar')).toEqual([])
    expect(names('(SPREMLJAMO) Slovenski nogometaši v pričakovanju tekmeca', 'sl')).toEqual([])
    expect(names('Ηράκλειο: Την Κυριακή το ετήσιο μνημόσυνο – «Κάνουμε υπομονή και περιμένουμε απαντήσεις»', 'el')).toEqual([])
    expect(names('Мединский поздравил патриарха Кирилла с 80-летием', 'ru')).toEqual([])
    expect(names('‘ఇండియా’కు దారి చూపిన ఓట్‌ చోరీ', 'te')).toEqual([])
  })

  it("reads a place's name beside a person's or a club's as theirs", () => {
    expect(names('Dominique de Villepin annonce sa candidature à l’élection présidentielle française de 2027', 'fr')).toEqual([])
    expect(names('Caso Melissa Medina | Policía revela videos y dice entrevistó un vigilante: ¿y sobre Eliezel Salvador?', 'es')).toEqual([])
    expect(names('Régen várt biztató hírek Szoboszlai Dominikről a Liverpool–Manchester United rangadó előtt', 'hu')).toEqual([])
    expect(names('Bayern de Munique: Harry Kane deixa jogo com dores após lance com defensor', 'pt')).toEqual([])
    expect(names('Montenegro: "Nas próximas eleições PS e Chega vão continuar a lutar pelo segundo lugar"', 'pt')).toEqual([])
    // ...but not across a colon: "Etats-Unis : Trump..." names the United States
    expect(names('Etats-Unis : Trump adoube Miller comme futur président, gros tacle à Rubio et Vance', 'fr')).toEqual(['location:United States'])
  })

  it('reads nothing in English (the rules do), and at most MAX_NAMES a headline', () => {
    expect(names('Russian strikes hit Kyiv as Zelensky meets Macron in Paris', 'en')).toEqual([])
    expect(namesInTitle('Russian strikes hit Kyiv', null)).toEqual([])
    expect(namesInTitle('美国之音中文广播 特朗普将待新年过后再就有关伊朗的选项作决定；普京誓言报复后，俄军袭击导致乌克兰8人死亡，基辅桥梁遇袭', 'zh')).toHaveLength(MAX_NAMES)
  })

  it('compares words as the table holds them, endings as each language writes them', () => {
    expect(normName('ΑΘΗΝΑΣ')).toBe('αθηνασ')
    expect(normName('Großbritannien’s')).toBe("grossbritannien's")
    expect(endingOk('москвы', 'москва', 'ru')).toBe(true)
    expect(endingOk('polsce', 'polska', 'pl')).toBe(false)   // a changed consonant: not read (Polska's "w Polsce" is missed, never misread)
    expect(endingOk('budapesten', 'budapest', 'hu')).toBe(true)
    expect(endingOk("ankara'da", 'ankara', 'tr')).toBe(true)
    expect(endingOk('macaulay', 'macau', 'ro')).toBe(false)
    expect(endingOk('بالبحرين', 'البحرين', 'ar')).toBe(true)
    expect(endingOk('المجردة', 'المجر', 'ar')).toBe(false)
  })
})

describe('the names a report gets', () => {
  it("adds the names in its own language that the rules didn't find", () => {
    const found = [{ name: 'Ukraine', type: 'location' }]
    expect(ownLanguageNames('Aderarea Ucrainei la NATO, abordată în întâlniri cu ușile închise: scenariile luate în calcul de SUA', 'ro', found)
      .map(e => `${e.type}:${e.name}`).sort()).toEqual(['location:United States', 'organisation:NATO'])
    expect(ownLanguageNames('Russian strikes hit Kyiv', 'en', [])).toEqual([])
  })
})
