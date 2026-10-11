/**
 * GDELT event labels, and the titles built from them.
 *
 * A GDELT signal whose news article can't be fetched is titled from its event
 * code and place: "<label> in <place>", e.g. "Disapproval in White House,
 * District of Columbia, United States". Such a title says what kind of event
 * was coded where, not which story it is, so two of them from different
 * outlets are not the same story and must not verify each other (on Oct 10,
 * 2026 "Armed conflict in Washington, District of Columbia, United States"
 * turned verified that way).
 */

/** CAMEO root event codes (GDELT's event taxonomy) as plain labels */
export const CAMEO_LABEL: Record<string, string> = {
  '01': 'Public statement',
  '02': 'Appeal',
  '03': 'Intent to cooperate',
  '04': 'Consultation',
  '05': 'Diplomatic cooperation',
  '06': 'Material cooperation',
  '07': 'Humanitarian aid',
  '08': 'Concession',
  '09': 'Investigation',
  '10': 'Demand',
  '11': 'Disapproval',
  '12': 'Rejection',
  '13': 'Threat',
  '14': 'Protest',
  '15': 'Military show of force',
  '16': 'Diplomatic reduction',
  '17': 'Coercion',
  '18': 'Assault',
  '19': 'Armed conflict',
  '20': 'Mass atrocity',
}

const LABELS = `${Object.values(CAMEO_LABEL).join('|')}|CAMEO-\\d+`

// A GDELT place name: up to five comma-separated parts of capitalised words
// and the small words place names use ("District of Columbia", "Cabo de Hornos").
// A real headline that happens to start with a label ("Protest in Paris over
// pension reform") has other lowercase words, so it doesn't match.
const PLACE_WORD = `(?:\\p{Lu}[\\p{L}\\p{M}'’.\\-]*|of|the|and|de|del|la|el|al|an|du|da|do|dos|das|y|on)`
const PLACE_PART = `${PLACE_WORD}(?: ${PLACE_WORD})*`
const TEMPLATE_RE = new RegExp(`^(?:${LABELS})(?: in ${PLACE_PART}(?:, ${PLACE_PART}){0,4})?$`, 'u')

/** Whether a title is GDELT's "<event label> in <place>" fallback rather than a headline */
export function isEventTemplateTitle(title: string | null | undefined): boolean {
  return typeof title === 'string' && TEMPLATE_RE.test(title.trim())
}

/**
 * The same test for Postgres (`title ~ ?`), in POSIX regex classes. The repair
 * that uses it also requires the gdelt tag.
 */
const SQL_PLACE_WORD = "([[:upper:]][[:alpha:]'’.-]*|of|the|and|de|del|la|el|al|an|du|da|do|dos|das|y|on)"
const SQL_PLACE_PART = `${SQL_PLACE_WORD}( ${SQL_PLACE_WORD})*`
export const EVENT_TEMPLATE_SQL =
  `^(${Object.values(CAMEO_LABEL).join('|')}|CAMEO-[0-9]+)( in ${SQL_PLACE_PART}(, ${SQL_PLACE_PART}){0,4})?$`
