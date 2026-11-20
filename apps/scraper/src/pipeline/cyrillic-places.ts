/**
 * Places named in Ukrainian, and the Ukrainian cities in Russian (Nov 20, 2026). The story matcher reads Russian
 * country names in Cyrillic letters ("россия", "украина", "киев"), but Ukrainian spells them otherwise ("Росія",
 * "Україні", "Київ"), so of 30,323 reports of 13 hours a fifth of those in Ukrainian were linked to a place; and
 * Russian headlines name the war's cities ("Харьков", "Запорожье") that the matcher doesn't know. Each name is the
 * start of the word, so its case endings follow ("Україні", "Харкова", "Запоріжжі"), with its English name as the
 * gazetteer spells it. A start that begins other common words is given as whole forms instead: "Крим" (Crimea) is
 * the start of "кримінальний" (criminal), "сирі" of "сирий" (raw), "інді" of "індичка" (turkey).
 */

type Entry = [string, string]

/** Read as the start of a word */
const STARTS: Entry[] = [
  // Ukrainian: countries
  ['україн', 'Ukraine'], ['росія', 'Russia'], ['росії', 'Russia'], ['росію', 'Russia'], ['росією', 'Russia'],
  ['російськ', 'Russia'], ['росіян', 'Russia'], ['америк', 'United States'], ['вашингтон', 'Washington'],
  ['китай', 'China'], ['китаю', 'China'], ['китаї', 'China'], ['пекін', 'China'], ['польщ', 'Poland'], ['польськ', 'Poland'],
  ['варшав', 'Warsaw'], ['німеччин', 'Germany'], ['німецьк', 'Germany'], ['берлін', 'Berlin'], ['франці', 'France'],
  ['французьк', 'France'], ['париж', 'Paris'], ['британі', 'United Kingdom'], ['британськ', 'United Kingdom'],
  ['лондон', 'London'], ['ізраїл', 'Israel'], ['іран', 'Iran'], ['туреччин', 'Turkey'], ['турецьк', 'Turkey'],
  ['білорус', 'Belarus'], ['мінськ', 'Minsk'], ['угорщин', 'Hungary'], ['угорськ', 'Hungary'], ['румуні', 'Romania'],
  ['румунськ', 'Romania'], ['молдов', 'Moldova'], ['кишинів', 'Chisinau'], ['японі', 'Japan'], ['японськ', 'Japan'],
  ['індійськ', 'India'], ['криму', 'Crimea'], ['кримськ', 'Crimea'], ['сирії', 'Syria'], ['сирію', 'Syria'], ['сирійськ', 'Syria'],
  // Ukrainian: cities and their regions ("Харківщина")
  ['київ', 'Kyiv'], ['києв', 'Kyiv'], ['харків', 'Kharkiv'], ['харков', 'Kharkiv'], ['одес', 'Odesa'], ['одещин', 'Odesa'],
  ['львів', 'Lviv'], ['львов', 'Lviv'], ['дніпр', 'Dnipro'], ['запоріжж', 'Zaporizhzhia'], ['запорізьк', 'Zaporizhzhia'],
  ['херсон', 'Kherson'], ['донецьк', 'Donetsk'], ['донеччин', 'Donetsk'], ['луганськ', 'Luhansk'], ['луганщин', 'Luhansk'],
  ['маріупол', 'Mariupol'],
  // Russian: what the matcher's own list lacks
  ['польш', 'Poland'], ['израил', 'Israel'], ['венгри', 'Hungary'], ['венгерск', 'Hungary'], ['румыни', 'Romania'],
  ['румынск', 'Romania'], ['молдав', 'Moldova'], ['сирии', 'Syria'], ['сирию', 'Syria'], ['сирийск', 'Syria'],
  ['крыма', 'Crimea'], ['крыму', 'Crimea'], ['крымск', 'Crimea'], ['киев', 'Kyiv'], ['харьков', 'Kharkiv'], ['одесс', 'Odesa'],
  ['днепр', 'Dnipro'], ['запорож', 'Zaporizhzhia'], ['херсон', 'Kherson'], ['донецк', 'Donetsk'], ['луганск', 'Luhansk'],
  ['мариупол', 'Mariupol'],
]

/** Read only as the whole word */
const WHOLE: Entry[] = [
  ['рф', 'Russia'], ['сша', 'United States'], ['крим', 'Crimea'], ['крым', 'Crimea'], ['сирія', 'Syria'], ['сирия', 'Syria'],
  ['індія', 'India'], ['індії', 'India'], ['індію', 'India'],
]

const CYRILLIC = /[Ѐ-ӿ]/
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const byLength = (entries: Entry[]) => [...entries].sort((a, b) => b[0].length - a[0].length)
const LETTER = String.raw`[\p{L}\p{M}]`
const NAMES = new Map([...STARTS, ...WHOLE])
const STARTS_RE = new RegExp(String.raw`(?<!${LETTER})(${byLength(STARTS).map(e => escapeRe(e[0])).join('|')})`, 'gu')
const WHOLE_RE = new RegExp(String.raw`(?<!${LETTER})(${byLength(WHOLE).map(e => escapeRe(e[0])).join('|')})(?!${LETTER})`, 'gu')

/** The places a text names in Ukrainian (and the Ukrainian cities in Russian), as the gazetteer spells them, at most two */
export function cyrillicPlaces(text: string): string[] {
  if (!text || !CYRILLIC.test(text)) return []
  const lower = text.toLowerCase().normalize('NFC')
  const found: Array<{ at: number; name: string }> = []
  for (const re of [STARTS_RE, WHOLE_RE]) {
    for (const m of lower.matchAll(re)) {
      const name = NAMES.get(m[1]!)
      if (name) found.push({ at: m.index ?? 0, name })
    }
  }
  const out: string[] = []
  for (const { name } of found.sort((a, b) => a.at - b.at)) {
    if (!out.includes(name)) out.push(name)
    if (out.length >= 2) break
  }
  return out
}

/** Every place of the lists, for the tests */
export const CYRILLIC_PLACE_NAMES: readonly string[] = [...new Set([...STARTS, ...WHOLE].map(e => e[1]))]
