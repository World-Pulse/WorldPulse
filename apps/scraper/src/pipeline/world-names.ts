/**
 * Names in every language (Nov 21, 2026; Devon, 10:39 AM: "Proceed", with "names in every language" first). The
 * rules (entity-rules.ts) read English names in Latin letters: on one day's 49,761 headlines they linked 55% of the
 * English ones to a named person, place or organisation, and 28% of the rest, three quarters of the reports. This reads
 * a report's headline in its own language for the names in the table (world-names-data.ts, from Wikidata: countries,
 * cities of 300,000 or more, heads of state and government, the people and organisations named most), each named as
 * the rules name it, so the report joins the same entity: on that day 6.3% more of all headlines were linked (3,157),
 * 41.2% in all against 34.9%. Reading the table takes about 21 MB with every language read, and a headline about 0.06 ms.
 * Chinese and Japanese headlines write a city without its "city" ("東京", "上海", where Wikidata has "東京都", "上海市"),
 * Korean ones Seoul without its "special city": the table holds those names too (253 headlines get a name more, most
 * often Shenzhen, Kaohsiung, Osaka and Tokyo; of 60 read by hand 57 were right, the other 3 a company named after its
 * city: 東京エレクトロン, 宁波银行, 盛美上海; 12 of 12 for Shenzhen, which the table held as an organisation).
 *
 * Hand-checked twice: 7 of 123 links wrong in the first 100 headlines, fixed; 5 of 125 in the next 100 (96%), fixed
 * too. What it leaves out, and why:
 *  - English headlines (the rules read them) and English names in other languages' headlines (the rules again).
 *  - Codes: a name written in capitals of 5 letters or fewer only for a few (EU, UN, NATO, USA, UK, UAE, Russia's
 *    "РФ", Armenia's "ՀՀ", DR Congo's "RDC", Saudi Arabia's "KSA"), and only as written: "De Boer" is no "DE", nor
 *    "Un bébé" the "UN".
 *  - Everyday words: one-word names of 3 letters or fewer; one-word names the day's headlines of that language wrote in
 *    lower case ("lima" in Spanish); a one-word name written in lower case in the headline; Indonesian and Malay
 *    one-word places, as those headlines are in title case ("Bursa", the stock exchange; "Kota", a city); and a few
 *    read by hand: Hindi "गया" (went, as Gaya), "हुए" (as Huế), Arabic "الشباب" (the youth, as Al-Shabaab)...
 *  - Endings: only the language's own ("Москвы", "Polsce", "Türkiye'nin", "Հայաստանում", "சென்னையில்"), so "Macaulay"
 *    is not Macau, "Κάνουμε" not Kano, "Мединский" not Medina.
 *  - People: a one-word name only for those known by it (Trump, Putin, Modi...); "Gandhi" alone names no one; titles
 *    ("His Majesty") no one. A place's name before a person's ("Dominique de Villepin", "Santiago Peña") or after one
 *    ("Melissa Medina") is the person's; a city in a score line or beside a club's words ("Manchester United", "Real
 *    Madrid") is the club; England's football cities are left out of other languages.
 *  - Written without spaces (Chinese, Japanese, Thai): the longest name found wins; a name in katakana is a whole word
 *    ("タイ" is not in "タイトル"); a two-character country going on into a foreign name ("阿曼" in "阿曼達", Amanda) is not;
 *    a city without its "city" that is also a word or another name is left out: "北海" (in 北海道, Hokkaido), "东方"
 *    (eastern), "德州" (also Texas), "长治" (长治久安, lasting peace), Taiwan's towns named like a mainland city ("潮州",
 *    "泰安"), Japan's surnames ("松山", "宮崎") and Tokyo's wards ("板橋区" is Itabashi, not Banqiao).
 * At most MAX_NAMES names a report.
 *
 * @module pipeline/world-names
 */

import { NAME_ENTITIES, NAME_LABELS, NAME_ABBREVIATIONS, NAME_SPACELESS } from './world-names-data'

export type NameKind = 'country' | 'city' | 'person' | 'org'
export interface TableName { name: string; type: 'location' | 'person' | 'organisation'; kind: NameKind }

/** The names one report gets from the table, at most */
export const MAX_NAMES = 4

const SPACELESS = new Set(['zh', 'ja', 'th', 'my', 'km', 'lo'])
const FALLBACK: Readonly<Record<string, string[]>> = {
  bs: ['hr', 'sr'], sr: ['hr', 'bs'], hr: ['bs', 'sr', 'sl'], sl: ['hr'], mk: ['bg', 'sr'], me: ['sr', 'hr'],
  uk: ['ru'], be: ['ru', 'uk'], kk: ['ru'], ky: ['ru', 'kk'], ms: ['id'], id: ['ms'], gl: ['es', 'pt'],
  ca: ['es'], no: ['nb', 'da', 'sv'], nb: ['no', 'da'], da: ['no', 'nb'], ur: ['fa'],
}
const ARABIC_PRE = ['وال', 'بال', 'لل', 'فال', 'كال', 'ال', 'و', 'ب', 'ل', 'ف', 'ك']
const HEBREW_PRE = ['וה', 'שה', 'מה', 'בה', 'לה', 'ה', 'ו', 'ב', 'ל', 'מ', 'ש', 'כ']
const GERMANIC_S = new Set(['de', 'nl', 'sv', 'no', 'nb', 'da', 'is', 'af', 'lb'])
const KO_PARTICLES = ['에서', '으로', '까지', '부터', '은', '는', '이', '가', '을', '를', '의', '에', '과', '와', '도', '로', '만', '측']
const HR = ['a', 'u', 'e', 'i', 'o', 'om', 'em', 'ima', 'ama', 'ju', 'ji', 'iji', 'ije', 'iju', 'oj', 'ske']
const RU = ['а', 'у', 'е', 'ы', 'и', 'ой', 'ей', 'ом', 'ем', 'ою', 'ею', 'ю', 'я', 'ии', 'ию', 'ия', 'ий', 'ам', 'ах', 'ами']
const BG = ['та', 'то', 'ът', 'ят', 'а', 'я', 'и', 'е', 'ия', 'ията']
/** Each language's own endings on a name: case endings, articles, postpositions written on */
const SUFFIXES: Readonly<Record<string, readonly string[]>> = {
  pl: ['a', 'u', 'e', 'y', 'i', 'ie', 'ę', 'ą', 'em', 'om', 'ów', 'ach', 'ami', 'ii', 'ji', 'iem', 'owi', 'cie', 'dzie'],
  cs: ['a', 'u', 'e', 'y', 'i', 'ě', 'ou', 'em', 'ech', 'ům', 'ách', 'ami', 'ie', 'ii', 'ií', 'ích'],
  sk: ['a', 'u', 'e', 'y', 'i', 'ou', 'om', 'och', 'ov', 'ách', 'ami', 'ie', 'ii', 'iu'],
  sl: ['a', 'u', 'e', 'i', 'o', 'om', 'em', 'ih', 'ji', 'iji', 'ija', 'ijo', 'iju'],
  hr: HR, sr: HR, bs: HR,
  ru: RU, be: RU,
  uk: ['а', 'у', 'е', 'и', 'і', 'ї', 'ой', 'ою', 'ею', 'ом', 'ем', 'ю', 'я', 'ії', 'ію', 'ія', 'ій', 'ам', 'ах', 'ами'],
  bg: BG, mk: BG,
  lt: ['as', 'a', 'os', 'oje', 'ą', 'ai', 'o', 'e', 'ės', 'ę', 'ėje', 'ui', 'u', 'is', 'ijos', 'ija', 'iją', 'ijoje', 'ijai', 'uose'],
  lv: ['a', 'as', 'ā', 'ai', 'u', 'am', 's', 'i', 'ijā', 'ijas', 'iju', 'ijai', 'ē', 'es', 'ei'],
  et: ['i', 'is', 'ist', 'isse', 'il', 'ile', 'ilt', 'iga', 'ga', 's', 'st', 'sse', 'l', 'le', 'lt', 'ks', 'ni', 'na', 'ta', 'd', 'a'],
  fi: ['n', 'ssa', 'ssä', 'sta', 'stä', 'an', 'en', 'in', 'lla', 'llä', 'lle', 'lta', 'ltä', 'ksi', 'na', 'nä', 'a', 'ä', 'iin', 'han', 'hin', 'aan', 'ään'],
  hu: ['ban', 'ben', 'ba', 'be', 'ból', 'ből', 'on', 'en', 'ön', 'n', 'ra', 're', 'ról', 'ről', 'tól', 'től', 'nak', 'nek', 'val', 'vel', 'hoz', 'hez', 'höz', 'ig', 'ért', 'ként', 'i', 'ot', 'et', 'öt', 't', 'ul', 'ül'],
  ro: ['ul', 'ului', 'ei', 'lui', 'a', 'ii', 'iei', 'ia'],
  sq: ['a', 'ë', 'ës', 'ën', 's', 'n', 'i', 'it', 'in', 'në', 'së', 'ut', 'un', 'ja', 'ne', 'es', 'ia', 'isë', 'inë', 've'],
  // "Mısırlı" (Egyptian); Turkish case endings come after an apostrophe
  tr: ['lı', 'li', 'lu', 'lü'],
  az: ['a', 'ə', 'ya', 'yə', 'da', 'də', 'dan', 'dən', 'ın', 'in', 'un', 'ün', 'nın', 'nin', 'nun', 'nün', 'la', 'lə', 'ı', 'i', 'u', 'ü', 'yı', 'yi', 'dakı', 'dəki', 'lı', 'li'],
  kk: ['да', 'де', 'та', 'те', 'дан', 'ден', 'тан', 'тен', 'нан', 'нен', 'ға', 'ге', 'қа', 'ке', 'на', 'не', 'ның', 'нің', 'дың', 'дің', 'тың', 'тің', 'ы', 'і', 'н', 'ны', 'ні', 'ды', 'ді'],
  uz: ['da', 'dan', 'ga', 'ka', 'qa', 'ning', 'ni', 'dagi', 'lik'],
  ky: ['да', 'до', 'дан', 'дон', 'га', 'го', 'ка', 'ко', 'нын', 'нин', 'дын', 'дин', 'ны', 'ни', 'ды', 'ди'],
  hy: ['ի', 'ում', 'ից', 'ով', 'ն', 'ը', 'ին', 'ու'],
  ka: ['ი', 'ის', 'ში', 'ს', 'მა', 'ით', 'ზე', 'დან', 'თან', 'ისთვის'],
  gu: ['માં', 'ના', 'ની', 'નું', 'ને', 'થી', 'નો', 'માંથી'],
  bn: ['ের', 'এর', 'র', 'তে', 'কে', 'য়', 'ে', 'এ'],
  as: ['ত', 'ৰ', 'লৈ', 'ক'],
  mr: ['त', 'ात', 'चा', 'ची', 'चे', 'ला', 'ने', 'मध्ये', 'ातील', 'मधील', 'च्या', 'ाच्या', 'ाला', 'ातून'],
  ne: ['को', 'ले', 'लाई', 'मा', 'बाट', 'का', 'की'],
  hi: ['ों', 'ें'],
  pa: ['ਵਿੱਚ', 'ਦਾ', 'ਦੀ', 'ਦੇ', 'ਨੂੰ', 'ਤੋਂ'],
  or: ['ରେ', 'ର', 'କୁ', 'ରୁ'],
  ta: ['இல்', 'வில்', 'யில்', 'இன்', 'வின்', 'யின்', 'க்கு', 'வுக்கு', 'யை', 'வை', 'இலிருந்து', 'விலிருந்து', 'யிலிருந்து'],
  te: ['లో', 'కు', 'కి', 'ను', 'నుంచి', 'తో', 'లోని'],
  kn: ['ದಲ್ಲಿ', 'ಕ್ಕೆ', 'ದ', 'ನ', 'ಗೆ', 'ಯಲ್ಲಿ', 'ಯ', 'ವನ್ನು', 'ದಿಂದ'],
  ml: ['യിൽ', 'ിൽ', 'യുടെ', 'ന്റെ', 'ത്തിൽ', 'യെ', 'ിലെ', 'യിലെ', 'ക്ക്', 'യ്ക്ക്', 'യിലേക്ക്'],
}
/** Names whose last vowel the ending replaces ("Polska", "Polsce"; "Москва", "Москвы") */
const STEM_VOWEL = new Set(['pl', 'cs', 'sk', 'sl', 'hr', 'sr', 'bs', 'ru', 'be', 'uk', 'bg', 'mk', 'lt', 'lv', 'et', 'fi', 'hu', 'ro', 'sq', 'az', 'kk', 'uz', 'ky'])
const VOWELS = 'aeiouyаяеоыиьаíéáóúăâîëёęąіїєә'
const CLUB_AFTER = new Set(['united', 'fc', 'cf', 'sc', 'athletic', 'rovers', 'wanderers', 'hotspur', 'albion'])
const CLUB_BEFORE = new Set(['fc', 'ac', 'as', 'ss', 'ssc', 'real', 'atlético', 'atletico', 'inter', 'dinamo', 'dynamo', 'spartak',
  'lokomotiv', 'olympique', 'sporting', 'cska', 'zenit', 'shakhtar', 'galatasaray', 'stade', 'racing', 'bayern', 'borussia',
  'eintracht', 'hertha', 'بایرن', 'بايرن', 'баварія', 'бавария'])
const SCORE = /(?<!\p{Nd})\p{Nd}{1,2}\s?[-:–]\s?\p{Nd}{1,2}(?!\p{Nd})/u
const OPEN_QUOTES = '‘“"«„\'‚'
const PARTICLES = new Set(['de', 'da', 'di', 'del', 'della', 'van', 'von', 'le', 'la', 'du', 'dos', 'das', 'do', 'bin', 'ben', 'al', 'el'])
/** Every noun is capitalised: a capital after a name says nothing */
const NOUN_CAPS = new Set(['de', 'lb'])
const KATAKANA = /[\p{Script=Katakana}ー]/u
/** "阿曼" (Oman) in "阿曼達" (Amanda), "马里" (Mali) in "马里奥" (Mario): a foreign name going on */
const NAME_GOES_ON = new Set([...'達达奥奧斯爾尔娜亞亚諾诺拉尼克德特莉麗丽妮蒂安卡塔瑞森頓顿曼琳蓮莲芬絲丝'])
const WORD = /[\p{L}\p{M}\p{N}'’-]+/gu

/** A word as the table holds it: lower case, one apostrophe, a final sigma as any sigma, "ß" as "ss" */
export function normName(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/[’‘`´]/g, "'").replace(/ς/g, 'σ').replace(/ß/g, 'ss')
}
const cased = (s: string) => s.toLowerCase() !== s.toUpperCase()
const firstChar = (s: string) => Array.from(s)[0] ?? ''
const startsUpper = (s: string) => { const c = firstChar(s); return c !== '' && c === c.toUpperCase() && c !== c.toLowerCase() }
/** A word written with a capital, not all in capitals */
const capital = (s: string) => cased(s) && startsUpper(s) && s !== s.toUpperCase()
const chars = (s: string) => Array.from(s)

// ─── The table, read a language at a time ────────────────────────────────────

let entityList: TableName[] | null = null
function entities(): TableName[] {
  if (!entityList) {
    entityList = NAME_ENTITIES.split('\n').map(line => {
      const [name, type, kind] = line.split('\t')
      return { name: name!, type: type as TableName['type'], kind: kind as NameKind }
    })
  }
  return entityList
}

const ids = (field: string | undefined): number[] => (field ? field.split(',').map(Number) : [])

/**
 * A language's labels, found by the first three letters of their first word: where each label's line starts in the
 * language's text (the text is kept anyway; an index of its words took 40 MB with every language read, this about 2)
 */
interface Spaced { text: string; byPrefix: Map<string, number[]> }
const spacedCache = new Map<string, Spaced | null>()
function spacedIndex(lang: string): Spaced | null {
  if (spacedCache.has(lang)) return spacedCache.get(lang)!
  const text = NAME_LABELS[lang]
  let index: Spaced | null = null
  if (text) {
    index = { text, byPrefix: new Map() }
    for (let at = 0; at < text.length;) {
      const end = text.indexOf('\n', at)
      const stop = end < 0 ? text.length : end
      const space = text.indexOf(' ', at), tab = text.indexOf('\t', at)
      const firstEnd = space >= 0 && space < tab ? space : tab
      const prefix = chars(text.slice(at, firstEnd)).slice(0, 3).join('')
      const bucket = index.byPrefix.get(prefix)
      if (bucket) bucket.push(at); else index.byPrefix.set(prefix, [at])
      at = stop + 1
    }
  }
  spacedCache.set(lang, index)
  return index
}

/** The label (its words) and entities of the line starting at `at` */
function lineAt(text: string, at: number): { words: string[]; ids: number[] } {
  const end = text.indexOf('\n', at)
  const [label, list] = text.slice(at, end < 0 ? text.length : end).split('\t')
  return { words: label!.split(' '), ids: ids(list) }
}

/** Whether some label of the language begins with this word ("Bosna" begins "Bosna i Hercegovina") */
function beginsALabel(index: Spaced, word: string): boolean {
  for (const at of index.byPrefix.get(chars(word).slice(0, 3).join('')) ?? []) if (lineAt(index.text, at).words[0] === word) return true
  return false
}

const listCache = new Map<string, Array<{ label: string; words: string[]; ids: number[] }>>()
function labelList(table: Readonly<Record<string, string>>, cacheKey: string, lang: string) {
  const key = `${cacheKey}:${lang}`
  let list = listCache.get(key)
  if (!list) {
    list = (table[lang] ?? '').split('\n').filter(Boolean).map(line => {
      const [label, list2] = line.split('\t')
      return { label: label!, words: label!.split(' '), ids: ids(list2) }
    })
    listCache.set(key, list)
  }
  return list
}

// ─── Reading a headline ──────────────────────────────────────────────────────

/** Whether a word is the name with one of its language's endings */
export function endingOk(word: string, label: string, lang: string): boolean {
  if (word === label) return true
  if (lang === 'ar' || lang === 'fa' || lang === 'ur') return ARABIC_PRE.some(p => word.startsWith(p) && word.slice(p.length) === label)
  if (lang === 'he') return HEBREW_PRE.some(p => word.startsWith(p) && word.slice(p.length) === label)
  if (GERMANIC_S.has(lang)) return word === `${label}s`
  if (lang === 'el') return word === `${label}σ` || (label.endsWith('ο') && word === `${label.slice(0, -1)}ου`)
  if (lang === 'ko') return KO_PARTICLES.some(p => word === label + p)
  const w = chars(word), l = chars(label)
  if ((lang === 'tr' || lang === 'az') && word.startsWith(`${label}'`) && w.length - l.length <= 5) return true
  const ends = SUFFIXES[lang]
  if (!ends || l.length < 4) return false
  if (word.startsWith(label) && ends.includes(w.slice(l.length).join(''))) return true
  const last = l[l.length - 1]!
  const stem = l.slice(0, -1).join('')
  if (lang === 'hu' && (last === 'a' || last === 'e') && word.startsWith(stem + (last === 'a' ? 'á' : 'é')) && ends.includes(w.slice(l.length).join(''))) return true
  return STEM_VOWEL.has(lang) && l.length >= 5 && VOWELS.includes(last) && word.startsWith(stem) && ends.includes(w.slice(l.length - 1).join(''))
}

function spacelessNames(title: string, lang: string): number[] {
  const found: Array<{ label: string; ids: number[] }> = []
  const t = chars(title)
  for (const l of [lang, ...(FALLBACK[lang] ?? [])]) {
    for (const { label, ids: list } of labelList(NAME_SPACELESS, 'spaceless', l)) {
      let at = title.indexOf(label)
      while (at >= 0) {
        // positions in characters, not UTF-16 units
        const from = chars(title.slice(0, at)).length
        const len = chars(label).length
        const before = t[from - 1] ?? ''
        const after = t[from + len] ?? ''
        const lc = chars(label)
        const goesOn = lang === 'zh' && len === 2 && NAME_GOES_ON.has(after)
        const midWord = (KATAKANA.test(lc[0]!) && before !== '' && KATAKANA.test(before)) || (KATAKANA.test(lc[len - 1]!) && after !== '' && KATAKANA.test(after))
        if (!goesOn && !midWord) { found.push({ label, ids: list }); break }
        at = title.indexOf(label, at + 1)
      }
    }
  }
  // the longest wins: a name inside a longer one found is that one's
  const labels = [...new Set(found.map(f => f.label))].sort((a, b) => chars(b).length - chars(a).length)
  const keep = new Set(labels.filter((label, i) => !labels.slice(0, i).some(longer => longer.includes(label))))
  return [...new Set(found.filter(f => keep.has(f.label)).flatMap(f => f.ids))]
}

function spacedNames(title: string, lang: string): number[] {
  const tokens = [...title.matchAll(WORD)]
  const raw = tokens.map(m => m[0])
  const starts = tokens.map(m => m.index ?? 0)
  // two words with only a space between ("Santiago Peña"; not "Shenzhen: Kritikët")
  const joined = (a: number, b: number) => b < raw.length && a >= 0 && /^\s+$/.test(title.slice(starts[a]! + raw[a]!.length, starts[b]!))
  const t = raw.map(normName)
  const casedWords = raw.filter(cased)
  const titlecase = casedWords.length > 0 && casedWords.filter(startsUpper).length / casedWords.length > 0.6
  const score = SCORE.test(title)
  const kinds = entities()
  const spans: Array<{ i: number; n: number; ids: number[]; exact: boolean }> = []
  const languages = [lang, ...(FALLBACK[lang] ?? [])]
  for (let i = 0; i < raw.length; i++) {
    for (const l of languages) {
      for (const { words, ids: list } of labelList(NAME_ABBREVIATIONS, 'abbr', l)) {
        if (words.every((w, j) => raw[i + j] === w)) spans.push({ i, n: words.length, ids: list, exact: true })
      }
    }
  }
  const pre = lang === 'ar' || lang === 'fa' || lang === 'ur' ? ARABIC_PRE : lang === 'he' ? HEBREW_PRE : []
  for (const l of languages) {
    const index = spacedIndex(l)
    if (!index) continue
    for (let i = 0; i < t.length; i++) {
      const w = t[i]!
      const prefixes = new Set([chars(w).slice(0, 3).join(''), ...pre.filter(p => w.startsWith(p)).map(p => chars(w.slice(p.length)).slice(0, 3).join(''))])
      for (const prefix of prefixes) {
        for (const at of index.byPrefix.get(prefix) ?? []) {
          const { words, ids: list } = lineAt(index.text, at)
          const n = words.length
          if (i + n > t.length) continue
          if (!words.every((word, j) => endingOk(t[i + j]!, word, lang))) continue
          const of = list.map(x => kinds[x]!)
          // a one-word name written in lower case is a word ("sale", "nice")
          if (n === 1 && cased(raw[i]!) && !startsUpper(raw[i]!)) continue
          // a one-word name in quotes is the name of something else: "‘INDIA’" (an alliance), a film
          if (n === 1 && starts[i]! > 0 && OPEN_QUOTES.includes(title[starts[i]! - 1]!)) continue
          // a place's name before a person's: "Dominique de Villepin", "Santiago Peña", "Israel Katz"
          if (n === 1 && !NOUN_CAPS.has(lang) && !titlecase && of.some(e => e.kind === 'city' || e.kind === 'country')) {
            const next = raw[i + 1] ?? '', after = raw[i + 2] ?? ''
            if ((capital(next) && joined(i, i + 1) && !beginsALabel(index, normName(next)))
              || (PARTICLES.has(normName(next)) && capital(after) && joined(i, i + 1) && joined(i + 1, i + 2))) continue
          }
          if (of.some(e => e.kind === 'city')) {
            const before = t[i - 1] ?? '', next = t[i + n] ?? ''
            // a club: "Manchester United", "Real Madrid", "Atlético de Madrid", "Bayern de Munique", "Roma-Napoli 2-1"
            const clubBefore = CLUB_BEFORE.has(before) || (PARTICLES.has(before) && CLUB_BEFORE.has(t[i - 2] ?? ''))
            if (score || CLUB_AFTER.has(next) || clubBefore) continue
            // a person's name: "Melissa Medina"
            if (n === 1 && i > 0 && !titlecase && capital(raw[i - 1]!) && joined(i - 1, i)) continue
          }
          spans.push({ i, n, ids: list, exact: words.every((word, j) => t[i + j] === word) })
        }
      }
    }
  }
  // the longest wins where names overlap ("Crna Gora" over "Gora"); of two as long, the one written as it is, then a
  // country before a city ("Бразилии" is Brazil, not Brasília)
  const RANK: Record<NameKind, number> = { country: 0, city: 1, person: 2, org: 3 }
  const rank = (s: { ids: number[] }) => Math.min(...s.ids.map(x => RANK[kinds[x]?.kind ?? 'org']))
  const used = new Set<number>()
  const out: number[] = []
  for (const s of [...spans].sort((a, b) => b.n - a.n || Number(b.exact) - Number(a.exact) || rank(a) - rank(b))) {
    const cells = Array.from({ length: s.n }, (_, k) => s.i + k)
    if (cells.some(c => used.has(c))) continue
    cells.forEach(c => used.add(c))
    out.push(...s.ids)
  }
  return [...new Set(out)]
}

/**
 * The people, places and organisations a headline in another language than English names, as the rules name them,
 * at most MAX_NAMES; none for English (the rules read it) or a language the table has nothing in
 */
export function namesInTitle(title: string, lang: string | null | undefined): TableName[] {
  const language = String(lang || 'en').toLowerCase()
  if (!title || language === 'en') return []
  const found = SPACELESS.has(language) ? spacelessNames(title, language) : spacedNames(title, language)
  const list = entities()
  const seen = new Set<string>()
  const out: TableName[] = []
  for (const i of found) {
    const e = list[i]
    if (!e) continue
    const key = `${e.type}:${e.name.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
    if (out.length >= MAX_NAMES) break
  }
  return out
}
