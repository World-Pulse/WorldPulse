/**
 * The World Map's news layers found by headline (Oct 21, 2026, Devon: "I
 * still think there is a gap in the mapping features"): protests and unrest,
 * disease outbreaks, and refugees and displacement, three of the kinds of
 * layer World Monitor has and WorldPulse didn't.
 *
 * As for the Ships and Naval layers (lib/sea-headlines.ts), the database finds
 * the candidates with ONE pattern per topic, so the query stays fast, and the
 * finer checks run here on the few hundred candidates. The words are in
 * English, French, Spanish and Portuguese, the languages of the feeds.
 *
 * Measured on 3,800 headlines of Oct 21 (03:14 to 13:40 UTC) before the
 * rules were final: "rally" alone brought in stock rallies, the Dakar Rally
 * and campaign rallies, so it counts only "against", "outside" or "in
 * protest"; "pandemic" was mostly history and economics ("the pandemic-era
 * loans"), so it's out; an outbreak "of violence" isn't a disease.
 */

export type MapTopic = 'protests' | 'outbreaks' | 'displacement'

export const MAP_TOPICS: readonly MapTopic[] = ['protests', 'outbreaks', 'displacement']

export interface MapTopicRule {
  /** Words and phrases that make a candidate: regular expressions both PostgreSQL and JavaScript read (no lookarounds) */
  words: string[]
  /** Phrases with those words that aren't the topic */
  not: string[]
  /** Hours of reports the layer shows */
  hours: number
  /** Categories left out */
  skipCategories: string[]
}

const ARTS = ['sports', 'culture', 'entertainment']

export const MAP_TOPIC_RULES: Record<MapTopic, MapTopicRule> = {
  protests: {
    hours: 48,
    skipCategories: ARTS,
    words: [
      'protests?', 'protesters?', 'protestors?', 'protested', 'protesting',
      'demonstrations?', 'demonstrators?',
      'riots?', 'rioters?', 'rioting', 'tear ?gas',
      'sit-ins?', 'walkouts?', 'strike action', 'on strike', 'general strike', 'hunger strikes?',
      "(nationwide|national|indefinite|workers['’]?|teachers['’]?|doctors['’]?|nurses['’]?|drivers['’]?|dockworkers['’]?|rail|transport|labou?r) strikes?",
      'down(ed)? tools', 'pickets?', 'picketing', 'picket lines?',
      'marched', 'marchers', 'uprisings?', 'unrest',
      '(rally|rallies|rallied|rallying) (against|outside|in protest)',
      // French, Spanish, Portuguese
      'manifestante?s?', 'manifestaciones', 'manifestações', 'grèves?', 'émeutes?', 'émeutiers',
      'protestas?', 'protestos?', 'huelgas?', 'disturbios', 'greves?',
    ],
    not: [
      'protest votes?', 'under protest',
      'demonstrations? of (force|strength|power|support|how)',
      '(product|live|cooking|technology|tech) demonstrations?',
      'demonstration (flight|day|project|plant|model|video)',
      'riot games', 'riot of colou?rs?', 'picket fences?',
    ],
  },
  outbreaks: {
    hours: 72,
    skipCategories: ARTS,
    words: [
      'outbreaks?', 'epidemics?', 'cholera', 'measles', 'mpox', 'monkeypox', 'ebola', 'marburg',
      'dengue', 'malaria', 'bird flu', 'avian (influenza|flu)', 'h5n1', 'h5n5', 'h7n9', 'polio',
      'diphtheria', 'yellow fever', 'plague', 'anthrax', 'meningitis', 'nipah', 'lassa', 'typhoid',
      'west nile', 'chikungunya', 'zika', 'rabies', 'hepatitis [a-e]', 'tuberculosis', 'norovirus',
      'salmonella', 'listeria', 'legionnaires', 'leptospirosis', 'foot-and-mouth', 'african swine fever',
      'whooping cough', 'pertussis', 'scarlet fever', 'hantavirus', 'oropouche', 'rift valley fever',
      // French, Spanish, Portuguese
      'épidémies?', 'choléra', 'rougeole', 'paludisme', 'fièvre jaune', 'variole', 'méningite', 'grippe aviaire',
      'brotes? de', 'epidemias?', 'cólera', 'sarampión', 'paludismo', 'fiebre amarilla', 'gripe aviar', 'viruela',
      'surtos?', 'sarampo', 'febre amarela', 'gripe aviária', 'varíola',
    ],
    not: [
      'outbreaks? of (violence|fighting|war|hostilities|fires?|protests?|unrest|clashes|riots?|anger|panic)',
      '(loneliness|obesity|violence|gun|opioid|drug|fentanyl|fraud|scam|cyber|misinformation|disinformation|vaping|addiction|homelessness|crime) epidemics?',
      'epidemics? of (loneliness|obesity|violence|guns?|drugs?|fraud|scams?|misinformation|crime)',
      'brotes? de (violencia|ira|protestas?)',
    ],
  },
  displacement: {
    hours: 168,
    skipCategories: [...ARTS, 'economy', 'finance', 'technology'],
    words: [
      'refugees?', 'displaced', 'displacing', 'displacement', 'idps', 'internally displaced',
      'asylum', 'asylum[- ]seekers?', 'fled (their )?homes?', 'forced to flee', 'flee(ing)? (their )?homes?',
      'evacuees', 'mass evacuations?', 'exodus', 'unhcr', 'international organi[sz]ation for migration',
      'migrant (boats?|vessels?|camps?|crossings?)', 'migrants? (drown(ed)?|missing|rescued|dead|died|stranded|detained)',
      // one person's deportation isn't displacement ("Canada orders deportation of Toronto man")
      'mass deportations?', 'deportation flights?', 'stateless',
      // French, Spanish, Portuguese
      // ("asilo" alone is also an old people's home)
      'réfugiés?', 'déplacés', "demandeurs? d['’]asile", "demandes? d['’]asile", 'refugiados?', 'desplazados?',
      'solicitantes de asilo', 'solicitudes de asilo', 'peticiones de asilo', 'pedidos de asilo', 'deslocados',
    ],
    not: [
      'displaced (workers?|employees?|jobs?)', '(job|worker|engine|water) displacement',
      'displacement of (water|air|jobs?|workers?)', 'tax refugees?',
      'exodus of (talent|investors|capital|money|users|customers|advertisers|players|staff|executives|fans)',
      'refugee (film|movie|novel|book|album)',
    ],
  },
}

export function isMapTopic(value: unknown): value is MapTopic {
  return typeof value === 'string' && (MAP_TOPICS as readonly string[]).includes(value)
}

/** What the database looks for: the topic's words, from word start to word end (PostgreSQL, ~*) */
export function topicCandidate(topic: MapTopic): string {
  return `\\m(${MAP_TOPIC_RULES[topic].words.join('|')})\\M`
}

// JavaScript's \b knows only ASCII letters ("émeutes" has none before its é),
// so word edges are any letter or digit, in any script
const EDGE_BEFORE = '(?<![\\p{L}\\p{N}])'
const EDGE_AFTER  = '(?![\\p{L}\\p{N}])'

function anyOf(alternatives: string[]): RegExp {
  return new RegExp(`${EDGE_BEFORE}(?:${alternatives.join('|')})${EDGE_AFTER}`, 'iu')
}

const WORDS = Object.fromEntries(MAP_TOPICS.map(t => [t, anyOf(MAP_TOPIC_RULES[t].words)])) as Record<MapTopic, RegExp>
const NOT   = Object.fromEntries(MAP_TOPICS.map(t => [t, anyOf(MAP_TOPIC_RULES[t].not)])) as Record<MapTopic, RegExp>

/** Opinion pieces and letters are about a topic, not a place where it's happening */
const OPINION = /^\s*(opinion|op-ed|editorial|letters?|column)\s*[:|–—-]/i

/** Whether a report belongs on the topic's layer */
export function isTopicReport(topic: MapTopic, title: string, category?: string | null): boolean {
  const rule = MAP_TOPIC_RULES[topic]
  if (category && rule.skipCategories.includes(String(category).toLowerCase())) return false
  if (!title || OPINION.test(title)) return false
  return WORDS[topic].test(title) && !NOT[topic].test(title)
}
