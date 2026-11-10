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
import { literalText } from './figurative'
import { languageRules, type Slot } from './category-languages'

const SPORTS_RE = /\b(premier\s+league|champions\s+league|europa\s+league|la\s+liga|serie\s+a|bundesliga|ligue\s+1|world\s+cup|euro\s+20\d\d|olympics?|olympic\s+games|paralympics?|fifa|uefa|nba|nfl|nhl|mlb|pga|lpga|grand\s+prix|formula\s+(?:1|one)|wimbledon|french\s+open|australian\s+open|ryder\s+cup|super\s+bowl|test\s+match|ipl|t20|rugby|cricket|tennis|marathon|ufc|athletics|footballer|goalkeeper|midfielder|head\s+coach|transfer\s+window|hat-trick|player\s+of\s+the\s+year|soccer|strikers?|wingers?|relegation|ten\s+hag|cristiano\s+ronaldo|lionel\s+messi|football\s+(?:club|match|fans|manager|team|league|coach)|basketball|baseball|volleyball|badminton|gymnasts?|gymnastics|swimmers?|sprinters?|weightlift(?:er|ers|ing)|boxing(?!\s+day)|golfers?|tour\s+de\s+france|world\s+championships?|africa\s+cup\s+of\s+nations|afcon|asian\s+cup|copa\s+am[eé]rica|copa\s+libertadores|caf\s+champions\s+league|confederation\s+cup|champions\s+trophy)\b|\bvs\.?\b.{1,60}\blive\b/
// Before health: "scientists publish a study on a cancer treatment" is science
const SCIENCE_RE = /\b(scientists|researchers|study\s+(?:finds|found|shows|suggests)|peer[\s-]reviewed|clinical\s+trials?|genome|physicists?|chemists?|archaeologists?)\b/
// No "hospital" or "patients" here: strikes on hospitals are conflict (care
// words come after conflict, below)
const HEALTH_RE = /\b(pandemic|outbreak|virus|disease|epidemic|vaccines?|world\s+health\s+organi[sz]ation|health\s+(?:emergency|system|crisis|care)|healthcare|mental\s+health|pathogen|mpox|ebola|flu|covid|cholera|measles|malaria|dengue|tuberculosis|polio|h5n1|marburg|nipah|zika|anthrax|dementia|alzheimer'?s|diabetes|fda|surgery|cancer|tumou?r|diagnos(?:ed|is)|heart\s+attack|panic\s+attack|nhs|tuberculose|sarampo|sarampi[oó]n|rougeole|masern|paludisme|paludismo|mal[aá]ria|poliomielit(?:e|is)|vacunas?|vacinas?|c[aâá]ncer|cancro)\b/
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

/**
 * The rules in their order, each under its topic's name (category-languages.ts files French, Spanish, Portuguese
 * and German words under the same names, tried just before the English ones). The care words are read in
 * headlines only, after conflict.
 */
const SLOTS: ReadonlyArray<[Slot, RegExp, Category]> = [
  ['sports', SPORTS_RE, 'sports'],
  ['science', SCIENCE_RE, 'science'],
  ['health', HEALTH_RE, 'health'],
  ['disaster', DISASTER_RE, 'disaster'],
  ['elections', ELECTIONS_RE, 'elections'],
  ['economy', ECONOMY_RE, 'economy'],
  ['space', SPACE_RE, 'space'],
  ['technology', TECH_RE, 'technology'],
  ['climate', CLIMATE_RE, 'climate'],
  ['cyber', CYBER_RE, 'security'],
  ['animal', ANIMAL_RE, 'other'],
  ['geopolitics', GEOPOLITICS_RE, 'geopolitics'],
  ['conflict', CONFLICT_RE, 'conflict'],
  ['security', SECURITY_RE, 'security'],
  ['care', CARE_RE, 'health'],
  ['culture', CULTURE_RE, 'culture'],
]

/** A rule: its words, its topic, and whether it reads the text as written (a language's own words) or lower-cased (the English ones) */
type Rule = [RegExp, Category, boolean]

interface RuleSet {
  /** For a headline alone (with the care words) */
  headline: Rule[]
  /** For a headline and its description */
  text: Rule[]
  falseFriends?: RegExp
}

function ruleSet(lang: string | null): RuleSet {
  const own = languageRules(lang)
  // A language's own words read the headline only: in these languages' summaries they were as often background
  // (a footer's "Internet", a war's toll, "selon une étude") as the story
  const rules = (headline: boolean): Rule[] => SLOTS.flatMap(([slot, re, category]): Rule[] => slot === 'care' && !headline ? [] : [
    ...(headline ? own?.slots[slot] ?? [] : []).map((words): Rule => [words, category, true]),
    [re, category, false],
  ])
  return { headline: rules(true), text: rules(false), falseFriends: own?.falseFriends }
}

const RULE_SETS = new Map<string, RuleSet>()

/** The rules for a report's language: English's, or a language's own words before each topic's English ones */
function rulesFor(lang: string | null | undefined): RuleSet {
  const key = lang && languageRules(lang) ? lang : ''
  let rules = RULE_SETS.get(key)
  if (!rules) RULE_SETS.set(key, rules = ruleSet(key || null))
  return rules
}

function byRules(text: string, rules: Rule[], falseFriends?: RegExp): Category | null {
  // "the blue tsunami" of an election is no disaster (figurative.ts, Nov 8, 2026)
  const literal = literalText(text).normalize('NFC')
  // the English words don't read a German "war" ("was") or a French "j'ai" (category-languages.ts)
  const lower = (falseFriends ? literal.replace(falseFriends, ' ') : literal).toLowerCase()
  for (const [re, category, asWritten] of rules) if (re.test(asWritten ? literal : lower)) return category
  return null
}

/**
 * The category the words give: the headline's if it has one, else the headline and description's; null if neither.
 * A report in French, Spanish, Portuguese or German (its feed's language) is read in that language too (Nov 10, 2026).
 */
export function categorizeText(title: string, description = '', lang?: string | null): Category | null {
  const rules = rulesFor(lang)
  return byRules(title, rules.headline, rules.falseFriends)
    ?? (description ? byRules(`${title} ${description}`, rules.text, rules.falseFriends) : null)
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
export function categorizeArticle(title: string, body: string | null | undefined, lang?: string | null): Category {
  const opening = lede(body)
  const ruled = categorizeText(title, opening, lang)
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
