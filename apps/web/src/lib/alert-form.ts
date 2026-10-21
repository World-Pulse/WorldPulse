/**
 * The /alerts page's alerts (plan 10; Devon, Oct 21, 2026: alerts "Free for
 * everyone"): what a reader asks for as POST /api/v1/alerts's body, and a
 * saved alert in a few words. The API (routes/alerts.ts, lib/alert-scan.ts)
 * matches words as whole words or phrases, fires on each new report or once
 * a story is verified by enough outlets (channels.verified, min_outlets),
 * and sends an email for each match (20 a day at most) or one a day.
 */

import { countriesMentioned, countryLabel } from './country-connections'

/** The categories the editor files stories under (scraper pipeline/editor.ts), "other" left out */
export const ALERT_CATEGORIES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'conflict', label: 'Conflict' }, { id: 'geopolitics', label: 'Geopolitics' },
  { id: 'elections', label: 'Elections' }, { id: 'economy', label: 'Economy' },
  { id: 'health', label: 'Health' }, { id: 'disaster', label: 'Disasters' },
  { id: 'climate', label: 'Climate' }, { id: 'security', label: 'Security' },
  { id: 'technology', label: 'Technology' }, { id: 'science', label: 'Science' },
  { id: 'space', label: 'Space' }, { id: 'sports', label: 'Sports' }, { id: 'culture', label: 'Culture' },
]

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low'
export const SEVERITY_CHOICES: ReadonlyArray<{ id: AlertSeverity; label: string }> = [
  { id: 'low', label: 'Everything' }, { id: 'medium', label: 'Medium and above' },
  { id: 'high', label: 'High and above' }, { id: 'critical', label: 'Critical only' },
]

/** When it fires: each new report, or once a story is verified by 2, 3 or 5 outlets */
export type AlertWhen = 'report' | 'verified-2' | 'verified-3' | 'verified-5'
export const WHEN_CHOICES: ReadonlyArray<{ id: AlertWhen; label: string; help: string }> = [
  { id: 'report', label: 'Each new report', help: 'As soon as an outlet reports it, verified or not' },
  { id: 'verified-2', label: 'Once verified', help: 'When two independent outlets carry the story' },
  { id: 'verified-3', label: '3+ outlets', help: 'When three independent outlets carry it' },
  { id: 'verified-5', label: '5+ outlets', help: 'Only the stories many outlets carry' },
]

export interface AlertForm {
  name: string
  /** Words or phrases, separated by commas */
  words: string
  /** Country names or two-letter codes, separated by commas */
  countries: string
  categories: string[]
  minSeverity: AlertSeverity
  when: AlertWhen
  /** One email a day (7 AM New York time) instead of one for each match */
  daily: boolean
}

export const EMPTY_FORM: AlertForm = { name: '', words: '', countries: '', categories: [], minSeverity: 'medium', when: 'verified-2', daily: true }

export interface AlertBody {
  name: string
  keywords: string[]
  categories: string[]
  countries: string[]
  minSeverity: AlertSeverity
  channels: { email: true; push: false; in_app: true; digest?: 'daily'; verified?: true; min_outlets?: number }
}

/** "Gaza, ceasefire;  Hamas" → ["Gaza", "ceasefire", "Hamas"]: each once, whatever the case */
export function splitList(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(/[,;\n]+/)) {
    const item = raw.trim().replace(/\s+/g, ' ')
    if (!item || seen.has(item.toLowerCase())) continue
    seen.add(item.toLowerCase())
    out.push(item)
  }
  return out
}

/** "Ukraine, sd" → ["UA", "SD"]; a name WorldPulse doesn't know is an error */
export function countryCodes(text: string): { codes: string[]; unknown: string[] } {
  const codes: string[] = [], unknown: string[] = []
  for (const item of splitList(text)) {
    const code = /^[A-Za-z]{2}$/.test(item) && countryLabel(item.toUpperCase()) ? item.toUpperCase() : countriesMentioned(item)[0]
    if (code) { if (!codes.includes(code)) codes.push(code) } else unknown.push(item)
  }
  return { codes, unknown }
}

/** The body to save, or what to fix first */
export function alertBody(form: AlertForm): { body: AlertBody } | { error: string } {
  const keywords = splitList(form.words)
  if (keywords.some(k => k.length > 100)) return { error: 'Each word or phrase can have up to 100 characters.' }
  if (keywords.length > 20) return { error: 'Up to 20 words or phrases.' }
  const { codes, unknown } = countryCodes(form.countries)
  if (unknown.length) return { error: `Not a country WorldPulse knows: ${unknown.join(', ')}. Try its name or two-letter code (UA, SD).` }
  if (codes.length > 20) return { error: 'Up to 20 countries.' }
  const categories = form.categories.filter(c => ALERT_CATEGORIES.some(a => a.id === c)).slice(0, 10)
  if (!keywords.length && !codes.length && !categories.length) return { error: 'Add words, countries or topics to watch.' }
  const auto = [...keywords, ...codes.map(c => countryLabel(c) ?? c), ...categories.map(c => ALERT_CATEGORIES.find(a => a.id === c)?.label ?? c)].join(', ')
  const name = (form.name.trim() || auto).slice(0, 100)
  const verified = form.when !== 'report'
  return {
    body: {
      name, keywords, categories, countries: codes, minSeverity: form.minSeverity,
      channels: {
        email: true, push: false, in_app: true,
        ...(form.daily ? { digest: 'daily' as const } : {}),
        ...(verified ? { verified: true as const, min_outlets: Number(form.when.split('-')[1]) } : {}),
      },
    },
  }
}

export interface SavedAlert {
  id: string
  name: string
  keywords?: string[] | null
  categories?: string[] | null
  countries?: string[] | null
  min_severity?: string | null
  channels?: unknown
  active?: boolean | null
}

function channelsOf(channels: unknown): Record<string, unknown> {
  const c = typeof channels === 'string' ? (() => { try { return JSON.parse(channels) as unknown } catch { return null } })() : channels
  return c && typeof c === 'object' ? c as Record<string, unknown> : {}
}

/** A saved alert in a few words: what it watches, how serious, when, how often */
export function describeAlert(a: SavedAlert): string[] {
  const out: string[] = []
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : [])
  const words = list(a.keywords), countries = list(a.countries), cats = list(a.categories)
  if (words.length) out.push(`Words: ${words.join(', ')}`)
  if (countries.length) out.push(`Countries: ${countries.map(c => countryLabel(c) ?? c).join(', ')}`)
  if (cats.length) out.push(`Topics: ${cats.map(c => ALERT_CATEGORIES.find(x => x.id === c)?.label ?? c).join(', ')}`)
  out.push(SEVERITY_CHOICES.find(s => s.id === a.min_severity)?.label ?? 'Medium and above')
  const c = channelsOf(a.channels)
  const n = Number(c.min_outlets)
  out.push(c.verified === true ? `Once verified by ${Number.isInteger(n) && n >= 2 ? n : 2}+ outlets` : 'Each new report')
  out.push(c.digest === 'daily' ? 'One email a day' : 'An email each time (20 a day at most)')
  return out
}
