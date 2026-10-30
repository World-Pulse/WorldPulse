/**
 * The words around a place name that say whether it is the place (Oct 22,
 * 2026): "in Sokoto", "Kano State", "Harare Airport" are places; "Santiago
 * Peña", "Paris Hilton", "Real Madrid", "Lewis Hamilton", "Houston Rockets"
 * are people and clubs. Used by the city list's matches (entity-rules.ts
 * morePlacesInText, plan 0s2) and, since 0s5, by the gazetteer's (geo.ts):
 * map pins, Knowledge Graph places and same-story places.
 */

/** A word after the name that keeps it the place: "Kano State", "Harare Airport" */
export const PLACE_NEXT = new Set([
  'state', 'city', 'province', 'region', 'district', 'county', 'division', 'governorate', 'oblast', 'prefecture',
  'municipality', 'metropolitan', 'metro', 'airport', 'port', 'valley', 'area', 'township', 'department', 'territory',
  'island', 'islands', 'coast', 'bay', 'lake', 'river', 'harbour', 'harbor', 'highway', 'expressway', 'road', 'street',
  'hospital', 'university', 'high', 'court', 'police', 'council', 'assembly', 'government', 'governor', 'mayor', 'zone',
])
/** A capitalised word before the name that keeps it the place: "In Sokoto", "De Bogotá", "Greater Accra" */
export const PLACE_BEFORE = new Set([
  'in', 'at', 'from', 'to', 'for', 'of', 'on', 'near', 'across', 'over', 'outside', 'inside', 'around', 'into', 'the', 'and',
  'or', 'with', 'by', 'after', 'before', 'via', 'between', 'en', 'de', 'del', 'la', 'el', 'a', 'em', 'no', 'na', 'do', 'da',
  'dos', 'das', 'au', 'du', 'le', 'dans', 'desde', 'para', 'por', 'hacia', 'entre', 'sur', 'north', 'south', 'east', 'west',
  'central', 'greater', 'downtown', 'northern', 'southern', 'eastern', 'western', 'northeast', 'northwest', 'southeast',
  'southwest', 'rural', 'coastal',
])
/** Clubs named after their city: the name is the club, not the place */
export const CLUB_BEFORE = new Set([
  'real', 'atletico', 'athletic', 'fc', 'ac', 'as', 'sc', 'cf', 'inter', 'sporting', 'olympique', 'dynamo', 'dinamo',
  'deportivo', 'racing', 'club', 'union', 'borussia', 'lokomotiv', 'spartak', 'zenit', 'rb', 'vfb', 'werder', 'hertha',
  'eintracht', 'fortuna', 'hellas', 'stade',
])
export const CLUB_AFTER = new Set([
  'fc', 'cf', 'sc', 'united', 'wanderers', 'rovers', 'athletic', 'pillars', 'rangers', 'indians', 'capitals', 'kings',
  'royals', 'titans', 'sunrisers', 'heat', 'lakers', 'warriors', 'bulls', 'giants', 'knights', 'stars', 'raiders',
])

export const startsUpper = (w: string) => /^\p{Lu}/u.test(w)
/** The word right before `at`, with only spaces between ("Lewis" in "Lewis Hamilton"); none after punctuation */
export function wordBefore(text: string, at: number): string | null {
  return /([\p{L}][\p{L}'’-]*)[ \t]+$/u.exec(text.slice(Math.max(0, at - 40), at))?.[1] ?? null
}
/** The word right after `end`, with only spaces between; none before punctuation */
export function wordAfter(text: string, end: number): string | null {
  return /^[ \t]+([\p{L}][\p{L}'’-]*)/u.exec(text.slice(end, end + 40))?.[1] ?? null
}
/** A Headline In Title Case, where capitals say nothing about names */
export function titleCased(title: string): boolean {
  const long = (title.match(/\p{L}[\p{L}'’-]*/gu) ?? []).filter(w => w.length >= 4)
  return long.length >= 3 && long.filter(startsUpper).length / long.length >= 0.9
}

/** Words after a gazetteer place that keep it the place, beyond PLACE_NEXT ("Gaza Strip", "Khartoum North", "Beirut blast") */
const GAZETTEER_NEXT = new Set([
  ...PLACE_NEXT,
  'strip', 'north', 'south', 'east', 'west', 'countryside', 'suburb', 'suburbs', 'outskirts', 'centre', 'center',
  'station', 'square', 'bridge', 'border', 'crossing', 'camp', 'base', 'refinery', 'plant', 'mosque', 'church',
  'cathedral', 'temple', 'market', 'stadium', 'prison', 'jail', 'embassy', 'consulate', 'hotel', 'mall', 'school',
  'protest', 'protests', 'protesters', 'attack', 'attacks', 'blast', 'bombing', 'explosion', 'fire', 'floods', 'flooding',
  'quake', 'earthquake', 'shooting', 'strike', 'strikes', 'summit', 'talks', 'marathon', 'subway', 'office', 'residents',
  'police', 'mayor', 'governor', 'council', 'authorities', 'officials',
  'democrat', 'democrats', 'democratic', 'republican', 'republicans', 'senator', 'sen', 'congressman', 'congresswoman',
  'lawmaker', 'lawmakers', 'legislature', 'legislator', 'delegate', 'delegation', 'voters', 'primary', 'election',
])

/**
 * Gazetteer places that are also first names or surnames ("Santiago Peña",
 * "Paris Hilton", "Sydney Sweeney", "Lewis Hamilton", "Whitney Houston"):
 * only for these do the capitals around decide. A capitalised word next to
 * any other place is usually part of the place's own story ("Kolkata Durga
 * Puja", "Dhaka Medical College", "Karnataka CM", "Toronto Crime Stoppers").
 */
const FIRST_NAME_PLACES = new Set([
  'santiago', 'paris', 'sydney', 'houston', 'austin', 'charlotte', 'florence', 'victoria', 'madison', 'georgia',
  'chelsea', 'phoenix', 'dallas', 'orlando', 'regina', 'adelaide', 'valencia', 'salvador', 'milan', 'nancy', 'sofia',
  'alexandria', 'savannah', 'aurora', 'augusta', 'eugene', 'virginia', 'carolina', 'dakota', 'montana', 'jordan',
  'lincoln', 'hamilton', 'washington', 'jackson', 'carson', 'warren', 'nelson', 'kent', 'preston', 'cleveland',
  'tyler', 'quincy', 'raleigh', 'denver', 'chester', 'kingston', 'wellington', 'columbia', 'troy', 'marion',
])
/** Of those, the ones that are surnames too: a capitalised first name before them makes a person ("Lewis Hamilton") */
const SURNAME_PLACES = new Set([
  'hamilton', 'houston', 'washington', 'jackson', 'austin', 'madison', 'lincoln', 'carson', 'warren', 'nelson', 'kent',
  'preston', 'cleveland', 'tyler', 'quincy', 'raleigh', 'denver', 'chester', 'kingston', 'wellington', 'jordan', 'marion',
])
/** Capitalised words before a place that don't make it a person's surname */
const NOT_FIRST_NAMES = new Set([
  ...PLACE_BEFORE, 'as', 'if', 'when', 'while', 'amid', 'despite', 'how', 'why', 'what', 'where', 'but', 'so', 'now',
  'top', 'new', 'old', 'big', 'democratic', 'democrat', 'democrats', 'republican', 'republicans', 'gop', 'labour',
  'conservative', 'liberal', 'federal', 'state', 'city', 'county', 'metro', 'greater', 'downtown', 'suburban',
])

/**
 * A club's word as clubs write it: capitalised ("Real", "United"), and the
 * two- and three-letter ones in capitals ("AS Roma", "FC Porto"): "as Kyiv
 * was hit" and "a Miami heat wave" name the places.
 */
function clubWord(word: string, set: Set<string>): boolean {
  if (!set.has(word.toLowerCase()) || !startsUpper(word)) return false
  return word.length > 3 || word === word.toUpperCase()
}

/** Whether the word right before `at` begins its sentence (a capital there says nothing) */
function startsSentence(text: string, at: number): boolean {
  const left = text.slice(Math.max(0, at - 60), at).replace(/[\p{L}'’-]+[ \t]+$/u, '')
  return /(?:^|[.!?:;|—–"“(]\s*)$/u.test(left)
}

/**
 * Whether the words around it are A Headline In Title Case, where capitals
 * say nothing about names: the words of the same sentence, up to 8 each side
 */
export function titleCaseAround(text: string, at: number, end: number): boolean {
  const left = text.slice(Math.max(0, at - 120), at).split(/[.!?|\n]\s/).pop() ?? ''
  const right = text.slice(end, end + 120).split(/[.!?|\n]\s/)[0] ?? ''
  const words = (left.match(/\p{L}[\p{L}'’-]*/gu) ?? []).slice(-8).concat((right.match(/\p{L}[\p{L}'’-]*/gu) ?? []).slice(0, 8))
  const long = words.filter(w => w.length >= 4)
  return long.length >= 3 && long.filter(startsUpper).length / long.length >= 0.85
}

/** Words that say "Colorado" in a text is the Colorado party: its abbreviation, full name, or its members */
const COLORADO_PARTY = /\bANR\b|\bcolorados\b|asociaci[oó]n nacional republicana/i

/**
 * Whether the place name at text[at, end) is part of a name, not the place:
 * a club ("Real Madrid", "Manchester United", "Kano Pillars"), or, for a place
 * that is also a first name or surname and outside a Title Case headline, a
 * capitalised word right after it that isn't a place word ("Santiago Peña",
 * "Paris Hilton", "Sydney Sweeney", "Houston Rockets"), or a first name right
 * before a surname-place ("Lewis Hamilton", "Whitney Houston"). Text in
 * lower case says nothing: false.
 */
export function partOfAName(text: string, at: number, end: number): boolean {
  const hit = text.slice(at, end)
  // Paraguay's and Uruguay's Colorado party (ANR), not the US state (Oct 30, 2026: a Paraguayan
  // party-registration story was pinned in Denver)
  if (hit.toLowerCase() === 'colorado' && (wordBefore(text, at)?.toLowerCase() === 'partido' || COLORADO_PARTY.test(text))) return true
  if (!startsUpper(hit)) return false
  const before = wordBefore(text, at)
  const after = wordAfter(text, end)
  if (before && clubWord(before, CLUB_BEFORE)) return true
  if (after && clubWord(after, CLUB_AFTER)) return true
  const key = hit.toLowerCase()
  if (!FIRST_NAME_PLACES.has(key) || titleCaseAround(text, at, end)) return false
  if (after && startsUpper(after) && !GAZETTEER_NEXT.has(after.toLowerCase())) return true
  if (SURNAME_PLACES.has(key) && before && startsUpper(before) && !NOT_FIRST_NAMES.has(before.toLowerCase())
    && !/['’]s$/.test(before) && !startsSentence(text, at)) return true
  return false
}
