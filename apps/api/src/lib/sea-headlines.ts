/**
 * Which headlines are about the sea, for the map's Ships and Naval
 * intelligence layers (PostgreSQL patterns, used with ~* and !~*).
 *
 * Oct 19, 2026, after the layers' first hours live: "tanker" alone brought in
 * road fuel tankers (Lagos's Otedola Bridge, Edo's Oluku market, Oyo, Malawi)
 * and water tankers (Hyderabad, Kerala), about 20 of 246 stories, and a few
 * other words matched stories that aren't about the sea (a heart's lymphatic
 * vessels, a GPU that "will continue shipping", a freighter aircraft,
 * "gov'ship", Auckland's Upper Harbour Motorway, a game against Navy). Now a
 * tanker counts only with a word that makes it a ship, and those phrases are
 * left out.
 */

/**
 * Ship, port, strait and navy headlines: the Ships layer (in any category but
 * sport and culture). "tanker" isn't here: see TANKER_HEADLINE.
 */
export const MARITIME_HEADLINE = '\\m(ships?|vessels?|supertankers?|freighters?|cargo ships?|container ships?|bulk carriers?|seaports?|ports? of|ports? in|harbou?rs?|straits?|hormuz|bab el-mandeb|bab al-mandab|suez canal|panama canal|shipping|maritime|navy|navies|naval|warships?|destroyers?|frigates?|submarines?|aircraft carriers?|coast ?guard|ferry|ferries|piracy|pirates|seafarers?|oil spill|shipwreck|capsized|mariners?)\\M'

/**
 * A warship's name: USS, HMS, INS, HMAS or HMCS before a capital, matched
 * case-sensitively (with ~), so "break-ins" isn't the Indian Navy
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
