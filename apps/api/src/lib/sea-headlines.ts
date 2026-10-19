/**
 * Which headlines are about the sea, for the map's Ships and Naval
 * intelligence layers.
 *
 * Oct 19, 2026, after the layers' first hours live: "tanker" alone brought in
 * road fuel tankers (Lagos's Otedola Bridge, Edo's Oluku market, Oyo, Malawi)
 * and water tankers (Hyderabad, Kerala), about 20 of 246 stories, and a few
 * other words matched stories that aren't about the sea (a heart's lymphatic
 * vessels, a GPU that "will continue shipping", a freighter aircraft,
 * "gov'ship", Auckland's Upper Harbour Motorway, a game against Navy). Now a
 * tanker counts only with a word that makes it a ship, and those phrases are
 * left out.
 *
 * The database only finds the candidates, with ONE pattern per story
 * (MARITIME_CANDIDATE): checking every story of the last 3 days against
 * several patterns took past the database's 5-second limit, and both layers
 * answered 500 (3:22 PM). The finer checks (isShipHeadline) run here, on the
 * few hundred candidates.
 */

const SEA_WORDS = 'ships?|vessels?|supertankers?|freighters?|cargo ships?|container ships?|bulk carriers?|seaports?|ports? of|ports? in|harbou?rs?|straits?|hormuz|bab el-mandeb|suez canal|panama canal|shipping|maritime|navy|navies|naval|warships?|destroyers?|frigates?|submarines?|aircraft carriers?|coast ?guard|ferry|ferries|piracy|pirates|seafarers?|oil spill|shipwreck|capsized|mariners?'

/** Ship, port, strait and navy words (PostgreSQL, ~*): "tanker" isn't here, see TANKER_HEADLINE */
export const MARITIME_HEADLINE = `\\m(${SEA_WORDS})\\M`

/** What the database looks for (one pattern, so the query stays fast): the sea words or "tanker" */
export const MARITIME_CANDIDATE = `\\m(tankers?|${SEA_WORDS})\\M`

/**
 * A warship's name: USS, HMS, INS, HMAS or HMCS before a capital, matched
 * case-sensitively, so "break-ins" isn't the Indian Navy
 */
export const NAVAL_SHIP_NAME = '\\m(USS|HMS|INS|HMAS|HMCS) [A-Z]'

/** "tanker" or "tankers": a ship only with TANKER_AT_SEA, and never a ROAD_TANKER */
export const TANKER_HEADLINE = '\\mtankers?\\M'

/** What makes a tanker a ship: its kind, its waters, or what happens to ships */
export const TANKER_AT_SEA = '\\m(oil|crude|chemical|product|lng|shadow|super|vlccs?|ulccs?|aframax|suezmax|panamax|lr1|lr2|hormuz|seas?|ocean|gulf|canal|channels?|coast|ukmto|kpler|irgc|mines?|rates?|fleet|charter\\w*|crews?|sanction\\w*|christen\\w*|anchor\\w*|attack\\w*|struck|projectiles?|drones?|missiles?|skiff|barging|bunker\\w*)\\M'

/** Fuel, water and other road tankers */
export const ROAD_TANKER = '\\m(water|fuel|petrol|diesel|gas|milk|lpg|cng|kerosene|sewage|septic|road) tankers?\\M|\\mtankers? (drivers?|trucks?|lorr(y|ies))\\M'

/** Phrases with those words that aren't about the sea */
export const NOT_AT_SEA = [
  '\\m(blood|lymph\\w*|coronary|retinal) vessels?\\M',
  '\\mvessels? for (unity|change|peace|hope)\\M',
  "\\w['’]ships?\\M",                                          // gov'ship (governorship)
  '\\mharbou?r (motorway|bridge|freeway|highway|tunnel)\\M',
  '\\mfreighters? (aircraft|jets?|planes?)\\M',
  '\\m(free|continues?|keeps?|starts?|begins?) shipping\\M',   // a product that ships
  '\\m(against|vs\\.?|versus|beats?|defeats?) navy\\M',         // Navy, the team
  '\\m(ex-|former |retired )(naval|navy)\\M',                   // a person, not a navy
].join('|')

/** A PostgreSQL pattern (word edges \m and \M) as a JavaScript RegExp (\b) */
export function pgToJs(pattern: string, flags = 'i'): RegExp {
  return new RegExp(pattern.replace(/\\m/g, '\\b').replace(/\\M/g, '\\b'), flags)
}

const SEA = pgToJs(MARITIME_HEADLINE)
const TANKER = pgToJs(TANKER_HEADLINE)
const TANKER_SHIP = pgToJs(TANKER_AT_SEA)
const ROAD = pgToJs(ROAD_TANKER)
const NOT_SEA = pgToJs(NOT_AT_SEA)

/** Not one of the phrases that aren't about the sea (both layers) */
export function notOffSea(title: string): boolean {
  return !NOT_SEA.test(title)
}

/** Ship news, for the Ships layer (on the database's candidates) */
export function isShipHeadline(title: string): boolean {
  if (!notOffSea(title)) return false
  if (SEA.test(title)) return true
  return TANKER.test(title) && TANKER_SHIP.test(title) && !ROAD.test(title)
}

/** A headline as a key, so the same story from another source, or a tracker's repeated report, shows once */
export function headlineKey(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** The first item for each key (the rows come newest first, so the newest) */
export function firstOfEach<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter(item => {
    const k = key(item)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
