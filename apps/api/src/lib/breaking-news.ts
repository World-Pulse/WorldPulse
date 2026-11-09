/**
 * What may be called breaking news (Nov 8, 2026; Devon, 9:05 PM: "the banner should always be accurate").
 *
 * A breaking alert is any critical or high report with a fair reliability (lib/breaking-alerts.ts), so the list also
 * took reports that aren't news: aircraft transponder alarms (an automatic reading, often wrong: two said
 * "hijacking"), satellite and sensor readings (wildfire detections, earthquakes, volcano and tsunami messages, which
 * the map and the AI assistants' hazards tool show as what they are) and bylined opinion pieces a word like
 * "tsunami" had made a disaster. On Nov 8 evening they were 13 of the 20 live alerts, and they used up the eight an
 * hour that real news could have had. No module here imports anything, so the API's routes and the AI assistants'
 * tools can both use it.
 */

/** An aircraft's transponder alarm ("Aircraft FDX382 squawking 7500 …") */
export const SQUAWK = /\bsquawk(?:ing)?\s+7[567]00\b/i

/** Why a report isn't breaking news, or null when it may be */
export function notBreakingNews(title: string): 'transponder' | 'sensor' | 'opinion' | null {
  const t = title.trim()
  if (SQUAWK.test(t)) return 'transponder'
  if (/^(?:(?:large|major|extreme|massive|significant)\s+)?wildfire detected near\b/i.test(t) || /^M\s?\d+(?:\.\d+)?\s+-\s/.test(t) || /^(?:volcanic|tsunami) alert\b/i.test(t)) return 'sensor'
  if (/^\[[^\]]{3,40}\]\s/.test(t) || /[–—-]\s*(?:op-?ed|opinion|commentary|editorial|analysis)\s*$/i.test(t) || /^(?:opinion|op-?ed|editorial|commentary|analysis)\s*[:|]/i.test(t)) return 'opinion'
  // "DAVID MARCUS: Where does …", a columnist's name, not "BREAKING:" or "JUST IN:"
  const byline = /^([A-Z][A-Z.'’-]+(?: [A-Z][A-Z.'’-]+){1,3}):\s/.exec(t)
  if (byline && !/^(?:BREAKING|JUST IN|LIVE|UPDATE|UPDATED|WATCH|EXCLUSIVE|PHOTOS|VIDEO|DEVELOPING|ALERT|URGENT)(?: NEWS)?$/.test(byline[1]!)) return 'opinion'
  return null
}
