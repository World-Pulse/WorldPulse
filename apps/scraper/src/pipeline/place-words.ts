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
  'eintracht', 'fortuna', 'hellas', 'stade', 'bayern',
])
export const CLUB_AFTER = new Set([
  'fc', 'cf', 'sc', 'united', 'wanderers', 'rovers', 'athletic', 'pillars', 'rangers', 'indians', 'capitals', 'kings',
  'royals', 'titans', 'sunrisers', 'heat', 'lakers', 'warriors', 'bulls', 'giants', 'knights', 'stars', 'raiders',
  'saint-germain',
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
  // Nov 6, 2026: big cities read everywhere since (make_gazetteer.py's READ_EVERYWHERE) or by their own outlets, that
  // are names too: "Samara Weaving", "Kobe Bryant", "Irvine Welsh", "Odessa Young", a company or a team ("Boston
  // Celtics", "Providence Health", "Bristol Myers Squibb", "Heidelberg Materials")
  'boston', 'cali', 'samara', 'odessa', 'kobe', 'bristol', 'providence', 'irvine', 'metz', 'hanover', 'heidelberg',
  'cartagena',
])
/** Of those, the ones that are surnames too: a capitalised first name before them makes a person ("Lewis Hamilton") */
const SURNAME_PLACES = new Set([
  'hamilton', 'houston', 'washington', 'jackson', 'austin', 'madison', 'lincoln', 'carson', 'warren', 'nelson', 'kent',
  'preston', 'cleveland', 'tyler', 'quincy', 'raleigh', 'denver', 'chester', 'kingston', 'wellington', 'jordan', 'marion',
  'phoenix', 'irvine', 'metz',
])
/**
 * A title before a first-name place makes a person, in any headline: "Princess Charlotte", "Queen Victoria", "Lord
 * Nelson", "Dr Austin Demby" (Nov 6, 2026: a Sierra Leonean health centre opening was pinned in Texas), "Sen. Warren"
 */
const TITLES = new Set([
  'prince', 'princess', 'queen', 'king', 'lady', 'lord', 'sir', 'dame', 'duke', 'duchess', 'emperor', 'empress',
  'príncipe', 'princesa', 'reina', 'rey', 'infanta', 'infante', 'princesse', 'reine', 'roi', 'prinz', 'prinzessin',
  'königin', 'könig', 'principessa', 'regina',
  'dr', 'mr', 'mrs', 'ms', 'prof', 'professor', 'doctor', 'rev', 'reverend', 'pastor', 'father', 'bishop', 'imam',
  'sheikh', 'senator', 'sen', 'rep', 'president', 'judge', 'coach', 'captain', 'capt', 'gen', 'col', 'sgt', 'detective',
  'sr', 'sra', 'señor', 'señora', 'dra', 'monsieur', 'madame', 'mme', 'herr', 'frau',
])
/**
 * Common given names, written without accents: one right before a surname-place makes a person even where capitals
 * say nothing, at a sentence's start or in A Headline In Title Case (Nov 6, 2026: the day's stories began "Lewis
 * Hamilton will celebrate", "Elizabeth Warren's Power", "Paris Jackson seeks", "Luis Hamilton: Lekler"). Not the names
 * that are everyday words too (Will, Mark, Grace, May, Frank).
 */
const GIVEN_NAMES = new Set([
  'james', 'john', 'robert', 'michael', 'william', 'david', 'richard', 'joseph', 'thomas', 'charles', 'christopher',
  'daniel', 'matthew', 'anthony', 'donald', 'steven', 'paul', 'andrew', 'joshua', 'kenneth', 'kevin', 'brian', 'george',
  'timothy', 'ronald', 'edward', 'jason', 'jeffrey', 'ryan', 'jacob', 'gary', 'nicholas', 'eric', 'jonathan', 'stephen',
  'larry', 'justin', 'scott', 'brandon', 'benjamin', 'samuel', 'gregory', 'alexander', 'patrick', 'raymond', 'jack',
  'dennis', 'jerry', 'aaron', 'jose', 'adam', 'nathan', 'henry', 'douglas', 'zachary', 'peter', 'kyle', 'ethan',
  'walter', 'noah', 'jeremy', 'keith', 'roger', 'terry', 'gerald', 'harold', 'sean', 'carl', 'arthur',
  'lawrence', 'dylan', 'jesse', 'bryan', 'billy', 'joe', 'bruce', 'gabriel', 'logan', 'albert', 'willie', 'alan', 'juan',
  'wayne', 'elijah', 'randy', 'roy', 'vincent', 'ralph', 'eugene', 'russell', 'bobby', 'mason', 'philip', 'louis',
  'lewis', 'luis', 'carlos', 'jorge', 'pedro', 'miguel', 'antonio', 'manuel', 'francisco', 'javier', 'rafael',
  'fernando', 'diego', 'alejandro', 'ricardo', 'eduardo', 'sergio', 'pablo', 'andres', 'joaquin', 'mario', 'roberto',
  'jesus', 'marco', 'paulo', 'joao', 'lucas', 'gustavo', 'felipe', 'rodrigo', 'thiago', 'mateus', 'jean', 'pierre',
  'michel', 'philippe', 'alain', 'jacques', 'francois', 'nicolas', 'olivier', 'laurent', 'emmanuel', 'mohamed',
  'muhammad', 'mohammed', 'ahmed', 'ali', 'hassan', 'hussein', 'omar', 'ibrahim', 'mustafa', 'khalid', 'abdul', 'rahul',
  'amit', 'arjun', 'vijay', 'sanjay', 'ravi', 'suresh', 'ramesh', 'hans', 'klaus', 'stefan', 'markus',
  'giuseppe', 'giovanni', 'luca', 'alessandro', 'jude', 'jobe', 'rory', 'harry', 'oliver', 'charlie', 'liam',
  'mary', 'patricia', 'jennifer', 'linda', 'elizabeth', 'barbara', 'susan', 'jessica', 'sarah', 'karen', 'lisa', 'nancy',
  'betty', 'sandra', 'margaret', 'ashley', 'kimberly', 'emily', 'donna', 'michelle', 'carol', 'amanda', 'melissa',
  'deborah', 'stephanie', 'rebecca', 'laura', 'sharon', 'cynthia', 'kathleen', 'amy', 'angela', 'shirley', 'brenda',
  'emma', 'anna', 'pamela', 'nicole', 'samantha', 'katherine', 'christine', 'helen', 'debra', 'rachel', 'carolyn',
  'janet', 'maria', 'catherine', 'heather', 'diane', 'olivia', 'julie', 'joyce', 'ruth', 'lauren', 'kelly', 'christina',
  'joan', 'evelyn', 'judith', 'andrea', 'hannah', 'megan', 'cheryl', 'jacqueline', 'martha', 'teresa', 'gloria', 'sara',
  'janice', 'ann', 'kathryn', 'abigail', 'sophia', 'frances', 'alice', 'judy', 'isabella', 'julia', 'amber', 'denise',
  'danielle', 'marilyn', 'beverly', 'natalie', 'theresa', 'diana', 'brittany', 'doris', 'kayla', 'alexis', 'lori',
  'marie', 'paris', 'whitney', 'taylor', 'kamala', 'hillary', 'ana', 'lucia', 'carmen', 'isabel', 'sofia', 'camila',
  'valentina', 'fernanda', 'juliana', 'beatriz', 'claire', 'sophie', 'nathalie', 'isabelle', 'fatima', 'aisha', 'priya',
  // West Africa's (Nov 7, 2026)
  'issa', 'moussa', 'ousmane', 'amadou', 'mamadou', 'abdoulaye', 'ibrahima', 'seydou', 'boubacar', 'souleymane', 'aliou',
  'modou', 'lamine', 'kofi', 'kwame', 'kwaku', 'kojo', 'kwabena', 'aminata', 'fatoumata', 'mariam',
  // Nov 9, 2026: "Deputy CM Pawan Kalyan to part ways with wife" (The Hindu) sat in Kalyan, Maharashtra
  'pawan',
])
/** The small words inside people's names, and not places': "José dos Santos", "Ludwig van Beethoven" */
const NAME_PARTICLES = new Set(['dos', 'das', 'van', 'von', 'bin', 'ibn'])
/** Capitalised words before a place that don't make it a person's surname */
const NOT_FIRST_NAMES = new Set([
  ...PLACE_BEFORE, 'as', 'if', 'when', 'while', 'amid', 'despite', 'how', 'why', 'what', 'where', 'but', 'so', 'now',
  'top', 'new', 'old', 'big', 'democratic', 'democrat', 'democrats', 'republican', 'republicans', 'gop', 'labour',
  'conservative', 'liberal', 'federal', 'state', 'city', 'county', 'metro', 'greater', 'downtown', 'suburban',
  // a place's kind before its name: "Isla Colón", "Estado Lara", "Ciudad Hidalgo"
  'isla', 'islas', 'ilha', 'île', 'ciudad', 'cidade', 'puerto', 'villa', 'vila', 'provincia', 'província', 'departamento',
  'estado', 'distrito', 'municipio', 'región', 'cantón', 'parroquia', 'commune', 'préfecture', 'wilaya', 'lake', 'mount',
  'fort', 'port', 'cape', 'cabo', 'lago', 'río', 'rio', 'valle', 'monte', 'porto', 'ilha', 'cidade', 'bairro',
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

/**
 * Whether the words right before and after the name are capitalised, outside a Title Case run: the name sits inside a
 * person's ("Aleida Sofía Silvestre", "Octavio Ondó Oyono")
 */
export function betweenNames(text: string, at: number, end: number): boolean {
  const before = wordBefore(text, at)
  const after = wordAfter(text, end)
  return !!before && !!after && startsUpper(before) && startsUpper(after) && !NOT_FIRST_NAMES.has(before.toLowerCase())
    && !GAZETTEER_NEXT.has(after.toLowerCase()) && !titleCaseAround(text, at, end)
}

/** Whether a capitalised name comes right before, outside a Title Case run, even at a sentence's start ("Frida Sofía niega") */
export function afterAName(text: string, at: number, end: number): boolean {
  const before = wordBefore(text, at)
  return !!before && startsUpper(before) && !NOT_FIRST_NAMES.has(before.toLowerCase()) && !titleCaseAround(text, at, end)
}

/** Words that say "Colorado" in a text is the Colorado party: its abbreviation, full name, or its members */
const COLORADO_PARTY = /\bANR\b|\bcolorados\b|asociaci[oó]n nacional republicana/i

/**
 * A capitalised word after a city that makes it a treaty's name, not the place (M57, Oct 30, 2026: "Vietnam
 * improves compliance score under Cape Town Convention in aviation" was pinned in Cape Town): the Geneva
 * Conventions, the Kyoto Protocol, the Paris Agreement, the Oslo Accords, the Rome Statute, the Washington
 * Consensus, the Budapest Memorandum. Lower case ("the Paris agreement reached on Monday") says nothing.
 */
const DOCUMENT_AFTER = new Set([
  'convention', 'conventions', 'protocol', 'protocols', 'accord', 'accords', 'agreement', 'agreements', 'treaty',
  'statute', 'consensus', 'memorandum',
  // Nov 6, 2026: "Aqaba Process AI security summit underway in Astana" was pinned in Aqaba; the Aqaba, Istanbul,
  // Doha and Rabat Processes are talks, held anywhere
  'process', 'declaration', 'pact',
])

/**
 * Whether the place name at text[at, end) is part of a name, not the place:
 * a club ("Real Madrid", "Manchester United", "Kano Pillars"), or, for a place
 * that is also a first name or surname and outside a Title Case headline, a
 * capitalised word right after it that isn't a place word ("Santiago Peña",
 * "Paris Hilton", "Sydney Sweeney", "Houston Rockets"), or a first name right
 * before a surname-place ("Lewis Hamilton", "Whitney Houston"). Text in
 * lower case says nothing: false. `surname`: the place is also a surname, like those of SURNAME_PLACES
 * (world-gazetteer.ts's home towns: "Armando León", "Dion George's").
 */
export function partOfAName(text: string, at: number, end: number, surname?: boolean): boolean {
  const hit = text.slice(at, end)
  // Paraguay's and Uruguay's Colorado party (ANR), not the US state (Oct 30, 2026: a Paraguayan
  // party-registration story was pinned in Denver)
  if (hit.toLowerCase() === 'colorado' && (wordBefore(text, at)?.toLowerCase() === 'partido' || COLORADO_PARTY.test(text))) return true
  // Lower-case "colorado" is Spanish for the party's people ("el oficialismo colorado", M57, Oct 30, 2026:
  // pinned in Denver); the US state is always written with a capital
  if (hit === 'colorado') return true
  // B.C. is British Columbia, but "500 B.C." and "the 3rd century B.C." are the era
  if (hit === 'B.C.' && /(?:\d|century|millennium|circa|ca\.|before)\s*$/i.test(text.slice(Math.max(0, at - 14), at))) return true
  // The Dakar Rally, not the city (M57, Oct 30, 2026: "El Dakar 2027 arrancará en Portugal" was pinned in
  // Senegal; the rally left Africa in 2009): "Dakar 2027", "Dakar Rally", "Rallye Dakar", "el/le/the Dakar"
  // except "Dakar 2026", the Youth Olympic Games in the city itself (Nov 8, 2026: "JOJ Dakar 2026 : le Sénégal s'offre
  // ses premières médailles d'or" was pinned at the country, not Dakar); "Rallye Dakar 2026" still counts by its "rallye"
  if (hit.toLowerCase() === 'dakar' && (/^[ \t]*(?:20(?!26)\d\d|rall(?:y|ye))\b/i.test(text.slice(end, end + 12))
    || /\b(?:rall(?:y|ye)|the|el|le)[ \t]+$/i.test(text.slice(Math.max(0, at - 12), at)))) return true
  // Spanish "los lagos" is the lakes, not Lagos (Nov 6, 2026: "Los lagos de Palermo se secan" was pinned in Nigeria;
  // Chile's Los Lagos region is a gazetteer place of its own)
  if (hit.toLowerCase() === 'lagos' && wordBefore(text, at)?.toLowerCase() === 'los') return true
  // The UN envoy María Ángela Holguín, not Cuba's Holguín (Nov 10, 2026: the Cyprus Mail's "Holguin meeting keeps Cyprus
  // talks going" was pinned in Cuba): her name after a given name or "envoy", or the surname with a meeting, talks or visit
  if (/^holgu[ií]n$/i.test(hit) && (/\b(?:mar[ií]a[ \t]+[AÁ]ngela|[AÁ]ngela|envoy|ms\.?|mrs\.?)[ \t]+$/i.test(text.slice(Math.max(0, at - 16), at))
    || /^[ \t]+(?:meeting|meetings|talks|visit|visits|proposal|report|says|said|will|has|met|to[ \t]+(?:meet|visit))\b/i.test(text.slice(end, end + 14)))) return true
  if (!startsUpper(hit)) return false
  // A ship named after a place, not the place (Nov 6, 2026: Antara's "Indonesia, US navies honor USS Houston in joint
  // dive"): "USS Houston", "HMS Belfast", "INS Mumbai", "the MV Ruby"
  if (/(?:^|[^\p{L}])(?:USS|USNS|HMS|HMAS|HMCS|HMNZS|INS|PNS|KRI|ROKS|MV|RV)[ \t]+$/u.test(text.slice(Math.max(0, at - 8), at))) return true
  // A virus or a fever named after a place, not the place (Nov 6, 2026: "Bundibugyo virus disease" in a story on
  // the Congo's Ebola outbreak): "Marburg virus", "Lassa fever", "Rift Valley fever", "the Zaire strain"
  if (/^[ \t]+(?:virus|viruses|fever|ebolavirus|strain|variant)\b/i.test(text.slice(end, end + 14))) return true
  // The northern and southern lights, not Aurora, Colorado (Nov 6, 2026: "The Aurora Borealis May Appear In 10 States")
  if (hit.toLowerCase() === 'aurora' && /^[ \t]+(?:borealis|australis)\b/i.test(text.slice(end, end + 12))) return true
  // HPE's Aruba networking business and the blue liqueur, not the islands (Nov 10, 2026: geo.ts, the Caribbean's territories)
  if (hit.toLowerCase() === 'aruba' && (/^[ \t]+network(?:s|ing)\b/i.test(text.slice(end, end + 14)) || /\bHPE[ \t]+$/.test(text.slice(Math.max(0, at - 6), at)))) return true
  if (/^cura[cç]ao$/i.test(hit) && /\bblue[ \t]+$/i.test(text.slice(Math.max(0, at - 6), at))) return true
  // An oil benchmark, not the place (Nov 6, 2026: oilprice.com's "West Texas Intermediate was trading at $91" was
  // pinned in Texas): "Brent crude" (Brent is also a London borough), "West Texas Intermediate", "Urals crude"
  if (/^(?:brent[ \t]+(?:crude|oil|futures|blend|benchmark|prices?)|(?:west[ \t]+)?texas[ \t]+intermediate|urals[ \t]+(?:crude|oil|blend|prices?)|(?:dubai|oman|murban)[ \t]+crude)\b/i.test(text.slice(at, end + 24))) return true
  // Malaysia's stock exchange, not Türkiye's Bursa (Nov 6, 2026: the NST's "Oil price slide hits Bursa energy stocks"
  // was pinned in Bursa; Malaysia's outlets' "Bursa" alone is the exchange too, geo.ts HOME_NAMES); a company named
  // after a place: "AngloGold Ashanti"
  if (hit.toLowerCase() === 'bursa' && /^[ \t]+Malaysia\b/.test(text.slice(end, end + 12))) return true
  if (/\bAngloGold[ \t]+$/.test(text.slice(Math.max(0, at - 12), at))) return true
  // A gang or a cartel named after its home, not the place: "the Tren de Aragua" (Nov 6, 2026: five stories on a
  // US reward for its leaders were pinned in Aragua), "el Cártel de Sinaloa", "the Sinaloa Cartel"
  if (/\b(?:tren|c[aá]rtel|cartel|clan)\s+(?:de|del)\s+$/i.test(text.slice(Math.max(0, at - 14), at))
    || /^[ \t]+c[aá]rtel\b/i.test(text.slice(end, end + 10))) return true
  // The other side in a match, a club named after its city, not the city (Nov 6, 2026: "absent du match de Ligue 1
  // contre Troyes" in a story on Morocco's Hakimi was pinned in Troyes): "le match contre Troyes", "the game against
  // Leeds", "el partido ante Huracán", after a score "2:1 - Der LASK erledigt die Pflichtübung gegen Tirol" (WSG
  // Tirol); where the match is played ("en Chillán") stays the place
  if (/(?:\b(?:match|matchs|rencontre|partido|jogo|partita|game|clash|fixture|derby|duel|spiel|partie)\b|(?<!\d)\d{1,2}[:-]\d{1,2}(?!\d))[^.!?]{0,60}\b(?:contre|contra|against|gegen|vs\.?|face\s+à|ante)[ \t]+$/i.test(text.slice(Math.max(0, at - 90), at))) return true
  // A French or Spanish document named after a place: "la Convention d'Accra", "l'Accord de Paris" (M57,
  // Oct 30, 2026: Gabon signing the Accra convention was pinned in Accra)
  if (/\b(?:convention|accords?|acuerdos?|protocole|protocolo|traité|tratado|déclaration|declaración|charte|pacte|pacto)\s+(?:d['’]|de\s+(?:la\s+|l['’])?)$/i.test(text.slice(Math.max(0, at - 30), at))) return true
  const before = wordBefore(text, at)
  const after = wordAfter(text, end)
  if (before && clubWord(before, CLUB_BEFORE)) return true
  if (after && clubWord(after, CLUB_AFTER)) return true
  if (after && startsUpper(after) && DOCUMENT_AFTER.has(after.toLowerCase())) return true
  // without accents: "Sofía" is the first name "sofia"
  const key = hit.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase()
  const title = /(\p{L}+)\.?[ \t]+$/u.exec(text.slice(Math.max(0, at - 24), at))?.[1]
  if (FIRST_NAME_PLACES.has(key) && title && startsUpper(title) && TITLES.has(title.toLowerCase())) return true
  // ...and so is any place right after one: "Jonathan Gambela" is a Congolese singer in Ouagadougou, "Issa Belém" a
  // Burkinabè sculptor (Nov 7, 2026: in Gambela, Ethiopia, and Belém, Brazil); until then only the places that are
  // common surnames ("Lewis Hamilton"). Not after a saint's name, part of a town's: "San Juan Sacatepéquez"
  const saint = /(?:^|[^\p{L}])(?:san|santa|santo|são|sao|saint|sainte|st|ste|sankt)\.?[ \t]+\p{L}+[ \t]+$/iu.test(text.slice(Math.max(0, at - 30), at))
  if (before && startsUpper(before) && !saint && GIVEN_NAMES.has(before.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase())) return true
  if (!(FIRST_NAME_PLACES.has(key) || surname) || titleCaseAround(text, at, end)) return false
  if (FIRST_NAME_PLACES.has(key) && after && startsUpper(after) && !GAZETTEER_NEXT.has(after.toLowerCase())) return true
  // ...or joined to it by a hyphen: "Bristol-Myers Squibb" (Nov 6, 2026), not "Boston-based"
  const joined = /^-(\p{Lu}[\p{L}'’]*)/u.exec(text.slice(end, end + 30))?.[1]
  if (FIRST_NAME_PLACES.has(key) && joined && !GAZETTEER_NEXT.has(joined.toLowerCase())) return true
  // ...also across a name's particle: "Zélia José dos Santos" (Nov 6, 2026); not "de" or "da", which places take
  // too ("la Ferme-Asile de Sion", "Prefeitura de Santos")
  if (surname && before && NAME_PARTICLES.has(before)) {
    const first = wordBefore(text, at - before.length - 1)
    if (first && startsUpper(first) && !NOT_FIRST_NAMES.has(first.toLowerCase()) && !startsSentence(text, at - before.length - 1)) return true
  }
  // not an acronym before it, a university's campus: "UC Irvine", "UT Austin"
  if ((SURNAME_PLACES.has(key) || surname) && before && startsUpper(before) && !NOT_FIRST_NAMES.has(before.toLowerCase())
    && before !== before.toUpperCase() && !/['’]s$/.test(before) && !startsSentence(text, at)) return true
  return false
}
