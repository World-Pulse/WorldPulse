/**
 * The second outlet for the quiet places (Nov 10, 2026; Devon, 12:10 PM: "yes" to "let that search also check the
 * quiet places' everyday stories, and read French and German reports"): the places with few feeds of their own whose
 * stories were verified fewer than QUIET_VERIFIED times in a week get their everyday (low) stories searched too, and
 * French and German reports are compared with the French and German articles of GDELT's translated list.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../crosscheck', () => ({ crossCheckLater: vi.fn() }))

import { readArticles, newestTranslationStamp, TRANSLATED_LANGUAGES, type GdeltArticle } from '../gdelt-articles'
import {
  storyTokens, otherOutlets, siteOf, runSecondOutlets, newState, quietFrom, waitingQuery, QUIET_VERIFIED,
  type HeldReport, type SecondOutletDeps, type CycleStats,
} from '../second-outlet'

const AT = new Date('2026-11-10T10:00:00Z')
const LATER = new Date(AT.getTime() + 3 * 3_600_000)

const report = (over: Partial<HeldReport> = {}): HeldReport => ({
  id: 'sig-bi',
  title: 'Burundi : le prix du carburant augmente de 20 % à Bujumbura',
  category: 'economy',
  severity: 'low',
  published_at: AT,
  original_urls: ['https://www.iwacu-burundi.org/burundi-le-prix-du-carburant-augmente/'],
  source_ids: [],
  location_name: 'Bujumbura, Burundi',
  lat: -3.38,
  lng: 29.36,
  tags: ['news', 'rss', 'iwacu-burundi', 'bi', 'economy', 'low'],
  language: 'fr',
  ...over,
})

const article = (url: string, title: string, lang?: string, at = new Date(AT.getTime() + 2 * 3_600_000)): GdeltArticle =>
  ({ url, title, site: siteOf(new URL(url).hostname), at, ...(lang ? { lang } : {}) })

/** A GKG 2.1 line of the translated list: 27 tab-separated fields, the ones read filled */
const gkgLine = (date: string, url: string, title: string, srclc = '') => {
  const f = Array.from({ length: 27 }, () => '')
  f[0] = `${date}-T1`; f[1] = date; f[2] = '1'; f[3] = new URL(url).hostname; f[4] = url
  f[25] = srclc ? `srclc:${srclc};eng:GT-${srclc.toUpperCase()} 1.0` : ''
  f[26] = `<PAGE_LINKS></PAGE_LINKS><PAGE_TITLE>${title}</PAGE_TITLE>`
  return f.join('\t')
}

describe("GDELT's translated list (Nov 10, 2026)", () => {
  it('reads its newest file', () => {
    expect(newestTranslationStamp('11460604 4a1e http://data.gdeltproject.org/gdeltv2/20261110170000.translation.gkg.csv.zip\n')).toBe('20261110170000')
    expect(newestTranslationStamp('6112611 abd8 http://data.gdeltproject.org/gdeltv2/20261110171500.gkg.csv.zip\n')).toBeNull()
  })

  it('keeps its French, German, Spanish and Portuguese articles, each with its language', () => {
    const text = [
      gkgLine('20261110170000', 'https://www.rfi.fr/fr/afrique/burundi-carburant', 'Burundi : hausse de 20 % du prix du carburant à Bujumbura', 'fra'),
      gkgLine('20261110170000', 'https://www.srf.ch/news/liechtenstein-budget', 'Liechtensteiner Regierung verabschiedet Budget 2027', 'deu'),
      gkgLine('20261110170000', 'https://elpais.com/internacional/x', 'El precio del combustible sube en Burundi', 'spa'),
      gkgLine('20261110170000', 'https://www.publico.pt/mundo/y', 'Cabo Verde aprova orçamento para 2027', 'por'),
      gkgLine('20261110170000', 'https://www.corriere.it/esteri/z', 'Il prezzo del carburante sale in Burundi', 'ita'),
      gkgLine('20261110170000', 'https://www.lemonde.fr/no-language', 'Une page sans langue', ''),
    ].join('\n')
    const found = readArticles(text, TRANSLATED_LANGUAGES)
    expect(found.map(a => [a.site, a.lang])).toEqual([['rfi.fr', 'fr'], ['srf.ch', 'de'], ['elpais.com', 'es'], ['publico.pt', 'pt']])
    // the English list is read as before: every article, no language
    expect(readArticles(text).map(a => a.lang)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined])
  })
})

describe('French and German headlines (Nov 10, 2026)', () => {
  it("leave out their languages' small words", () => {
    expect(storyTokens('Burundi : le prix du carburant augmente de 20 % à Bujumbura', 'fr')).toEqual(['burundi', 'prix', 'carburant', 'augmente', 'bujumbura'])
    expect(storyTokens("L'armée burundaise dément les accusations", 'fr')).toEqual(['armee', 'burundaise', 'dement', 'accusations'])
    expect(storyTokens("Le ministre affirme qu'il n'y a pas de pénurie", 'fr')).toEqual(['ministre', 'affirme', 'penurie'])
    expect(storyTokens('Liechtenstein: Die Regierung verabschiedet das Budget für 2027', 'de')).toEqual(['liechtenstein', 'regierung', 'verabschiedet', 'budget', '2027'])
    // English headlines as before: "die" is a word there
    expect(storyTokens('Six die as bus hits tree')).toEqual(['six', 'die', 'bus', 'hits', 'tree'])
  })

  it("take another newsroom's French report of the story, not the same words of another", () => {
    const found = otherOutlets(report(), [
      article('https://www.rfi.fr/fr/afrique/burundi-carburant', 'Burundi : hausse de 20 % du prix du carburant à Bujumbura', 'fr'),
      article('https://www.jeuneafrique.com/rdc-carburant', 'RDC : le prix du carburant augmente à Kinshasa', 'fr'),
    ], LATER)
    expect(found.map(f => f.site)).toEqual(['rfi.fr'])
  })

  it('take a German report of the story too, with the names test strict (German capitalises every noun)', () => {
    const li = report({
      id: 'sig-li', title: 'Landtag wählt Daniel Risch erneut zum Regierungschef', language: 'de', category: 'politics',
      original_urls: ['https://www.presseportal.ch/de/pm/100000148/100940001'], location_name: 'Vaduz, Liechtenstein', tags: ['news', 'rss', 'regierung-li', 'li'],
    })
    const vaterland = (slug: string, title: string) => article(`https://www.vaterland.li/liechtenstein/politik/${slug}`, title, 'de')
    expect(otherOutlets(li, [vaterland('risch', 'Daniel Risch erneut zum Regierungschef gewählt')], LATER).map(f => f.site)).toEqual(['vaterland.li'])
    // another person, and a French article of the same words, are not
    expect(otherOutlets(li, [vaterland('monauni', 'Landtag wählt Sabine Monauni zur Regierungschefin')], LATER)).toEqual([])
    expect(otherOutlets(li, [article('https://www.lematin.ch/risch', 'Daniel Risch erneut zum Regierungschef gewählt', 'fr')], LATER)).toEqual([])
  })
})

describe('Spanish and Portuguese headlines (Nov 10, 2026, afternoon)', () => {
  it("take another newsroom's report of the story, not another story of the same people", () => {
    const py = report({
      id: 'sig-py', title: 'Paraguay: Peña anuncia aumento del salario mínimo en un 5 %', language: 'es', location_name: 'Asunción, Paraguay',
      original_urls: ['https://www.abc.com.py/politica/2026/11/10/pena-anuncia-aumento-del-salario-minimo/'], tags: ['news', 'rss', 'abc-color-py', 'py'],
    })
    expect(otherOutlets(py, [article('https://www.infobae.com/america/paraguay-salario', 'El Gobierno de Peña aumenta el salario mínimo en Paraguay', 'es')], LATER).map(f => f.site)).toEqual(['infobae.com'])
    expect(otherOutlets(py, [article('https://www.infobae.com/america/paraguay-ministro', 'Paraguay: Peña anuncia nuevo ministro de Hacienda', 'es')], LATER)).toEqual([])
    const cv = report({
      id: 'sig-cv', title: 'Cabo Verde: Governo aprova orçamento de Estado para 2027 com aumento das pensões', language: 'pt', location_name: 'Praia, Cape Verde',
      original_urls: ['https://www.inforpress.cv/governo-aprova-orcamento-2027/'], tags: ['news', 'rss', 'inforpress-cv', 'cv'],
    })
    expect(otherOutlets(cv, [article('https://www.rtp.pt/noticias/mundo/cabo-verde-orcamento', 'Parlamento de Cabo Verde recebe orçamento do Governo para 2027 com aumento das pensões', 'pt')], LATER).map(f => f.site)).toEqual(['rtp.pt'])
  })
})

describe("the quiet places' everyday stories (Nov 10, 2026)", () => {
  it(`are those of the thinly covered places with fewer than ${QUIET_VERIFIED} verified reports in a week`, () => {
    const verified = new Map([['GL', 15], ['DM', 0], ['KN', 1], ['MN', 4]])
    expect(quietFrom(['BI', 'DM', 'GL', 'KN', 'MN'], verified)).toEqual(['bi', 'dm', 'kn', 'mn'])
    expect(quietFrom([], verified)).toEqual([])
  })

  it('are searched beside the serious stories, in English, French and German', () => {
    const { sql, bindings } = waitingQuery(['dm', 'bi'], new Date('2026-11-10T12:00:00Z'))
    expect(sql).toMatch(/severity IN \('medium', 'high', 'critical'\) OR \(severity = 'low' AND tags && \?::text\[\]\)/)
    expect(sql).toMatch(/language IN \('en', 'fr', 'de', 'es', 'pt', 'ru', 'ar'\)/)
    expect(bindings[0]).toEqual(['dm', 'bi'])
  })
})

describe('a cycle with the translated list (Nov 10, 2026)', () => {
  const rfi = article('https://www.rfi.fr/fr/afrique/burundi-carburant', 'Burundi : hausse de 20 % du prix du carburant à Bujumbura', 'fr')
  const english = article('https://www.example-news.com/burundi', 'Burundi : hausse de 20 % du prix du carburant à Bujumbura')
  const ndtv = article('https://www.ndtv.com/india-news/six-killed-bus-chhattisgarh', 'Six killed, 40 injured after bus rams tree in Chhattisgarh')
  const hindu = report({
    id: 'sig-in', title: 'Six dead, 40 injured as bus hits tree in Chhattisgarh', severity: 'high', language: 'en',
    original_urls: ['https://www.thehindu.com/news/national/chhattisgarh/bus-hits-tree-six-dead/article1.ece'], location_name: 'Chhattisgarh, India',
    tags: ['news', 'rss', 'the-hindu-national', 'in'],
  })

  const deps = (files: Record<string, GdeltArticle[]>, translated: Record<string, GdeltArticle[]>, reports: HeldReport[], over: Partial<SecondOutletDeps> = {}) => {
    const calls = { added: [] as Array<{ id: string; sites: string[]; crossCheck: boolean }>, counted: [] as CycleStats[], traced: [] as Array<Record<string, unknown>> }
    const d: SecondOutletDeps = {
      newestStamp: async () => Object.keys(files).sort().pop() ?? null,
      fetchArticles: async stamp => files[stamp] ?? null,
      newestTranslatedStamp: async () => Object.keys(translated).sort().pop() ?? null,
      fetchTranslated: async stamp => translated[stamp] ?? null,
      waiting: async () => reports,
      add: async (r, found, crossCheck) => { calls.added.push({ id: r.id, sites: found.map(f => f.site), crossCheck }); return true },
      crossChecksToday: async () => 0,
      lock: async () => true,
      unlock: async () => {},
      count: async (_day, stats) => { calls.counted.push({ ...stats }) },
      remember: async () => {},
      trace: async entry => { calls.traced.push(entry) },
      clock: () => LATER.getTime(),
      ...over,
    }
    return { d, calls }
  }

  it('compares a French report with the French articles of the translated list, and an English one with the English list', async () => {
    const { d, calls } = deps({ '20261110120000': [ndtv, english] }, { '20261110114500': [rfi] }, [report(), hindu])
    const stats = await runSecondOutlets(newState(), d)
    expect(calls.added).toEqual([
      { id: 'sig-in', sites: ['ndtv.com'], crossCheck: true },
      // an everyday story: matched by its headline, the cross-check kept for the serious ones
      { id: 'sig-bi', sites: ['rfi.fr'], crossCheck: false },
    ])
    expect(stats).toMatchObject({ files: 2, articles: 3, reports: 2, matched: 2, everyday: 1 })
    expect(calls.traced[0]).toMatchObject({ newest: '20261110120000', translated: { newest: '20261110114500', read: [['20261110114500', 1]] } })
  })

  it("doesn't compare a French report with English articles", async () => {
    const { d, calls } = deps({ '20261110120000': [english] }, {}, [report()])
    await runSecondOutlets(newState(), d)
    expect(calls.added).toEqual([])
  })

  it('reads as before when the translated list is not given', async () => {
    const { d, calls } = deps({ '20261110120000': [ndtv] }, {}, [hindu], { newestTranslatedStamp: undefined, fetchTranslated: undefined })
    const stats = await runSecondOutlets(newState(), d)
    expect(calls.added).toEqual([{ id: 'sig-in', sites: ['ndtv.com'], crossCheck: true }])
    expect(stats).toMatchObject({ files: 1, matched: 1, everyday: 0 })
  })
})

describe('the stricter name check (Nov 10, 2026, evening)', () => {
  it("doesn't take another leader's meeting for the report's", () => {
    const tl = report({
      id: 'sig-tl', title: 'Xanana Gusmão meets Indonesian President Prabowo in Jakarta', category: 'geopolitics', language: 'en',
      original_urls: ['https://www.tatoli.tl/2026/11/10/xanana-prabowo/'], location_name: 'Jakarta, Indonesia', lat: -6.2, lng: 106.8,
      tags: ['news', 'rss', 'tatoli-tl', 'tl'],
    })
    expect(otherOutlets(tl, [article('https://en.antaranews.com/news/ramos-horta-prabowo', 'Ramos-Horta meets Indonesian President Prabowo in Jakarta')], LATER)).toEqual([])
    expect(otherOutlets(tl, [article('https://en.antaranews.com/news/xanana-prabowo', 'Prabowo receives Xanana Gusmão in Jakarta for talks on the border')], LATER)
      .map(f => f.site)).toEqual(['antaranews.com'])
  })
})
