/**
 * Albanian and Serbian (Nov 11, 2026; Devon, Nov 10, 10:43 PM: "Yes" to "the Albanian and Serbian search for second
 * outlets" in Kosovo). Kosovo's 722 reports of the week, 705 of them Albanian and nearly all Lajmi.net's, had 19
 * verified: the severity rules didn't read Albanian, so every report was low, and Kosovo, with 19 verified, wasn't a
 * quiet place whose everyday reports are searched. Headlines from the live feeds and from GDELT's translated list of
 * Nov 10 (13:00 and 17:00 UTC), where Telegrafi, Zëri and Bota Sot write in Albanian, Politika, Blic and Tanjug in
 * Serbian, in Latin or Cyrillic letters.
 */
import { describe, it, expect, vi } from 'vitest'
import type { HeldReport } from '../second-outlet'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../crosscheck', () => ({ crossCheckLater: vi.fn() }))

const { rateSeverity } = await import('../severity')
const { foreignCasualties, serbianLatin, withoutAccents } = await import('../severity-languages')
const { otherOutlets, storyTokens, nearCopy, quietFrom, waitingQuery, QUIET_VERIFIED } = await import('../second-outlet')
const { TRANSLATED_LANGUAGES, siteOf } = await import('../gdelt-articles')

describe('severity in Albanian', () => {
  it('counts the dead and injured, with or without accents', () => {
    expect(rateSeverity('11 persona humbin jetën në një aksident në Bullgari', null, 'disaster', 'sq')).toBe('high')
    expect(rateSeverity('11 persona humbin jeten ne nje aksident ne Bullgari', null, 'disaster', 'sq')).toBe('high')
    expect(foreignCasualties('Tre të vdekur dhe katër të plagosur në një përplasje në Ferizaj', 'sq')).toMatchObject({ dead: 3, injured: 4 })
    expect(foreignCasualties('Vdesin dy persona në zjarrin e Mitrovicës', 'sq')?.dead).toBe(2)
    // "victims" alone aren't the dead: a fraud's are, here
    expect(foreignCasualties('Tragjedi në autostradën e Bullgarisë, 11 viktima dhe 48 të plagosur', 'sq')).toMatchObject({ dead: 0, injured: 48 })
    expect(foreignCasualties('100 viktima të mashtrimit me kriptovaluta', 'sq')?.dead).toBe(0)
  })

  it('rates the kinds of event', () => {
    expect(rateSeverity('Aksident i rëndë në Gramsh, përplasen dy automjete, ka të plagosur', null, 'other', 'sq')).toBe('medium')
    expect(rateSeverity('Me armë dhe drogë lëvizte i qetë në Tiranë, arrestohet 42-vjeçari me precedentë kriminalë', null, 'security', 'sq')).toBe('medium')
    expect(rateSeverity('Përfundon greva e punëtorëve teknikë të shkollave fillore në Prishtinë, njofton sindikata', null, 'other', 'sq')).toBe('medium')
    expect(rateSeverity('Shpërthim në një lokal në Prishtinë, policia në vendngjarje', null, 'security', 'sq')).toBe('high')
  })

  it("leaves everyday news low, and doesn't take a striker, an example, a death threat or the fight against crime for news", () => {
    expect(rateSeverity('Kurti dhe bashkëshortja e tij marrin pjesë në darkën e shtruar nga Macron në Pallatin Élysée', null, 'geopolitics', 'sq')).toBe('low')
    expect(rateSeverity('A do të kandidojë Armend Zemaj për kryetar të LDK-së?', null, 'elections', 'sq')).toBe('low')
    expect(rateSeverity('Sulmuesi i Kosovës shënon dy gola në fitoren e klubit', null, 'sports', 'sq')).toBe('low')
    expect(rateSeverity('Kosova si shembull i bashkëpunimit rajonal', null, 'geopolitics', 'sq')).toBe('low')
    expect(rateSeverity('Kërcënim me vdekje ndaj gazetares, nisin hetimet', null, 'security', 'sq')).toBe('low')
    expect(rateSeverity('Lufta kundër kanabisit, Demo: Operacionet e përbashkëta me Guardia di Finanza kanë dhënë rezultate konkrete', null, 'security', 'sq')).toBe('low')
  })
})

describe('severity in Serbian', () => {
  it('counts the dead and injured in either script, and in the Montenegrin forms', () => {
    const cyrillic = 'Велики ланчани судар на ауто-путу у Бугарској: погинуло 11, повређено 46 особа'
    expect(foreignCasualties(cyrillic, 'sr')).toMatchObject({ dead: 11, injured: 46 })
    expect(rateSeverity(cyrillic, null, 'disaster', 'sr')).toBe('high')
    expect(rateSeverity('Najmanje 12 ljudi poginulo u sudaru zbog guste magle u Bugarskoj', null, 'disaster', 'sr')).toBe('high')
    expect(foreignCasualties('Bugarska: Broj poginulih u lančanim sudarima porastao na 12, sutra dan žalosti', 'sr')?.dead).toBe(12)
    expect(foreignCasualties('Руски дронови напали Запорожје, најмање петоро повређених', 'sr')?.injured).toBe(5)
    expect(foreignCasualties('U udesu kod Podgorice povrijeđeno šest osoba', 'sr')?.injured).toBe(6)
    expect(foreignCasualties('Povredjeno pet osoba u sudaru kod Niša', 'sr')?.injured).toBe(5)
  })

  it('rates the kinds of event', () => {
    expect(rateSeverity('Ухапшен Нишлија који је претио таксисти, одузео му возило и изазвао удес', null, 'security', 'sr')).toBe('medium')
    expect(rateSeverity('Neredi u Dortmundu zbog kebaba od jednog evra, na policiju bačen i trotinet', null, 'security', 'sr')).toBe('medium')
    expect(rateSeverity('Saobraćajka na putu Despotovac - Svilajnac: Šleper prosut na putu', null, 'other', 'sr')).toBe('medium')
    expect(rateSeverity('Kasparov upozoren, Kremlj sprema atentat', null, 'security', 'sr')).toBe('high')
  })

  it("leaves everyday news low, and doesn't take a striker, Armistice Day or a fraud's victims for news", () => {
    expect(rateSeverity('Сутра облачно са кишом, у петак до 25 степени', null, 'weather', 'sr')).toBe('low')
    expect(rateSeverity('Novi uslovi za odlazak u penziju od 1. januara: Oglasio se PIO fond', null, 'economy', 'sr')).toBe('low')
    expect(rateSeverity('Napadač Partizana postigao dva gola protiv Crvene zvezde', null, 'sports', 'sr')).toBe('low')
    expect(rateSeverity('На Дан примирја радиће 66 пошта широм Србије', null, 'other', 'sr')).toBe('low')
    expect(foreignCasualties('Policija: 100 žrtava prevare preko interneta', 'sr')?.dead).toBe(0)
    // and English is read as before
    expect(rateSeverity('Pet food prices rise again')).toBe('low')
  })

  it('writes Serbian Cyrillic in Latin letters, and either without accents', () => {
    expect(serbianLatin('Љубљана, Њујорк, Џон, Ђоковић, Шабац')).toBe('Ljubljana, Njujork, Džon, Đoković, Šabac')
    expect(withoutAccents('Đoković, uhapšen, të vrarë, çmimet')).toBe('Dokovic, uhapsen, te vrare, cmimet')
  })
})

describe('the second-outlet search in Albanian and Serbian', () => {
  it("reads GDELT's translated list's Albanian and Serbian articles", () => {
    expect(TRANSLATED_LANGUAGES).toMatchObject({ sqi: 'sq', alb: 'sq', srp: 'sr' })
  })

  it('reads their headlines without accents or small words, Serbian in Latin letters', () => {
    expect(storyTokens('Погинуло 11 особа у ланчаном судару у Бугарској', 'sr'))
      .toEqual(storyTokens('Poginulo 11 osoba u lančanom sudaru u Bugarskoj', 'sr'))
    const sq = storyTokens('Kurti dhe bashkëshortja e tij marrin pjesë në darkën e shtruar nga Macron', 'sq')
    expect(sq).toEqual(expect.arrayContaining(['kurti', 'bashkeshortja', 'macron']))
    for (const small of ['dhe', 'tij', 'nga']) expect(sq).not.toContain(small)
  })

  const AT = new Date('2026-11-10T13:00:00Z')
  const LATER = new Date(AT.getTime() + 3 * 3_600_000)
  const held = (over: Partial<HeldReport>): HeldReport => ({
    id: 'sig', title: '', category: 'other', severity: 'low', published_at: AT, original_urls: [], source_ids: [],
    location_name: null, lat: null, lng: null, tags: ['news', 'rss'], ...over,
  })
  const article = (url: string, title: string, lang: string) =>
    ({ url, title, site: siteOf(new URL(url).hostname), at: new Date(AT.getTime() + 2 * 3_600_000), lang })

  it("finds a Kosovo report's second outlet in Albanian, and a Serbian one's across the two scripts", () => {
    const xk = held({
      id: 'sig-xk', language: 'sq', title: 'Përfundon greva e punëtorëve teknikë të shkollave fillore në Prishtinë',
      original_urls: ['https://lajmi.net/perfundon-greva-e-punetoreve-teknike/'], location_name: 'Pristina, Kosovo', lat: 42.66, lng: 21.17,
      tags: ['news', 'rss', 'lajmi-net-xk', 'xk'],
    })
    expect(otherOutlets(xk, [article('https://telegrafi.com/perfundon-greva-ne-shkollat-fillore-te-prishtines/', 'Përfundon greva e punëtorëve teknikë në shkollat fillore të Prishtinës, njofton sindikata', 'sq')], LATER)
      .map(f => f.site)).toEqual(['telegrafi.com'])
    // an Albanian report isn't compared with Serbian or English articles
    expect(otherOutlets(xk, [article('https://telegrafi.com/perfundon-greva-2/', 'Përfundon greva e punëtorëve teknikë në shkollat fillore të Prishtinës, njofton sindikata', 'sr')], LATER)).toEqual([])

    const rs = held({
      id: 'sig-rs', language: 'sr', category: 'disaster', severity: 'medium',
      title: 'Магла у Бугарској: у ланчаним сударима погинуло најмање 12 људи',
      original_urls: ['https://www.rts.rs/vesti/svet/123/magla-u-bugarskoj.html'], location_name: 'Bulgaria', lat: 42.7, lng: 25.5,
    })
    const found = otherOutlets(rs, [article('https://www.blic.rs/vesti/svet/najmanje-12-ljudi-poginulo-u-sudaru/abc123', 'Najmanje 12 ljudi poginulo u sudaru zbog guste magle u Bugarskoj', 'sr')], LATER)
    expect(found.map(f => f.site)).toEqual(['blic.rs'])
    // the outlet's own headline, as it wrote it
    expect(found[0]!.title).toBe('Najmanje 12 ljudi poginulo u sudaru zbog guste magle u Bugarskoj')
    // a wire story reworded a little is one source, in either script: Tanjug's toll as Novosti carried it
    expect(nearCopy('Бугарска: Број погинулих у ланчаним сударима порастао на 12, сутра дан жалости', 'BROJ POGINULIH U BUGARSKOJ PORASTAO: U lančanim sudarima stradalo 12 osoba, sutra dan žalosti', 'sr')).toBe(true)
  })

  it('takes the same Serbian headline in the other script for a copy', () => {
    expect(nearCopy('Најмање 12 људи погинуло у судару због густе магле у Бугарској', 'Najmanje 12 ljudi poginulo u sudaru zbog guste magle u Bugarskoj', 'sr')).toBe(true)
  })

  it('makes a place quiet when its reports are rarely verified, as Kosovo\'s are', () => {
    const verified = new Map([['XK', 19], ['GL', 15], ['DM', 0], ['ME', 515]])
    const totals = new Map([['XK', 722], ['GL', 40], ['DM', 30], ['ME', 1891]])
    expect(quietFrom(['DM', 'GL', 'ME', 'XK'], verified, QUIET_VERIFIED, totals)).toEqual(['dm', 'xk'])
    // without the counts of reports, as before
    expect(quietFrom(['DM', 'GL', 'ME', 'XK'], verified)).toEqual(['dm'])
  })

  it('takes Albanian and Serbian reports into the search', () => {
    expect(waitingQuery(['xk'], new Date('2026-11-11T12:00:00Z')).sql).toMatch(/language IN \('en', 'fr', 'de', 'es', 'pt', 'ru', 'ar', 'sq', 'sr'\)/)
  })
})
