/**
 * Nepali, Armenian, Bosnian, Uzbek, Kazakh, Swedish and Azerbaijani (Nov 19, 2026, night; Devon, 8:37 PM: "our goal is
 * to cover languages where readers are"): place names, the dead and injured and the kind of event, story matching in
 * Armenian and Kazakh, small words, and the second-outlet search in the languages GDELT translates.
 */
import { describe, it, expect, vi } from 'vitest'

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
const { waitingQuery, storyTokens, SEARCHED_LANGUAGES } = await import('../second-outlet')
const { TRANSLATED_LANGUAGES } = await import('../gdelt-articles')
const { otherScriptWords, foldAccents, searchWords, armenianStem } = await import('../correlate')
const { withLocalNames } = await import('../local-names')
const { NEWS_SOURCE_REGISTRY } = await import('../../sources/news-rss')

describe('place names', () => {
  it('reads each language\'s names with their endings', () => {
    expect(withLocalNames('काठमाडौंमा भारी वर्षा', 'ne')).toBe('Kathmandu भारी वर्षा')
    expect(withLocalNames('नेपाल र भारतबीच सीमा वार्ता', 'ne')).toBe('Nepal र India सीमा वार्ता')
    expect(withLocalNames('Երևանում բողոքի ակցիա', 'hy')).toBe('Yerevan բողոքի ակցիա')
    expect(withLocalNames('ԱՄՆ-ի պետքարտուղարը', 'hy')).toContain('United States')
    expect(withLocalNames('Nesreća u BiH: dvoje poginulih kod Mostara', 'bs')).toBe('Nesreća u Bosnia: dvoje poginulih kod Mostar')
    expect(withLocalNames('Toshkentda yangi metro bekati ochildi', 'uz')).toBe('Tashkent yangi metro bekati ochildi')
    expect(withLocalNames('O‘zbekiston va Qozog‘iston', 'uz')).toBe('Uzbekistan va Kazakhstan')
    expect(withLocalNames("O'zbekiston prezidenti", 'uz')).toBe('Uzbekistan prezidenti')
    expect(withLocalNames('Астанада жаңа мектеп ашылды', 'kk')).toBe('Astana жаңа мектеп ашылды')
    expect(withLocalNames('Ресей мен Қытай', 'kk')).toBe('Russia мен China')
    expect(withLocalNames('Sveriges regering och Norges', 'sv')).toBe('Sweden regering och Norway')
    expect(withLocalNames('Brand i Helsingfors', 'sv')).toBe('Brand i Helsinki')
    expect(withLocalNames('Bakıda yeni park açılıb', 'az')).toBe('Baku yeni park açılıb')
    expect(withLocalNames('İranla Azərbaycan arasında', 'az')).toBe('Iran Azerbaijan arasında')
  })

  it("leaves out the words that only look like a name", () => {
    // Azerbaijani "çinar" (a plane tree) is not China; Swedish "Vasa" is not read
    expect(withLocalNames('Bakıda çinar ağacları', 'az')).toBe('Baku çinar ağacları')
    expect(withLocalNames('Vasamuseet öppnar', 'sv')).toBe('Vasamuseet öppnar')
  })
})

describe('severity', () => {
  it('counts the dead and injured', () => {
    expect(foreignCasualties('बस दुर्घटनामा ५ जनाको मृत्यु, १२ जना घाइते', 'ne')).toMatchObject({ dead: 5, injured: 12 })
    expect(foreignCasualties('पहिरोमा मृतकको संख्या २३ पुग्यो', 'ne')?.dead).toBe(23)
    expect(foreignCasualties('Ավտովթարի հետևանքով 3 մարդ է զոհվել, 5-ը վիրավորվել են', 'hy')?.dead).toBe(3)
    expect(foreignCasualties('Պայթյունից զոհվել է 4 մարդ', 'hy')?.dead).toBe(4)
    expect(foreignCasualties('U sudaru kod Slunja poginule tri osobe', 'bs')?.dead).toBe(3)
    expect(foreignCasualties('Saobraćajna nesreća: 2 osobe povrijeđene', 'hr')?.injured).toBe(2)
    expect(foreignCasualties('Yo‘l-transport hodisasida 5 kishi halok bo‘ldi, 7 kishi jarohat oldi', 'uz')).toMatchObject({ dead: 5, injured: 7 })
    expect(foreignCasualties("Zilzilada kamida 12 nafar odam vafot etdi", 'uz')?.dead).toBe(12)
    expect(foreignCasualties('Жол апатынан 4 адам қаза тапты, 6 адам жарақат алды', 'kk')).toMatchObject({ dead: 4, injured: 6 })
    expect(foreignCasualties('Minst tre personer har omkommit i branden', 'sv')?.dead).toBe(3)
    expect(foreignCasualties('Israeliska attacker dödade 20 i Gaza, 40 personer skadades', 'sv')).toMatchObject({ dead: 20, injured: 40 })
    expect(foreignCasualties('Qəzada 2 nəfər həlak olub, 5 nəfər yaralanıb', 'az')).toMatchObject({ dead: 2, injured: 5 })
  })

  it("doesn't count numbers that aren't people", () => {
    expect(foreignCasualties('५ जनाको टोली भारत प्रस्थान', 'ne')?.dead).toBe(0)
    expect(foreignCasualties('Hayit bayramida 5 kishi qurbonlik qildi', 'uz')?.dead).toBe(0)
    expect(foreignCasualties('Regeringen satsar 20 miljoner på skolan', 'sv')?.dead).toBe(0)
  })

  it('rates serious news above low, everyday news low', () => {
    expect(rateSeverity('काठमाडौंमा बम विस्फोट', null, 'other', 'ne')).toBe('high')
    expect(rateSeverity('शिक्षकहरूको आन्दोलन जारी', null, 'politics', 'ne')).toBe('medium')
    expect(rateSeverity('नयाँ पुस्तकालय उद्घाटन', null, 'culture', 'ne')).toBe('low')
    expect(rateSeverity('Պայթյուն Երևանում', null, 'other', 'hy')).toBe('high')
    expect(rateSeverity('Toshkentda namoyish', null, 'politics', 'uz')).toBe('medium')
    expect(rateSeverity('Алматыда жер сілкінісі болды', null, 'other', 'kk')).toBe('medium')
    expect(rateSeverity('Sprängning i Malmö natten till fredag', null, 'other', 'sv')).toBe('high')
    expect(rateSeverity('Ny utställning på Moderna museet', null, 'culture', 'sv')).toBe('low')
    expect(rateSeverity('Bakıda yanğın baş verib', null, 'other', 'az')).toBe('medium')
    expect(rateSeverity('Eksplozija u Sarajevu', null, 'other', 'bs')).toBe('high')
  })
})

describe('story matching in Armenian and Kazakh', () => {
  it("reads an Armenian word by its stem, whatever its case", () => {
    expect(armenianStem('Երևանում')).toBe(armenianStem('Երևանի'))
    expect(armenianStem('Երեւանում')).toBe(armenianStem('Երևան'))
    expect(armenianStem('ընտրությունների')).toBe(armenianStem('ընտրություններ'))
    const a = otherScriptWords(foldAccents('Երևանում բողոքի ակցիա է անցկացվել կառավարության շենքի մոտ'))
    const b = otherScriptWords(foldAccents('Բողոքի ակցիա Երևանի կառավարության շենքի մոտ'))
    expect(a.filter(w => b.includes(w)).length).toBeGreaterThanOrEqual(4)
    expect(searchWords('Երևանում բողոքի ակցիա')).toContain(armenianStem('Երևանում'))
  })

  it("takes a Kazakh word's endings off", () => {
    const a = otherScriptWords(foldAccents('Астанадағы өрт: қаланың орталығында тұрғын үй жанды'))
    const b = otherScriptWords(foldAccents('Астанада тұрғын үйде өрт шықты'))
    expect(a.filter(w => b.includes(w)).length).toBeGreaterThanOrEqual(2)
  })
})

describe('the search in these languages', () => {
  it("reads GDELT's translated list in Nepali, Armenian and Swedish and searches their waiting reports", () => {
    expect(TRANSLATED_LANGUAGES).toMatchObject({ nep: 'ne', hye: 'hy', arm: 'hy', swe: 'sv' })
    const { sql } = waitingQuery([], new Date('2026-11-20T04:00:00Z'))
    for (const lang of ['ne', 'hy', 'sv']) expect(sql).toContain(`'${lang}'`)
    for (const lang of new Set(Object.values(TRANSLATED_LANGUAGES))) expect(SEARCHED_LANGUAGES).toContain(lang)
  })

  it('leaves out their small words, and reads Uzbek with any of its marks', () => {
    expect(storyTokens('Regeringen och oppositionen enligt nya uppgifter', 'sv')).not.toContain('enligt')
    expect(storyTokens('Prezident bilan uchrashuv boʻyicha', 'uz')).not.toContain('bilan')
    expect(storyTokens('Oʻzbekiston', 'uz')).toEqual(storyTokens("O'zbekiston", 'uz'))
    expect(storyTokens('Prezident Bakıda bildirib', 'az')).not.toContain('bildirib')
    expect(storyTokens('Vlada je rekla kako ce nova zgrada biti gotova', 'bs')).not.toContain('kako')
  })
})

describe("the round's feeds", () => {
  it('reads each new language from three or more outlets', () => {
    for (const lang of ['ne', 'hy', 'bs', 'uz', 'kk', 'sv', 'az']) {
      expect(NEWS_SOURCE_REGISTRY.filter(s => s.language === lang).length, lang).toBeGreaterThanOrEqual(3)
    }
  })

  it('marks state media and keeps their reliability below 0.6', () => {
    for (const id of ['khabar-24kz', 'voice-of-nigeria']) {
      const src = NEWS_SOURCE_REGISTRY.find(s => s.id === id)
      expect(src?.biasLabel, id).toBe('state-media')
      expect(src!.reliability, id).toBeLessThan(0.6)
    }
  })
})
