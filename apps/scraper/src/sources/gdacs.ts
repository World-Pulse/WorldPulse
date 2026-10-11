/**
 * GDACS (the UN/EU Global Disaster Alert and Coordination System) alerts, read
 * from its RSS feed by news-rss.ts. Until Oct 11, 2026 they went in as ordinary
 * news: every alert was "high" (the word "earthquake", or "0 deaths" in a flood
 * report, counted as deadly), the headline was GDACS's raw line ("Green
 * earthquake (Magnitude 6M, Depth:10km) in Panama 10/10/2026 04:14 UTC, 4
 * thousand (in MMI>=VII).") and the map pin was GDACS's office in Ispra, Italy.
 */

import type { SignalSeverity } from '@worldpulse/types'

export type GdacsAlertLevel = 'red' | 'orange' | 'green'

/** The alert's level: the feed's own <gdacs:alertlevel>, else the colour its title starts with */
export function gdacsAlertLevel(title: string, alertLevel?: string | null): GdacsAlertLevel | null {
  const level = (alertLevel ?? '').trim().toLowerCase() || /^\s*(red|orange|green)\b/i.exec(title)?.[1]?.toLowerCase()
  return level === 'red' || level === 'orange' || level === 'green' ? level : null
}

/**
 * GDACS's levels are about humanitarian impact: red needs international help,
 * orange may, green is unlikely to. Green alerts are still real disasters
 * (an M6.6 earthquake, a flood), so they stay medium.
 */
export function gdacsSeverity(level: GdacsAlertLevel): SignalSeverity {
  return level === 'red' ? 'critical' : level === 'orange' ? 'high' : 'medium'
}

/** Modified Mercalli intensity → how strong the shaking feels */
const SHAKING: Record<string, string> = {
  IV: 'light', V: 'moderate', VI: 'strong', VII: 'very strong', VIII: 'severe', IX: 'violent', X: 'extreme',
}

const EARTHQUAKE_RE =
  /^\s*(?:red|orange|green)\s+earthquake(?:\s+alert)?\s*\(\s*magnitude\s+([\d.]+)\s*m?\s*,\s*depth:?\s*[\d.]+\s*km\s*\)\s+in\s+(.+?)\s+\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*utc\s*,?\s*(.*?)\.?\s*$/i

/** "West Of Macquarie Island" → "West of Macquarie Island" */
function placeName(raw: string): string {
  return raw.trim().split(/\s+/).map((word, i) => (i > 0 && /^(of|the|and|off|near)$/i.test(word) ? word.toLowerCase() : word)).join(' ')
}

/** "540 thousand (in MMI>=VII)" → "540,000 people exposed to very strong shaking" */
function exposure(raw: string): string | null {
  const text = raw.replace(/&gt;/gi, '>').trim()
  const mmi = /mmi\s*(?:>=|≥)?\s*([IVX]+)/i.exec(text)?.[1]?.toUpperCase()
  const shaking = mmi ? SHAKING[mmi] : undefined
  const count = /^([\d.,]+)\s*(thousand|million)?/i.exec(text)
  if (count) {
    const n = Number(count[1]!.replace(/,/g, '')) * (count[2]?.toLowerCase() === 'million' ? 1e6 : count[2] ? 1e3 : 1)
    if (Number.isFinite(n) && n > 0) {
      return `${Math.round(n).toLocaleString('en-US')} people exposed${shaking ? ` to ${shaking} shaking` : ''}`
    }
  }
  if (/^few people/i.test(text)) return `few people exposed${shaking ? ` to ${shaking} shaking` : ''}`
  return null
}

/**
 * A readable headline for a GDACS earthquake alert, and its place:
 * "M7.7 earthquake in Panama: 540,000 people exposed to very strong shaking".
 * Other alerts (floods, cyclones, droughts) already read well and are kept.
 */
export function tidyGdacsTitle(title: string): { title: string; place: string | null } {
  const quake = EARTHQUAKE_RE.exec(title)
  if (!quake) return { title: title.trim(), place: null }
  const magnitude = Number(quake[1])
  const place = placeName(quake[2]!)
  const people = exposure(quake[3] ?? '')
  const mag = Number.isFinite(magnitude) ? `M${magnitude.toFixed(1)} earthquake` : 'Earthquake'
  return { title: `${mag} in ${place}${people ? `: ${people}` : ''}`, place }
}

const EVENT_TAGS: Array<[RegExp, string]> = [
  [/\bearthquake/i, 'earthquake'],
  [/\btsunami/i, 'tsunami'],
  [/\b(?:tropical cyclone|cyclone|hurricane|typhoon)/i, 'cyclone'],
  [/\bflood/i, 'flood'],
  [/\bdrought/i, 'drought'],
  [/\bvolcan/i, 'volcano'],
  [/\b(?:forest fire|wildfire)/i, 'wildfire'],
]

/** The alert's own hazard tag (every GDACS signal was tagged earthquake, flood and cyclone at once) */
export function gdacsTags(title: string): string[] {
  const hazard = EVENT_TAGS.find(([re]) => re.test(title))?.[1]
  return ['gdacs', 'disaster', 'institutional', ...(hazard ? [hazard] : [])]
}
