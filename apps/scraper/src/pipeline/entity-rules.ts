/**
 * Rule-based entity extraction for the Knowledge Graph (plan item 0s), used
 * for every signal below high severity and whenever no AI model is set up for
 * it (all of them on WorldPulse itself: no OpenAI since Oct 2026).
 *
 * The first rules (Oct 2026) made 21,100 of 23,079 entities "locations":
 * any capitalised words after "in" or "from" ("April", "Petroleum Products",
 * "County", "Trump"); people kept their titles and were cut at two words
 * ("President Donald Trump", "Minister Keir Starmer", "President Bola Ahmed"),
 * "Chief Executive Officer" was a person, and "UN" matched inside "FUND".
 * These rules find places from the gazetteer and country list, people with
 * their titles removed (and well-known people by surname), organisations as
 * whole words, and commodities.
 */

import { placesInText } from './geo'
import { WORLD_CITIES, WORLD_REGIONS } from './world-places'

export type RuleEntityType = 'person' | 'organisation' | 'location' | 'weapon_system' | 'commodity' | 'technology'

export interface RuleEntity {
  name: string
  type: RuleEntityType
  salience: number
}

// ─── PEOPLE ──────────────────────────────────────────────────────────────────

/** Well-known people: every way news names them → one name. `bare`: the surname alone is enough */
const KNOWN_PEOPLE: Array<{ name: string; forms: string[]; bare?: string[] }> = [
  { name: 'Donald Trump', forms: ['donald trump', 'donald j. trump', 'donald j trump'], bare: ['trump'] },
  { name: 'Joe Biden', forms: ['joe biden'], bare: ['biden'] },
  { name: 'Vladimir Putin', forms: ['vladimir putin'], bare: ['putin'] },
  { name: 'Volodymyr Zelensky', forms: ['volodymyr zelensky', 'volodymyr zelenskyy', 'volodymyr zelenskiy'], bare: ['zelensky', 'zelenskyy', 'zelenskiy'] },
  { name: 'Xi Jinping', forms: ['xi jinping'] },
  { name: 'Narendra Modi', forms: ['narendra modi'], bare: ['modi'] },
  { name: 'Benjamin Netanyahu', forms: ['benjamin netanyahu'], bare: ['netanyahu'] },
  { name: 'Recep Tayyip Erdoğan', forms: ['recep tayyip erdogan', 'recep tayyip erdoğan', 'recep tayyip'], bare: ['erdogan', 'erdoğan'] },
  { name: 'Emmanuel Macron', forms: ['emmanuel macron'], bare: ['macron'] },
  { name: 'Keir Starmer', forms: ['keir starmer'], bare: ['starmer'] },
  { name: 'Bola Tinubu', forms: ['bola tinubu', 'bola ahmed tinubu', 'bola ahmed'], bare: ['tinubu'] },
  { name: 'Cyril Ramaphosa', forms: ['cyril ramaphosa'], bare: ['ramaphosa'] },
  { name: 'William Ruto', forms: ['william ruto'] },
  { name: 'Lula da Silva', forms: ['luiz inácio lula da silva', 'luiz inacio lula da silva', 'lula da silva'], bare: ['lula'] },
  { name: 'Javier Milei', forms: ['javier milei'], bare: ['milei'] },
  { name: 'Claudia Sheinbaum', forms: ['claudia sheinbaum'], bare: ['sheinbaum'] },
  { name: 'Mark Carney', forms: ['mark carney'] },
  { name: 'Anthony Albanese', forms: ['anthony albanese'] },
  { name: 'Giorgia Meloni', forms: ['giorgia meloni'], bare: ['meloni'] },
  { name: 'Friedrich Merz', forms: ['friedrich merz'] },
  { name: 'Sanae Takaichi', forms: ['sanae takaichi'], bare: ['takaichi'] },
  { name: 'Lee Jae-myung', forms: ['lee jae-myung', 'lee jae myung', 'lee jae'] },
  { name: 'Lai Ching-te', forms: ['lai ching-te', 'lai ching te', 'lai ching'] },
  { name: 'Prabowo Subianto', forms: ['prabowo subianto'], bare: ['prabowo'] },
  { name: 'Ferdinand Marcos Jr.', forms: ['ferdinand marcos jr', 'ferdinand marcos', 'bongbong marcos'] },
  { name: 'Sara Duterte', forms: ['sara duterte'] },
  { name: 'Rodrigo Duterte', forms: ['rodrigo duterte'] },
  { name: 'Anwar Ibrahim', forms: ['anwar ibrahim'] },
  { name: 'Shehbaz Sharif', forms: ['shehbaz sharif'] },
  { name: 'Asif Ali Zardari', forms: ['asif ali zardari', 'asif ali'], bare: ['zardari'] },
  { name: 'Masoud Pezeshkian', forms: ['masoud pezeshkian'], bare: ['pezeshkian'] },
  { name: 'Ali Khamenei', forms: ['ali khamenei', 'ayatollah ali khamenei'], bare: ['khamenei'] },
  { name: 'Abbas Araghchi', forms: ['abbas araghchi'], bare: ['araghchi'] },
  { name: 'Mahmoud Abbas', forms: ['mahmoud abbas'] },
  { name: 'Mohammed bin Salman', forms: ['mohammed bin salman', 'mohammad bin salman'] },
  { name: 'Nicolás Maduro', forms: ['nicolás maduro', 'nicolas maduro'], bare: ['maduro'] },
  { name: 'Ilham Aliyev', forms: ['ilham aliyev'], bare: ['aliyev'] },
  { name: 'Nikol Pashinyan', forms: ['nikol pashinyan'], bare: ['pashinyan'] },
  { name: 'Alexander Lukashenko', forms: ['alexander lukashenko', 'aleksandr lukashenko'], bare: ['lukashenko'] },
  { name: 'Viktor Orbán', forms: ['viktor orbán', 'viktor orban'], bare: ['orbán', 'orban'] },
  { name: 'Pete Hegseth', forms: ['pete hegseth'], bare: ['hegseth'] },
  { name: 'Marco Rubio', forms: ['marco rubio'], bare: ['rubio'] },
  { name: 'JD Vance', forms: ['jd vance', 'j.d. vance'] },
  { name: 'Scott Bessent', forms: ['scott bessent'], bare: ['bessent'] },
  { name: 'Elon Musk', forms: ['elon musk'], bare: ['musk'] },
  { name: 'António Guterres', forms: ['antónio guterres', 'antonio guterres'], bare: ['guterres'] },
  { name: 'Tedros Adhanom Ghebreyesus', forms: ['tedros adhanom ghebreyesus', 'tedros adhanom'], bare: ['tedros'] },
  { name: 'Ursula von der Leyen', forms: ['ursula von der leyen'] },
  { name: 'Mark Rutte', forms: ['mark rutte'], bare: ['rutte'] },
  { name: 'Kim Jong Un', forms: ['kim jong un', 'kim jong-un'] },
  { name: 'Abiy Ahmed', forms: ['abiy ahmed'] },
  { name: 'Wang Yi', forms: ['wang yi'] },
  { name: 'Sergei Lavrov', forms: ['sergei lavrov', 'sergey lavrov'], bare: ['lavrov'] },
  { name: 'Steve Witkoff', forms: ['steve witkoff'], bare: ['witkoff'] },
  { name: 'Kashim Shettima', forms: ['kashim shettima'], bare: ['shettima'] },
  { name: 'Atiku Abubakar', forms: ['atiku abubakar'], bare: ['atiku'] },
  { name: 'Goodluck Jonathan', forms: ['goodluck jonathan'] },
  { name: 'Muhammadu Buhari', forms: ['muhammadu buhari'], bare: ['buhari'] },
  { name: 'Nyesom Wike', forms: ['nyesom wike'] },
  { name: 'Tô Lâm', forms: ['tô lâm', 'to lam'] },
  { name: 'Park Geun-hye', forms: ['park geun-hye', 'park geun hye', 'park geun'] },
  { name: 'Anutin Charnvirakul', forms: ['anutin charnvirakul'] },
  { name: 'Lawrence Wong', forms: ['lawrence wong'] },
  { name: 'Navi Pillay', forms: ['navi pillay', 'navanethem pillay'] },
]

const PERSON_BY_FORM = new Map<string, string>()
const BARE_SURNAMES = new Map<string, string>()
for (const p of KNOWN_PEOPLE) {
  for (const f of p.forms) PERSON_BY_FORM.set(f, p.name)
  PERSON_BY_FORM.set(p.name.toLowerCase(), p.name)
  for (const b of p.bare ?? []) BARE_SURNAMES.set(b, p.name)
}
/** Each full form as a whole-word, any-case pattern */
const PERSON_FORMS: Array<[RegExp, string]> = [...PERSON_BY_FORM].map(([form, name]) =>
  [new RegExp(`(?<![\\p{L}])${form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'iu'), name])

/** Job titles written before a name ("President Bola Tinubu", "Prime Minister Keir Starmer") */
const TITLE = String.raw`(?:(?:Vice|Deputy|Former|Ex-|Acting|Interim)\s+)*(?:President|Prime Minister|PM|Chief Minister|Foreign Minister|Defen[cs]e Minister|Finance Minister|Interior Minister|Minister|Chancellor|Crown Prince|King|Queen|Prince|Princess|Pope|Ayatollah|Sheikh|Emir|Sultan|Lt\.?\s*Gen\.?|Gen\.|General|Admiral|Secretary-General|Secretary General|Secretary of State|Secretary|Director-General|Director General|Director|Ambassador|Senator|Sen\.|Rep\.|Representative|Governor|Gov\.|Mayor|Speaker|Chief Justice|Judge|Dr\.|Prof\.|Professor|CEO|Chairman|Chairwoman|Commissioner|Commander|Envoy|Archbishop|Cardinal|Lord|Sir|Dame)`

/** A capitalised name word, or a particle inside a name ("bin", "von der") */
const NAME_WORD = String.raw`(?:[A-Z][a-zà-öø-ÿ'’.-]+(?:[A-Z][a-zà-öø-ÿ'’.-]+)*|[A-Z]{2,3}(?=\s))`
const PARTICLE = String.raw`(?:bin|ibn|al|el|de|da|di|van|von|der|le|la|du)`
const TITLED_NAME = new RegExp(String.raw`\b${TITLE}\s+(${NAME_WORD}(?:\s+(?:${PARTICLE}\s+)?${NAME_WORD}){0,3})`, 'g')

/** Words that end a name in a headline ("Trump Says…", "Tinubu Signs…") */
const NAME_ENDERS = new Set([
  'says', 'said', 'warns', 'calls', 'urges', 'vows', 'meets', 'visits', 'signs', 'announces', 'rejects',
  'accuses', 'slams', 'praises', 'backs', 'blames', 'orders', 'wins', 'loses', 'dies', 'resigns', 'arrives',
  'leaves', 'hails', 'condemns', 'denies', 'confirms', 'plans', 'seeks', 'faces', 'asks', 'tells', 'insists',
  'threatens', 'defends', 'pledges', 'promises', 'launches', 'unveils', 'admits', 'approves', 'bans', 'fires',
  'names', 'picks', 'appoints', 'sacks', 'sues', 'joins', 'quits', 'rules', 'swears', 'speaks', 'responds',
  'reacts', 'agrees', 'expects', 'wants', 'needs', 'gets', 'has', 'is', 'was', 'will', 'to', 'and', 'or', 'of',
  'the', 'in', 'on', 'at', 'for', 'with', 'as', 'after', 'over', 'by', 'from', 'amid', 'ahead', 'during', 'after',
  'sells', 'buys', 'raises', 'cuts', 'takes', 'makes', 'gives', 'steps', 'lands', 'opens', 'closes', 'hits',
  'adds', 'drops', 'pushes', 'lashes', 'doubles', 'hosts', 'heads', 'leads', 'returns', 'reveals', 'sets',
  'talks', 'touts', 'weighs', 'eyes', 'hails', 'mocks', 'meet', 'say', 'set', 'vs', 'vs.', 'v', 'v.',
  'jr', 'jr.', 'sr', 'sr.',
])

/** Words that are never part of a person's name ("Chief Executive Officer", "Chief Election Commissioner") */
const NOT_NAME = new Set([
  'executive', 'officer', 'office', 'ministry', 'minister', 'council', 'court', 'department', 'general', 'bank',
  'house', 'party', 'committee', 'government', 'administration', 'republic', 'union', 'agency', 'authority',
  'commission', 'commissioner', 'forces', 'army', 'police', 'security', 'affairs', 'state', 'states', 'national',
  'international', 'federal', 'supreme', 'constitutional', 'central', 'election', 'electoral', 'former', 'new',
  'australian', 'american', 'british', 'indian', 'chinese', 'russian', 'nigerian', 'african', 'european',
  'operating', 'financial', 'technology', 'information', 'medical', 'health', 'education', 'defence', 'defense',
  'foreign', 'finance', 'interior', 'home', 'justice', 'trade', 'economy', 'energy', 'transport', 'staff',
  'deputy', 'vice', 'acting', 'interim', 'chief', 'head', 'leader', 'spokesperson', 'spokesman', 'spokeswoman',
  'secretary', 'director', 'president', 'prime', 'chairman', 'chair', 'board', 'group', 'company', 'corp',
  // words Title Case headlines put after a name ("Duterte Fit for Trial", "Allies Deepen Clash")
  'fit', 'clash', 'deepen', 'trial', 'talks', 'war', 'deal', 'plan', 'bill', 'law', 'vote', 'probe', 'case',
  'visit', 'ban', 'cut', 'hike', 'rise', 'fall', 'crisis', 'attack', 'strike', 'win', 'loss', 'row', 'rift',
  'push', 'bid', 'call', 'move', 'step', 'blow', 'boost', 'threat', 'warning', 'report', 'claims', 'top', 'big',
  'key', 'first', 'last', 'next', 'more', 'over', 'out', 'up', 'down', 'back', 'off', 'not', 'no', 'all', 'new',
  'steered', 'led', 'set', 'due', 'told', 'via', 'amid', 'despite', 'against', 'into', 'under', 'about',
])

/** A person's name as the graph keeps it: known people by their usual name, the rest as written */
export function canonicalPerson(raw: string): string | null {
  const words = raw.split(/\s+/).filter(Boolean)
  // A known person first, by the longest run of words that names one ("To Lam" before "to" ends a name)
  for (let n = Math.min(words.length, 5); n >= 1; n--) {
    const run = words.slice(0, n).join(' ').replace(/[’']s$/u, '').replace(/[.,;:]+$/, '').toLowerCase()
    const known = PERSON_BY_FORM.get(run) ?? (n === 1 ? BARE_SURNAMES.get(run) : undefined)
    if (known) return known
  }
  const kept: string[] = []
  for (const word of words) {
    const lower = word.toLowerCase().replace(/[.,;:]+$/, '')
    if (NAME_ENDERS.has(lower)) break
    // A possessive ends the name ("Diana’s Terrifying Crash" → "Diana")
    const possessive = /[’']s$/u.test(word)
    kept.push(word.replace(/[’']s$/u, '').replace(/[.,;:]+$/, ''))
    if (possessive) break
  }
  if (kept.length === 0 || kept.some(w => NOT_NAME.has(w.toLowerCase()))) return null
  const name = kept.join(' ')
  const lower = name.toLowerCase()
  const known = PERSON_BY_FORM.get(lower) ?? (kept.length === 1 ? BARE_SURNAMES.get(lower) : undefined)
  if (known) return known
  // One word after a title ("President Lee") is too little to know who
  return kept.length >= 2 ? name : null
}

// ─── ORGANISATIONS ───────────────────────────────────────────────────────────

/** Organisations: the words that name them → the name the graph keeps */
const ORGANISATIONS: Array<[RegExp, string]> = [
  [/\b(?:United Nations|UN)\b/g, 'UN'],
  [/\b(?:European Union|EU)\b/g, 'EU'],
  [/\bNATO\b/g, 'NATO'],
  [/\b(?:World Health Organi[sz]ation|WHO)\b/g, 'WHO'],
  [/\b(?:International Monetary Fund|IMF)\b/g, 'IMF'],
  [/\bWorld Bank\b/g, 'World Bank'],
  [/\b(?:World Trade Organi[sz]ation|WTO)\b/g, 'WTO'],
  [/\b(?:African Union|AU)\b/g, 'African Union'],
  [/\bASEAN\b/g, 'ASEAN'],
  [/\bOPEC\+?/g, 'OPEC'],
  [/\bBRICS\b/g, 'BRICS'],
  [/\bG7\b/g, 'G7'],
  [/\bG20\b/g, 'G20'],
  [/\b(?:International Atomic Energy Agency|IAEA)\b/g, 'International Atomic Energy Agency'],
  [/\b(?:International Criminal Court|ICC)\b/g, 'International Criminal Court'],
  [/\b(?:International Court of Justice|ICJ)\b/g, 'International Court of Justice'],
  [/\b(?:International Committee of the Red Cross|ICRC)\b/g, 'International Committee of the Red Cross'],
  [/\bUNHCR\b/g, 'UNHCR'],
  [/\bUNICEF\b/g, 'UNICEF'],
  [/\b(?:World Food Programme|WFP)\b/g, 'World Food Programme'],
  [/\bOPCW\b/g, 'Organisation for the Prohibition of Chemical Weapons'],
  [/\bHamas\b/g, 'Hamas'],
  [/\bHezbollah\b/g, 'Hezbollah'],
  [/\bHouthis?\b/g, 'Houthis'],
  [/\bTaliban\b/g, 'Taliban'],
  [/\b(?:Islamic State|ISIS|ISIL)\b/g, 'Islamic State'],
  [/\bal-Shabaab\b/gi, 'Al-Shabaab'],
  [/\b(?:Rapid Support Forces|RSF)\b/g, 'Rapid Support Forces'],
  [/\b(?:Israel Defense Forces|IDF)\b/g, 'Israel Defense Forces'],
  [/\bPentagon\b/g, 'Pentagon'],
  [/\bKremlin\b/g, 'Kremlin'],
  [/\bFederal Reserve\b/g, 'Federal Reserve'],
  [/\b(?:European Central Bank|ECB)\b/g, 'European Central Bank'],
]

/** An acronym in a shouted headline ("WHO WILL PAY?") is a word, not the organisation */
function inCapsRun(text: string, index: number, length: number): boolean {
  const before = text.slice(Math.max(0, index - 12), index).match(/([A-Za-z]+)\W*$/)?.[1] ?? ''
  const after = text.slice(index + length, index + length + 12).match(/^\W*([A-Za-z]+)/)?.[1] ?? ''
  const shout = (w: string) => w.length >= 2 && w === w.toUpperCase()
  return shout(before) || shout(after)
}

// ─── COMMODITIES, WEAPONS, TECHNOLOGY ───────────────────────────────────────

/** Price, trade and output words that make "gold" or "coffee" a commodity (not a medal or a cup) */
const MARKET = String.raw`(?:prices?|futures|exports?|imports?|production|output|harvest|crops?|reserves|market|markets|shortages?|supply|supplies|mines?|mining|stocks|tariffs?|deals?)`

const COMMODITIES: Array<[RegExp, string]> = [
  [/\b(?:crude oil|crude prices?|brent|wti|oil prices?|oil exports?|oil imports?|oil output|oil production|oil supplies)\b/i, 'Crude oil'],
  [/\bpetroleum products?\b/i, 'Petroleum products'],
  [/\b(?:natural gas|LNG|liquefied natural gas)\b/i, 'Natural gas'],
  [new RegExp(String.raw`\b(?:gold ${MARKET}|price of gold|bullion)\b`, 'i'), 'Gold'],
  [new RegExp(String.raw`\bsilver ${MARKET}\b`, 'i'), 'Silver'],
  [/\bcopper\b/i, 'Copper'],
  [/\blithium\b/i, 'Lithium'],
  [/\bnickel\b/i, 'Nickel'],
  [/\bcobalt\b/i, 'Cobalt'],
  [/\brare earths?\b/i, 'Rare earths'],
  [/\buranium\b/i, 'Uranium'],
  [/\bwheat\b/i, 'Wheat'],
  [/\b(?:corn|maize)\b/i, 'Corn'],
  [/\bsoybeans?\b/i, 'Soybeans'],
  [new RegExp(String.raw`\brice ${MARKET}\b`, 'i'), 'Rice'],
  [new RegExp(String.raw`\b(?:coffee|cocoa|sugar|cotton) ${MARKET}\b`, 'i'), 'Soft commodities'],
  [/\bfertili[sz]ers?\b/i, 'Fertilizer'],
  [/\bcoal\b/i, 'Coal'],
  [/\biron ore\b/i, 'Iron ore'],
  [/\bsteel\b/i, 'Steel'],
  [/\balumin(?:i)?um\b/i, 'Aluminium'],
  [/\bpalm oil\b/i, 'Palm oil'],
]

const WEAPONS = /\b(?:ICBMs?|SLBMs?|IRBMs?|MANPADS?|HIMARS|ATACMS|S-[34]00|Patriot|Iron Dome|THAAD|F-(?:16|22|35)s?|Su-\d{2}|MiG-\d{2}|Iskander|Kalibr|Tomahawks?|Shahed(?:-\d+)?|Storm Shadow|Taurus)\b/g

const TECHNOLOGY: Array<[RegExp, string]> = [
  [/\b(?:semiconductors?|microchips?|chipmakers?)\b/i, 'Semiconductors'],
  [/\bblockchain\b/i, 'Blockchain'],
  [/\b(?:cryptocurrenc(?:y|ies)|crypto)\b/i, 'Cryptocurrency'],
  [/\bbitcoin\b/i, 'Bitcoin'],
  [/\bethereum\b/i, 'Ethereum'],
  [/\bquantum computing\b/i, 'Quantum computing'],
  [/\b(?:5G|6G)\b/, '5G/6G'],
  [/\bCBDCs?\b/, 'Central bank digital currency'],
  [/\b(?:LLMs?|large language models?)\b/i, 'Large language models'],
  [/\bCRISPR\b/, 'CRISPR'],
  [/\bfusion (?:reactor|energy|power)\b/i, 'Fusion energy'],
]

// ─── EXTRACTION ──────────────────────────────────────────────────────────────

/** At most this many entities per signal */
const MAX_ENTITIES = 10

export function extractEntitiesByRules(title: string, body: string | null): RuleEntity[] {
  const text = `${title}. ${body ?? ''}`
  const out: RuleEntity[] = []
  const seen = new Set<string>()
  const add = (name: string | null, type: RuleEntityType, salience: number) => {
    if (!name) return
    const key = `${type}:${name.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ name, type, salience })
  }

  // People: titled names, full names of well-known people, and their surnames on their own
  for (const m of text.matchAll(TITLED_NAME)) add(canonicalPerson(m[1]!), 'person', 0.7)
  for (const [re, name] of PERSON_FORMS) if (re.test(text)) add(name, 'person', 0.7)
  for (const m of text.matchAll(/\b[A-Z][a-zà-öø-ÿ]+\b/g)) {
    const known = BARE_SURNAMES.get(m[0].toLowerCase())
    if (known) add(known, 'person', 0.7)
  }

  for (const [re, name] of ORGANISATIONS) {
    for (const m of text.matchAll(re)) {
      if (m[0] === m[0].toUpperCase() && inCapsRun(text, m.index ?? 0, m[0].length)) continue
      add(name, 'organisation', 0.6)
      break
    }
  }

  const places = placesInText(text)
  places.forEach((place: string, i: number) => add(place, 'location', i === 0 ? 0.6 : 0.5))
  morePlacesInText(title, body, places).forEach(place => add(place, 'location', 0.5))

  for (const m of text.matchAll(WEAPONS)) add(m[0].replace(/s$/, ''), 'weapon_system', 0.8)
  for (const [re, name] of COMMODITIES) if (re.test(text)) add(name, 'commodity', 0.5)
  for (const [re, name] of TECHNOLOGY) if (re.test(text)) add(name, 'technology', 0.5)

  return out.slice(0, MAX_ENTITIES)
}

// ─── MORE PLACES (world-places.ts) ──────────────────────────────────────────
// Oct 22, 2026: the gazetteer knows about 300 places, so nearly half of the
// week's reports were linked to no person, place or organisation. These are
// the world's cities of 300,000 people or more, its capitals and the states of
// the countries whose outlets name them most, matched only where the words
// around them say it's the place: "in Sokoto", "Kano State", "Harare," — not
// "Santiago Peña", "Real Madrid" or "Kathmandu Post".

const unaccent = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The name without accents, in lower case → the name as stored */
const MORE_PLACES = new Map<string, string>()
for (const name of [...WORLD_CITIES, ...WORLD_REGIONS]) {
  const key = unaccent(name).toLowerCase()
  if (!MORE_PLACES.has(key)) MORE_PLACES.set(key, name)
}
const MORE_PLACES_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:${[...MORE_PLACES.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})(?![\p{L}\p{N}])`,
  'giu',
)

/** A word after the name that keeps it the place: "Kano State", "Harare Airport" */
const PLACE_NEXT = new Set([
  'state', 'city', 'province', 'region', 'district', 'county', 'division', 'governorate', 'oblast', 'prefecture',
  'municipality', 'metropolitan', 'metro', 'airport', 'port', 'valley', 'area', 'township', 'department', 'territory',
  'island', 'islands', 'coast', 'bay', 'lake', 'river', 'harbour', 'harbor', 'highway', 'expressway', 'road', 'street',
  'hospital', 'university', 'high', 'court', 'police', 'council', 'assembly', 'government', 'governor', 'mayor', 'zone',
])
/** A capitalised word before the name that keeps it the place: "In Sokoto", "De Bogotá", "Greater Accra" */
const PLACE_BEFORE = new Set([
  'in', 'at', 'from', 'to', 'for', 'of', 'on', 'near', 'across', 'over', 'outside', 'inside', 'around', 'into', 'the', 'and',
  'or', 'with', 'by', 'after', 'before', 'via', 'between', 'en', 'de', 'del', 'la', 'el', 'a', 'em', 'no', 'na', 'do', 'da',
  'dos', 'das', 'au', 'du', 'le', 'dans', 'desde', 'para', 'por', 'hacia', 'entre', 'sur', 'north', 'south', 'east', 'west',
  'central', 'greater', 'downtown', 'northern', 'southern', 'eastern', 'western', 'northeast', 'northwest', 'southeast',
  'southwest', 'rural', 'coastal',
])
/** Clubs named after their city: the name is the club, not the place */
const CLUB_BEFORE = new Set([
  'real', 'atletico', 'athletic', 'fc', 'ac', 'as', 'sc', 'cf', 'inter', 'sporting', 'olympique', 'dynamo', 'dinamo',
  'deportivo', 'racing', 'club', 'union', 'borussia', 'lokomotiv', 'spartak', 'zenit', 'rb', 'vfb', 'werder', 'hertha',
  'eintracht', 'fortuna', 'hellas', 'stade',
])
const CLUB_AFTER = new Set([
  'fc', 'cf', 'sc', 'united', 'wanderers', 'rovers', 'athletic', 'pillars', 'rangers', 'indians', 'capitals', 'kings',
  'royals', 'titans', 'sunrisers', 'heat', 'lakers', 'warriors', 'bulls', 'giants', 'knights', 'stars', 'raiders',
])

const startsUpper = (w: string) => /^\p{Lu}/u.test(w)
/** The word right before `at`, with only spaces between ("Lewis" in "Lewis Hamilton"); none after punctuation */
function wordBefore(text: string, at: number): string | null {
  return /([\p{L}][\p{L}'’-]*)[ \t]+$/u.exec(text.slice(Math.max(0, at - 40), at))?.[1] ?? null
}
/** The word right after `end`, with only spaces between; none before punctuation */
function wordAfter(text: string, end: number): string | null {
  return /^[ \t]+([\p{L}][\p{L}'’-]*)/u.exec(text.slice(end, end + 40))?.[1] ?? null
}
/** A Headline In Title Case, where capitals say nothing about names */
function titleCased(title: string): boolean {
  const long = (title.match(/\p{L}[\p{L}'’-]*/gu) ?? []).filter(w => w.length >= 4)
  return long.length >= 3 && long.filter(startsUpper).length / long.length >= 0.9
}

/** Places from world-places.ts the text names (at most 3), beyond `known` (what placesInText found) */
export function morePlacesInText(title: string, body: string | null, known: readonly string[] = []): string[] {
  const text = unaccent(`${title}. ${body ?? ''}`)
  const titleEnd = unaccent(title).length
  const titleCase = titleCased(title)
  const knownKeys = known.map(k => ` ${unaccent(k).toLowerCase()} `)
  const out: string[] = []
  for (const m of text.matchAll(MORE_PLACES_RE)) {
    if (out.length >= 3) break
    const name = MORE_PLACES.get(m[0].toLowerCase())
    if (!name || out.includes(name)) continue
    const at = m.index ?? 0
    const end = at + m[0].length
    // Capitals where the name has them ("Sokoto", not "sokoto"); an acronym isn't the place ("IMO" is not Imo)
    const want = unaccent(name).split(/\s+/)
    const got = m[0].split(/\s+/)
    if (!got.every((w, i) => !startsUpper(want[i] ?? '') || startsUpper(w))) continue
    if (m[0].length > 2 && m[0] === m[0].toUpperCase() && name !== name.toUpperCase()) continue
    // One place counts once: "New York City" where "New York" was found, "Guatemala City" where Guatemala was
    const key = ` ${m[0].toLowerCase()} `
    if (knownKeys.some(k => k.includes(key) || key.includes(k))) continue
    const before = wordBefore(text, at)
    const after = wordAfter(text, end)
    if (before && CLUB_BEFORE.has(before.toLowerCase())) continue
    if (after && CLUB_AFTER.has(after.toLowerCase())) continue
    // A capitalised word after it makes it part of a name ("Santiago Peña", "Kathmandu Post"), unless it's a place word
    if (after && startsUpper(after) && !PLACE_NEXT.has(after.toLowerCase())) continue
    // ...and one before it too ("Lewis Hamilton"), except in a Title Case headline, after "in"/"De" and after "Nigeria's"
    const inTitleCase = titleCase && at < titleEnd
    if (before && startsUpper(before) && !inTitleCase && !PLACE_BEFORE.has(before.toLowerCase()) && !/['’]s$/.test(before)) continue
    out.push(name)
  }
  return out
}

// ─── CLEANING ENTITIES ALREADY STORED (the start-up repair) ─────────────────

const LEADING_TITLES = new RegExp(String.raw`^(?:${TITLE}\s+)+`)

const MONTHS_AND_DAYS = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november',
  'december', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
])

/** Words the old "in <Capitalised>" rule stored as places */
const NOT_PLACES = new Set([
  'county', 'strait', 'source', 'province', 'district', 'region', 'state', 'city', 'island', 'islands', 'bay',
  'gulf', 'sea', 'river', 'valley', 'north', 'south', 'east', 'west', 'central', 'northern', 'southern',
  'eastern', 'western', 'the', 'this', 'that', 'today', 'tonight', 'morning', 'evening', 'week', 'year',
  'israeli', 'kurdish', 'iranian', 'russian', 'chinese', 'indian', 'british', 'american', 'palestinian',
  'ukrainian', 'nigerian', 'pakistani', 'afghan', 'syrian', 'iraqi', 'lebanese', 'turkish', 'french', 'german',
  'japanese', 'korean', 'egyptian', 'sudanese', 'somali', 'ethiopian', 'kenyan', 'mexican', 'brazilian',
  'canadian', 'australian', 'european', 'african', 'asian', 'arab', 'muslim', 'christian', 'jewish', 'hindu',
  'sikh', 'buddhist', 'catholic', 'english', 'spanish', 'portuguese', 'arabic', 'parliament', 'congress',
  'senate', 'court', 'government', 'police', 'army', 'military', 'president', 'minister',
])

/**
 * What a stored entity should be: its type and name under these rules, or
 * null when it's not an entity at all ("April" as a place, "Chief Executive
 * Officer" as a person).
 */
export function cleanStoredEntity(type: string, name: string): { type: string; name: string } | null {
  const trimmed = name.trim()
  if (type === 'person') {
    const person = canonicalPerson(trimmed.replace(LEADING_TITLES, ''))
    return person ? { type, name: person } : null
  }
  if (type === 'location') {
    const lower = trimmed.toLowerCase()
    if (MONTHS_AND_DAYS.has(lower) || NOT_PLACES.has(lower)) return null
    if (BARE_SURNAMES.has(lower) || PERSON_BY_FORM.has(lower)) return null
    for (const [re, commodity] of COMMODITIES) if (re.test(trimmed)) return { type: 'commodity', name: commodity }
    for (const [re, tech] of TECHNOLOGY) if (re.test(trimmed)) return { type: 'technology', name: tech }
    return { type, name: trimmed }
  }
  if (type === 'organisation') {
    for (const [re, org] of ORGANISATIONS) {
      re.lastIndex = 0
      const hit = re.exec(trimmed)
      re.lastIndex = 0
      if (hit && hit[0].length === trimmed.length) return { type, name: org }
    }
    return { type, name: trimmed }
  }
  if (type === 'technology') {
    for (const [re, tech] of TECHNOLOGY) if (re.test(trimmed)) return { type, name: tech }
  }
  return { type, name: trimmed }
}
