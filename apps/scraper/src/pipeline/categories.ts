/**
 * Word rules for a news item's category, used by both news paths while the
 * AI classifier is unavailable: the RSS reader (news-rss.ts, falling back to
 * the outlet's own category) and articles classified in classify.ts (article
 * groups from the sources table and GDELT events with an article, falling
 * back to politics, urgent wording, then "other").
 *
 * The headline is read first, and the article's opening only when the
 * headline says nothing: casualty reports quote a "health ministry", and Gaza
 * strikes came out as health. Rules are tried in order.
 *
 * Oct 11, 2026 (reading audit, H-0011): the Houthi attack on Riyadh airport
 * was filed as finance, the Pope's surgery as geopolitics or "other", a
 * Premier League match as geopolitics, and a migrant boat that sank with 109
 * dead as "other" (which also capped it at low severity). classify.ts's own
 * rules read the pronoun "who" as the WHO, "UN says" as geopolitics and any
 * "alert" in an article as breaking news: 213 of 1,185 recent GDELT events
 * were "health" (a novelist, a footballer's transfer talks, a Nile cruise).
 */

import type { Category } from '@worldpulse/types'

const SPORTS_RE = /\b(premier\s+league|champions\s+league|europa\s+league|la\s+liga|serie\s+a|bundesliga|ligue\s+1|world\s+cup|euro\s+20\d\d|olympics?|olympic\s+games|paralympics?|fifa|uefa|nba|nfl|nhl|mlb|pga|lpga|grand\s+prix|formula\s+(?:1|one)|wimbledon|french\s+open|australian\s+open|ryder\s+cup|super\s+bowl|test\s+match|ipl|t20|rugby|cricket|tennis|marathon|ufc|athletics|footballer|goalkeeper|midfielder|head\s+coach|transfer\s+window|hat-trick|player\s+of\s+the\s+year|soccer|strikers?|wingers?|relegation|ten\s+hag|cristiano\s+ronaldo|lionel\s+messi|football\s+(?:club|match|fans|manager|team|league|coach)|basketball|baseball|volleyball|badminton|gymnasts?|gymnastics|swimmers?|sprinters?|weightlift(?:er|ers|ing)|boxing(?!\s+day)|golfers?|tour\s+de\s+france|world\s+championships?|africa\s+cup\s+of\s+nations|afcon|asian\s+cup|copa\s+am[eé]rica|copa\s+libertadores|caf\s+champions\s+league|confederation\s+cup|champions\s+trophy)\b|\bvs\.?\b.{1,60}\blive\b/
// Before health: "scientists publish a study on a cancer treatment" is science
const SCIENCE_RE = /\b(scientists|researchers|study\s+(?:finds|found|shows|suggests)|peer[\s-]reviewed|clinical\s+trials?|genome|physicists?|chemists?|archaeologists?)\b/
// No "hospital" or "patients" here: strikes on hospitals are conflict (care
// words come after conflict, below)
const HEALTH_RE = /\b(pandemic|outbreak|virus|disease|epidemic|vaccines?|world\s+health\s+organi[sz]ation|health\s+(?:emergency|system|crisis|care)|healthcare|mental\s+health|pathogen|mpox|ebola|flu|covid|cholera|measles|malaria|dengue|tuberculosis|polio|h5n1|marburg|nipah|zika|anthrax|dementia|alzheimer'?s|diabetes|fda|surgery|cancer|tumou?r|diagnos(?:ed|is)|heart\s+attack|panic\s+attack|nhs)\b/
const DISASTER_RE = /\b(earthquake|tsunami|hurricane|typhoon|cyclone|wildfire|flood(?:s|ing)?|eruption|volcano|tornado|blizzard|drought|famine|disaster|landslides?|mudslides?|avalanche|heatwave|stampede|capsiz(?:e|es|ed|ing)|shipwreck|(?:boat|ship|ferry|vessel)\s+(?:sinks|sank|sinking)|sank|(?:plane|train|bus|helicopter)\s+crash(?:es|ed)?|(?:road|traffic|car|bus|train|rail|plane|boat|mine|mining|industrial|chemical|workplace)\s+accidents?|derailment|train\s+derail(?:s|ed)?|derailed\s+train|(?:building|bridge|mine|dam)\s+collapse|blaze|(?:house|building|factory|forest|bush|apartment|hotel|market)\s+fire|explosion\s+at\s+(?:a\s+)?(?:factory|plant|mine|refinery)|gas\s+(?:leak|explosion)|nuclear\s+(?:accident|leak|meltdown)|radiation\s+leak)\b/
// "Campaign" alone is as often military or advertising
const ELECTIONS_RE = /\b(elections?|votes?|voting|ballots?|democracy|referendum|polls?|candidates?|(?:election|presidential|political)\s+campaigns?|campaign\s+trail|campaigning|inauguration)\b/
const ECONOMY_RE = /\b(stock\s+markets?|stocks|recession|inflation|gdp|central\s+bank|federal\s+reserve|interest\s+rates?|economy|unemployment|trade\s+war|trade\s+deal|tariffs?|sanction|oil\s+price|crypto|currency|imf|world\s+bank|bankruptcy|exports?|imports?)\b/
// Space before technology, which also names SpaceX and NASA. No bare "moon"
// ("Moon Jae-in", "Ban Ki-moon") or "mars" (the chocolate company)
const SPACE_RE = /\b(space\s+launch|rockets?|satellites?|iss|international\s+space\s+station|lunar|moon\s+(?:landing|mission|base)|(?:to|on)\s+mars|mars\s+(?:rover|mission|landing)|nasa|esa|spacex|boeing\s+starliner|astronauts?)\b/
const TECH_RE = /\b(ai\s+|artificial\s+intelligence|cybersecurity|hack|data\s+breach|tech\s+giant|silicon\s+valley|openai|semiconductors?|chipmakers?)\b/
const CLIMATE_RE = /\b(climate\s+(?:change|action|crisis|policy|targets?|goals?|finance|summit|activists?)|global\s+warming|carbon|emissions|cop[0-9]+|fossil\s+fuel|renewable\s+energy|deforestation|sea\s+ice|glaciers?|ice\s+sheets?|sea\s+levels?|coral\s+reefs?|biodiversity|permafrost)\b/
// Before conflict, whose words include "attack"
const CYBER_RE = /\b(cyber\s*-?attacks?|ransomware|malware|phishing)\b/
// A zoo's tiger or a shark "attacks" and "kills" too: not conflict
const ANIMAL_RE = /\b(tigers?|sharks?|bears?|lions?|crocodiles?|alligators?|snakes?|dogs?|wildlife\s+park|zoo)\b/
// Diplomacy before conflict: "NATO summit agrees treaty" isn't fighting
const GEOPOLITICS_RE = /\b(summit|treaty|diplomats?|diplomatic|foreign\s+ministers?|ambassadors?|embassy|security\s+council|bilateral|multilateral|peace\s+talks)\b/
// (an animal's or a heart's attack isn't one)
const CONFLICT_RE = /\b(war|invasion|airstrikes?|air\s+strikes?|(?:israeli|russian|ukrainian|houthi|us|u\.s\.|drone|missile|military|deadly)\s+strikes?|strikes?\s+(?:on|kill(?:s|ed|ing)?|hits?|target(?:s|ed|ing)?)|missiles?|troops|military|casualties|conflict|nato|ceasefire|bombing|bombs?|killed|shelling|(?<!(?:tiger|shark|dog|bear|lion|crocodile|snake|animal|heart|panic)\s)(?:attacks?|attacked)|drones?|shooting|(?:mass|active|school|lone)\s+shooters?|shooter\s+(?:kills|killed|opens|opened)|shot\s+dead|(?:heavy|fierce|renewed|intense|deadly|escalating|street)\s+fighting|fighting\s+(?:in|between|erupts|erupted|rages|raged|continues|intensifies|escalates)|gunm[ae]n|gunfire|militants?|rebels?|insurgents?|clashes|artillery|explosions?|blasts?|hostages?|houthis?|hamas|hezbollah|taliban|isis|al-shabaab|frontline|massacre|siege|warplanes?|soldiers?)\b/
const SECURITY_RE = /\b(espionage|spy|spies|spying|intelligence|terror|terrorism|terrorists?|counter-?terrorism|nuclear\s+(?:threats?|weapons?|tests?|warheads?|alerts?))\b/
// Headlines only, after conflict: a strike on a hospital is conflict, a
// nursing shortage health, but "rushed to hospital" and a description's
// "medical evacuation" don't make a story about health
const CARE_RE = /\b(health|(?<!(?:to|from|in|at)\s)hospitals?|patients|doctors|physicians|nurses|nursing|medical|medicines?|maternity|clinics?|labou?r\s+and\s+delivery)\b/
const CULTURE_RE = /\b(films?|movies?|music|album|festival|celebrity|museum|exhibition|gallery|actor|actress|singer|concert|box\s+office|novels|novelist|memoir|(?:tv|television)\s+(?:series|shows?|drama)|sitcom|netflix|broadway|oscars|academy\s+awards?|emmys?|grammys?|baftas?|golden\s+globes?|anime|manga|fashion\s+(?:week|shows?))\b/

/** Rules for a headline and its description */
const RULES: Array<[RegExp, Category]> = [
  [SPORTS_RE, 'sports'],
  [SCIENCE_RE, 'science'],
  [HEALTH_RE, 'health'],
  [DISASTER_RE, 'disaster'],
  [ELECTIONS_RE, 'elections'],
  [ECONOMY_RE, 'economy'],
  [SPACE_RE, 'space'],
  [TECH_RE, 'technology'],
  [CLIMATE_RE, 'climate'],
  [CYBER_RE, 'security'],
  [ANIMAL_RE, 'other'],
  [GEOPOLITICS_RE, 'geopolitics'],
  [CONFLICT_RE, 'conflict'],
  [SECURITY_RE, 'security'],
  [CULTURE_RE, 'culture'],
]

/** Rules for a headline alone: the above, with care words before culture */
const HEADLINE_RULES: Array<[RegExp, Category]> = [...RULES.slice(0, -1), [CARE_RE, 'health'], RULES[RULES.length - 1]!]

function byRules(text: string, rules: Array<[RegExp, Category]>): Category | null {
  const lower = text.toLowerCase()
  for (const [re, category] of rules) if (re.test(lower)) return category
  return null
}

/** The category the words give: the headline's if it has one, else the headline and description's; null if neither */
export function categorizeText(title: string, description = ''): Category | null {
  return byRules(title, HEADLINE_RULES) ?? (description ? byRules(`${title} ${description}`, RULES) : null)
}

/**
 * Government and politics (filed as geopolitics, which the map calls
 * "Politics"): classify.ts's fallback when no rule above matches. The RSS
 * reader falls back to the outlet's own category instead.
 */
export const POLITICS_RE = /\b(president|prime\s+minister|parliament(?:ary)?|congress(?:ional)?|senate|senators?|lawmakers?|legislat(?:ure|ors?|ion)|government|ministers?|ministry|cabinet|opposition|governors?|mayors?|white\s+house|kremlin|downing\s+street|supreme\s+court|constitution(?:al)?|protests?|protesters?|demonstrat(?:ors?|ions?)|rally|rallies|impeach\w*|political|politicians?|ruling\s+party|party\s+(?:leader|chief|president|members?)|democrats?|republicans?|gop|tories|labour\s+party|bjp|trump|biden|putin|zelensk(?:y|yy)|xi\s+jinping|modi|netanyahu|erdo[gğ]an|macron|starmer|kim\s+jong[\s-]un|khamenei)\b/

/** Urgent wording: classify.ts's last resort before "other" */
export const BREAKING_RE = /\b(breaking|urgent|just\s+in|alerts?|developing\s+story|emergency|evacuation\s+orders?|state\s+of\s+emergency|major\s+incident)\b/

/**
 * An article's category from its words (classify.ts, while the AI classifier
 * is unavailable): the rules above on the headline and then its opening,
 * then politics, then urgent wording, else "other".
 */
export function categorizeArticle(title: string, body: string | null | undefined): Category {
  const opening = lede(body)
  const ruled = categorizeText(title, opening)
  if (ruled) return ruled
  const text = `${title} ${opening}`.toLowerCase()
  if (POLITICS_RE.test(text)) return 'geopolitics'
  if (BREAKING_RE.test(text)) return 'breaking'
  return 'other'
}

/** An article's opening, which says what happened (the rest of a long article mentions anything) */
export function lede(body: string | null | undefined, max = 400): string {
  const text = (body ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return space > max / 2 ? cut.slice(0, space) : cut
}
