/**
 * How serious a story is, without the LLM (plan item 0u). Used by the RSS
 * reader and by the classifier's rule-based fallback, which rate every signal
 * while OpenAI is out of credit.
 *
 * The old rules looked for single words: any "dead" or "killed" made a story
 * high (a flood report saying "0 deaths" too), "alert" or "breaking" made it
 * high, any "nuclear" or "collapse" made it critical ("nuclear talks",
 * "talks collapse"), while "Twelve killed and 300 injured in attack on
 * airport" was only medium, because "killed" had to be followed by a digit.
 * These rules count the dead and injured, and weigh the kind of event.
 */

import type { SignalSeverity } from '@worldpulse/types'

const RANK: Record<SignalSeverity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 }
const BY_RANK: SignalSeverity[] = ['info', 'low', 'medium', 'high', 'critical']

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  dozen: 12, dozens: 24, scores: 40, hundred: 100, hundreds: 200, thousand: 1000, thousands: 2000,
  a: 1, an: 1,
}

const COUNT = String.raw`(\d[\d,.]*\+?|(?:a |an )?(?:${Object.keys(NUMBER_WORDS).filter(w => w !== 'a' && w !== 'an').join('|')}))`
const PEOPLE = String.raw`(?:\s+(?:more\s+)?(?:people|persons|civilians|soldiers|troops|children|kids|students|workers|migrants|passengers|police(?:men)?|officers|militants|fighters|villagers|residents|pilgrims|miners|others|men|women|family members|members))?`

/** "12 killed", "Twelve dead", "300 people injured", "Nine people, including children, dead" */
const COUNT_THEN = (words: string) => new RegExp(String.raw`(?:^|[^\w])${COUNT}${PEOPLE}(?:\s*,[^,.]{1,40},)?\s+(?:were\s+|are\s+|have\s+been\s+|feared\s+|reported\s+)?(?:${words})\b`, 'gi')
/** "kills 12", "killing at least 40", "death toll rises to 30" */
const THEN_COUNT = (words: string) => new RegExp(String.raw`\b(?:${words})\s+(?:at\s+least\s+|more\s+than\s+|over\s+|nearly\s+|about\s+|around\s+|some\s+|up\s+to\s+)?${COUNT}\b`, 'gi')

const DEATH_AFTER = COUNT_THEN('killed|dead|die|died|dies|deaths|slain|fatalities|perish(?:ed)?|lives\\s+lost|bodies\\s+found')
const DEATH_BEFORE = THEN_COUNT('kills?|killing|killed|death\\s+toll\\s+(?:rises|climbs|jumps|reaches|hits|at|of|to)(?:\\s+to)?|toll\\s+(?:rises|climbs)\\s+to|claims\\s+the\\s+lives\\s+of')
const INJURED_AFTER = COUNT_THEN('injured|wounded|hurt|hospitali[sz]ed')
const INJURED_BEFORE = THEN_COUNT('injur(?:e|es|ing|ed)|wound(?:s|ing|ed)?')

function toNumber(raw: string): number {
  const clean = raw.trim().toLowerCase().replace(/^(?:a|an)\s+/, '')
  const digits = clean.replace(/[,+]/g, '')
  if (/^\d+(\.\d+)?$/.test(digits)) return Number(digits)
  return NUMBER_WORDS[clean] ?? 0
}

function largest(text: string, patterns: RegExp[]): number {
  let max = 0
  for (const re of patterns) {
    re.lastIndex = 0
    for (const m of text.matchAll(re)) {
      const n = toNumber(m[1] ?? '')
      // years and money aren't casualties ("2026 deaths" is rare; "$300 killed" never)
      if (n > max && n < 1_000_000 && !(n >= 1900 && n <= 2100)) max = n
    }
  }
  return max
}

/** The dead and injured a text reports (largest numbers it gives) */
export function casualties(text: string): { dead: number; injured: number; deathsNamed: boolean } {
  const dead = largest(text, [DEATH_AFTER, DEATH_BEFORE])
  const injured = largest(text, [INJURED_AFTER, INJURED_BEFORE])
  // A death without a number ("Man dies after…", "killed in strike")
  const deathsNamed = dead > 0 || /\b(?:kills?|killed|killing|dies|died|dead|deaths?|shot dead|murdered|slain|drown(?:s|ed|ing)?)\b/i.test(text)
  return { dead, injured, deathsNamed }
}

/** The kind of event, by its most serious words */
const EVENT_RULES: Array<[RegExp, SignalSeverity]> = [
  [/\b(?:nuclear (?:attack|strike|explosion|detonation|test|leak|meltdown|accident)s?|nuclear weapons? (?:used|launched|fired)|chemical (?:attack|weapons? attack)s?|mass[- ]casualt(?:y|ies)|dirty bomb|bioterror\w*|pandemic declared|declares? (?:a )?(?:global )?pandemic)\b/i, 'critical'],
  [/\b(?:air ?strikes?|missile (?:strikes?|attacks?|barrages?)|drone (?:strikes?|attacks?)|ballistic missiles?|bombings?|suicide (?:bomber|bombing|attack)s?|car bombs?|explosions?|blasts? (?:at|in|near|hits|rocks|kills)|shelling|invasion|invades?|coup|assassinat\w*|hostages?|terror(?:ist)? attacks?|mass shootings?|massacres?|gunmen|ambush(?:ed)?|state of emergency|emergency declared|declares? (?:a |an )?emergency|nuclear (?:threats?|alerts?|emergency|incidents?)|martial law|declares? war|declaration of war|famine|(?:ebola|cholera|marburg|plague|mpox) outbreaks?|tsunamis?|hurricanes?|typhoons?|cyclones?|category [345]|magnitude[- ]?[6-9](?:\.\d)?|[6-9](?:\.\d)?[- ]magnitude|(?:major|powerful|strong|huge|deadly) (?:earth)?quakes?|eruptions?|airport attacks?|hijack\w*)\b/i, 'high'],
  [/\b(?:attack(?:s|ed|ing)?|strikes? on|clash(?:es|ed)?|fighting|offensive|troops|military|missiles?|drones?|militants?|insurgents?|rebels?|protest(?:s|ers?|ed|ing)?|riot(?:s|ers|ing)?|unrest|emergency|ebola|cholera|marburg|mpox|curfew|arrest(?:s|ed)?|detain(?:s|ed)?|detention|crackdown|execut(?:ion|ions|ed|es)|terror\w*|shoots|shot|sanctions?|tariffs?|earthquakes?|quakes?|floods?|flooding|wildfires?|landslides?|storms?|heatwaves?|droughts?|outbreaks?|epidemic|cyber ?attacks?|ransomware|hack(?:ed|ers?)|data breach(?:es)?|evacuat\w*|shootings?|stabbings?|crash(?:es)?|derail\w*|building collapses?|elections?|referendum|impeach\w*|resign(?:s|ed|ation)?|ceasefire|truce|peace talks|summit)\b/i, 'medium'],
]

/** Hundreds of thousands without power, displaced or evacuated */
const MASS_IMPACT = /\b(?:\d{2,3},\d{3}|\d+(?:\.\d+)? million|hundreds of thousands|millions)(?:\s+(?:people|homes|households|customers|residents))?\s+(?:(?:are|were|left|remain)\s+)?(?:without power|displaced|evacuated|homeless|forced to flee)\b/i

/** Opinion and analysis rather than news (never above medium) */
const OPINION = /\b(?:opinion|op-?ed|editorial|commentary|analysis|column|perspective|review|podcast|explainer|what (?:we|you) (?:know|need to know))\b/i

/**
 * Severity from the headline and summary: the dead and injured it counts
 * (100+ dead critical; 5+ dead, 100+ injured or hundreds of thousands
 * without power or displaced high; any death or 10+ injured medium) and the
 * kind of event (a nuclear or chemical attack or mass casualties critical;
 * strikes, bombings, coups, massacres, major quakes and storms high;
 * fighting, protests, disasters, arrests medium), whichever is higher;
 * opinion and analysis stop at medium. Conflict and disaster stories are at
 * least medium.
 */
export function rateSeverity(title: string, body: string | null = null, category?: string | null): SignalSeverity {
  const headline = title ?? ''
  const text = `${headline}. ${body ?? ''}`
  const { dead, injured, deathsNamed } = casualties(text)

  // Fighting and disasters are at least medium, whatever the words
  let rank = category === 'conflict' || category === 'disaster' ? RANK.medium : RANK.low
  if (dead >= 100) rank = RANK.critical
  else if (dead >= 5 || injured >= 100 || MASS_IMPACT.test(text)) rank = RANK.high
  else if (deathsNamed || injured >= 10) rank = Math.max(rank, RANK.medium)

  // Event words count in the headline; in the summary they lift a story to medium at most
  for (const [re, severity] of EVENT_RULES) {
    if (re.test(headline)) { rank = Math.max(rank, RANK[severity]); break }
  }
  if (rank < RANK.medium) {
    for (const [re] of EVENT_RULES) {
      if (body && re.test(body)) { rank = RANK.medium; break }
    }
  }

  if (OPINION.test(headline)) rank = Math.min(rank, RANK.medium)
  return BY_RANK[rank]!
}
