/**
 * WorldPulse for AI assistants: an MCP server at https://api.world-pulse.io/mcp
 * (plan 15, "Path A", Oct 20, 2026). MCP, the Model Context Protocol, is how
 * assistants such as Claude call outside tools; with this, an assistant can
 * ask WorldPulse which stories the most independent outlets are reporting,
 * read one story with every outlet's report, search the reports by meaning,
 * and read a week's top stories.
 *
 * Read-only and public, like the public API: no sign-in, no key, nothing
 * written. Streamable HTTP without sessions: each POST carries JSON-RPC 2.0
 * (one message or a batch) and gets JSON back; notifications get 202 with no
 * body; GET and DELETE answer 405 (no event stream is offered).
 *
 * Each tool asks the API's own public routes (app.inject), so it answers
 * exactly what the API answers, from the same kept lists, and each of those
 * calls counts against the asking client's own limits, the route's included
 * (lib/internal-call.ts): asking through MCP costs what asking the API
 * directly does. This route has its own limit too (60 POSTs a minute).
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { internalCallHeaders } from '../lib/internal-call'
import { rateLimitKey } from '../lib/rate-limit-options'
import { describeSite, siteInfo, countryLabel, outletOf, OUTLET_KIND_LABELS } from '../lib/outlets'
import { OUTLET_DIRECTORY } from '../lib/outlet-directory'
import { hostOf } from '../lib/stories'
import { countMcpTool, isOutsideUse, isOwnCheck } from '../lib/outside-use'
import { redis } from '../db/redis'
import { CHOKEPOINTS } from '../lib/chokepoints'
import { SQUAWK, notBreakingNews } from '../lib/breaking-news'
import { KNOWN_AI_CONTENT_FARMS } from '../lib/ai-content-farms'
import { REGIONS, REGION_IDS, regionCountries, type RegionId } from '../lib/regions'

const SITE = (process.env.SITE_URL || 'https://world-pulse.io').replace(/\/+$/, '')

/** Protocol versions this server speaks, newest first */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const

const SERVER_INFO = { name: 'worldpulse', title: 'WorldPulse', version: '1.10.0' }

const INSTRUCTIONS = [
  'WorldPulse groups news reports of one event into one story and counts the outlets (websites) that report it. A story\'s count covers its last two days; a story that has run longer also gives how many outlets have reported it since it began.',
  'A story is "verified" when two or more outlets report it and its reliability score reaches 65%; verified means more than one outlet says so, not proven true (https://world-pulse.io/how-we-count).',
  'Cite stories with their world-pulse.io links. Start with top_stories; open one with story; find reports on a subject with search_reports; a week at a glance with week; how many outlets reported an article someone shared with check_link; the crises with the fewest outlets for the people displaced with under_reported.',
  'Since Nov 8, 2026 also: story_numbers (each figure in a story, such as the dead, with how many outlets give it), outlet (what a news website is: its country, its kind, state media or not), near (the reports pinned near a place), country (a country right now), daily_brief (the Daily Briefing), entity (a person, organisation or place in the news), trend (how coverage of a country or an entity changed day by day) and check_claim (what the newsrooms report about a claim; it never rules true or false).',
  'And: breaking (the urgent reports of the last few hours), trending (who and what is in the news most), hotspots (where serious reports of several kinds meet), story_by_country (one story country by country: whose newsrooms carry it and how they headline it), shipping (ships, ports, straits and navies, near a chokepoint) and hazards (earthquakes, volcanoes, tsunamis, wildfires).',
  'And: latest (the newest verified reports, of one subject or country), how_verified (how a story was checked: the outlets, then each comparison of what they report), story_timeline (who reported a story first and how it spread), conflicts (where conflict and military news is reported) and internet_outages (internet outages, from IODA).',
  'And since Nov 9, 2026: connections (who and what a person, organisation or place is named with, or the stories naming two of them), protests, outbreaks and displacement (the map\'s protest, outbreak and refugee reports, place by place) and who_covers (the newsrooms WorldPulse reads in a country).',
  'And since Nov 10, 2026: day (one day\'s top stories, from the last 30 days), unconfirmed (serious reports only one outlet has carried so far: leads, not facts), newly_verified (reports that just found their second outlet), local_press (stories the world reports while their own country\'s press barely appears among the outlets) and site_check (whether a website is a known AI content farm, and the reliability score WorldPulse gives it).',
  'And for the news in other languages: quiet_places (the places whose news most rarely finds a second outlet), story_languages (the languages a story is reported in, with its outlets in each), verified_in_languages (the newest reports in other languages than English that turned verified), languages_today (the languages the news came in) and missed_in_english (stories verified in other languages with no English report found).',
  'Live layers and checks: military_aircraft and emergency_flights (adsb.lol\'s aircraft now), live_cameras (public cameras near a place), space_weather (NOAA\'s alerts), busiest_countries, news_volume (how much news WorldPulse reads), country_compare (two countries side by side), similar_reports, reader_flags (what readers flagged on a report) and outlet_mix (what kinds of newsroom carry a story, state media among them).',
  'More: chokepoints_news (the shipping chokepoints in the news), exploited_vulnerabilities (CISA\'s catalogue of flaws attackers use), travel_advice (US and UK advice for a country), first_reporters (the outlets first on a story), verification_speed (how fast stories find a second outlet), topics_today, outlet_reports (one outlet\'s newest reports), region_top_stories (a region\'s top stories), rising_stories (new stories spreading fast) and thin_coverage (the places WorldPulse reads few newsrooms in).',
  'And: sanctions_actions (new US Treasury and EU sanctions), us_weather_alerts (US National Weather Service warnings), carrier_groups (where the US Navy\'s carriers were last reported), cyber_attacks, elections_watch and disaster_news (that news by country), state_media_stories (how much of the top stories state media carry), country_topics (what a country\'s news is about), busiest_outlets and local_only_stories (a country\'s stories only its own press reports).',
].join(' ')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ToolResult { text: string; data: Record<string, unknown> }

/** The API, and the rate-limit key of the client asking */
export interface Asker {
  app: FastifyInstance
  client: string
  /** Counts a tool call as use from outside (lib/outside-use.ts; the route passes it, tests may not) */
  countTool?: (tool: string) => void
}

interface Tool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  run: (args: Record<string, unknown>, asker: Asker) => Promise<ToolResult>
}

/** A tool's own failure (bad arguments, nothing found): reported to the assistant, not a protocol error */
class ToolError extends Error {}

/** day: how often, and how long apart, it asks again for a day being made in the background (tests set ms to 0) */
export const DAY_WAIT = { tries: 4, ms: 5_000 }

/** GET one of the API's public routes from inside, as JSON, counted as the asking client */
async function ask({ app, client }: Asker, url: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.inject({ method: 'GET', url, headers: internalCallHeaders(client) })
  if (res.statusCode === 429) throw new ToolError('Too many questions from you just now; try again in a minute')
  let body: Record<string, unknown> = {}
  try { body = res.json() as Record<string, unknown> } catch { /* not JSON */ }
  return { status: res.statusCode, body }
}

function intArg(args: Record<string, unknown>, name: string, def: number, min: number, max: number): number {
  const v = args[name]
  if (v === undefined || v === null || v === '') return def
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw new ToolError(`${name} must be a whole number from ${min} to ${max}`)
  return n
}

function strArg(args: Record<string, unknown>, name: string, opts: { required?: boolean; max?: number; pattern?: RegExp; hint?: string } = {}): string | undefined {
  const v = args[name]
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw new ToolError(`${name} is required`)
    return undefined
  }
  if (typeof v !== 'string') throw new ToolError(`${name} must be text`)
  const s = v.trim()
  if (opts.max && s.length > opts.max) throw new ToolError(`${name} must be at most ${opts.max} characters`)
  if (opts.pattern && !opts.pattern.test(s)) throw new ToolError(`${name} ${opts.hint ?? 'is not valid'}`)
  return s
}

function numArg(args: Record<string, unknown>, name: string, min: number, max: number): number {
  const v = args[name]
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n) || n < min || n > max) throw new ToolError(`${name} must be a number from ${min} to ${max}`)
  return n
}

function boolArg(args: Record<string, unknown>, name: string): boolean {
  const v = args[name]
  return v === true || v === 'true'
}

const signalLink = (id: unknown) => `${SITE}/signals/${String(id)}`

/** "3h ago", "25m ago" */
function agoLabel(iso: string | null | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return ''
  const m = Math.max(0, Math.round((now - t) / 60_000))
  return m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`
}

/** Great-circle distance in km */
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180
  const h = Math.sin((lat2 - lat1) * rad / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lng2 - lng1) * rad / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** The box around a circle (minLng,minLat,maxLng,maxLat), kept inside the map's edges */
export function boxAround(lat: number, lng: number, km: number): [number, number, number, number] {
  const dLat = km / 111.32
  const dLng = km / (111.32 * Math.max(Math.cos(lat * Math.PI / 180), 0.01))
  const r = (n: number) => Math.round(n * 10_000) / 10_000
  return [r(Math.max(-180, lng - dLng)), r(Math.max(-90, lat - dLat)), r(Math.min(180, lng + dLng)), r(Math.min(90, lat + dLat))]
}

/** A story figure's line: "Killed: 6 (50 outlets: a.com, b.com, c.com, …) · 9 (3 outlets: d.com, e.com, f.com)" */
interface FigureValues { label: string; values?: Array<{ text: string; outlets: number; outletNames?: string[] }> }
function figureLine(f: FigureValues): string {
  const value = (v: { text: string; outlets: number; outletNames?: string[] }, i: number) => {
    // the most reported value names a few of its outlets, the others all of theirs (they are the ones to check)
    const names = v.outletNames ?? []
    const shown = i === 0 ? names.slice(0, 3) : names.slice(0, 6)
    const more = v.outlets - shown.length
    return `${v.text} (${v.outlets} outlet${v.outlets === 1 ? '' : 's'}${shown.length ? `: ${shown.join(', ')}${more > 0 ? ', …' : ''}` : ''})`
  }
  return `${f.label}: ${(f.values ?? []).map(value).join(' · ')}`
}

/** An entity's page, as the website writes its address (apps/web/src/lib/entity-links.ts entityPath) */
export function entityPage(id: string, name: string): string {
  const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '')
  return `${SITE}/entities/${slug ? `${slug}-` : ''}${encodeURIComponent(id)}`
}

/** "Nov 3" from "2026-11-03" (UTC) */
const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

interface EntityHit { id: string; type: string; canonical_name: string; aliases?: string[]; mention_count: number; last_seen?: string }

/**
 * check_claim: a report this close in meaning to a claim is about it (the search's in-house fingerprints).
 * Measured Nov 8, 2026 on the live search: real claims' nearest reports 0.65 to 0.96 ("Paraguay's president was
 * impeached" 0.80, "Sudan's army retook El Fasher" 0.67), made-up ones' 0.53 to 0.58 ("the moon is made of cheese")
 */
export const CLAIM_CLOSE = 0.6

/** A name to compare: no accents, lower case ("Anatolie Nosatîi" -> "anatolie nosatii") */
const foldName = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
/** Text to match as it is inside a regular expression */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The entity a name means: the one named exactly so (its name or one of its other names, any case or accent),
 * else the most mentioned with the name as a whole word ("Musk" for "Elon Musk"), else the most mentioned whose
 * name contains it. The other candidates come back too, so the assistant can ask: the whole-word ones only when
 * there are any ("NATO" brings "NATO Parliamentary Assembly", not "Anatolie" or "Renato", which the search's
 * contains-the-letters match also finds)
 */
async function findEntity(asker: Asker, name: string): Promise<{ entity: EntityHit | null; others: EntityHit[] }> {
  const { status, body } = await ask(asker, `/api/v1/knowledge-graph/entities?search=${encodeURIComponent(name)}&limit=20&sort=mention_count&lean=1`)
  if (status !== 200) throw new Error(`entities answered ${status}`)
  const hits = (((body as { data?: EntityHit[] }).data) ?? []).filter(e => e && typeof e.id === 'string' && typeof e.canonical_name === 'string')
  const wanted = foldName(name)
  const namesOf = (e: EntityHit) => [e.canonical_name, ...(e.aliases ?? [])].map(n => foldName(String(n)))
  const word = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(wanted)}($|[^\\p{L}\\p{N}])`, 'u')
  const whole = hits.filter(e => namesOf(e).some(n => word.test(n)))
  const exact = hits.find(e => namesOf(e).includes(wanted))
  const entity = exact ?? whole[0] ?? hits[0] ?? null
  return { entity, others: (whole.length ? whole : hits).filter(e => e !== entity).slice(0, 4) }
}

/** A website from a website or an article's address: "bbc.co.uk" from "https://www.bbc.co.uk/news/x" */
function siteOf(input: string): string {
  const s = input.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return hostOf(s)
  return s.toLowerCase().replace(/^www\./, '').split(/[/?#:]/)[0] ?? ''
}

interface ListedStory {
  id: string; leadId: string; title: string; place: string | null; category: string | null; severity: string
  outletCount: number; outletCountAll?: number; outlets?: string[]; verifiedAt: string | null; updatedAt?: string; firstSeenAt?: string
  country?: string | null; countries?: number; localOutlets?: number; localNames?: string[]
}

/** "2 from Poland (Defence24, Notes from Poland)": the outlets of the story's own country, or '' (Nov 8, 2026) */
function localNote(country: string | null | undefined, local: number | undefined, names: string[] | undefined): string {
  return country && local ? `${local} from ${countryLabel(country)}${names?.length ? ` (${names.join(', ')})` : ''}` : ''
}

/** " in 36 countries · 2 from Poland (Defence24, Notes from Poland)": where its outlets are from */
function reachNote(s: ListedStory): string {
  const countries = s.countries && s.countries > 1 ? ` in ${s.countries} countries` : ''
  const local = localNote(s.country, s.localOutlets, s.localNames)
  return countries + (local ? ` · ${local}` : '')
}

/** " · 143 since Oct 10" for a story that has run longer than its counted two days */
function sinceNote(count: number, all: number | undefined, firstSeenAt: string | null | undefined): string {
  if (!all || all <= count || !firstSeenAt) return ''
  const d = new Date(firstSeenAt)
  if (Number.isNaN(d.getTime())) return ''
  return ` · ${all} since ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`
}

function storyLine(s: ListedStory, i: number): string {
  const proof = (s.verifiedAt ? `Verified · ${s.outletCount} outlets` : `${s.outletCount} outlets so far (not verified)`)
    + reachNote(s) + sinceNote(s.outletCount, s.outletCountAll, s.firstSeenAt)
  const where = [s.place, s.category, s.severity].filter(Boolean).join(', ')
  const names = s.outlets?.length ? ` · ${s.outlets.slice(0, 5).join(', ')}${s.outlets.length > 5 ? ', …' : ''}` : ''
  return `${i + 1}. ${s.title}\n   ${proof}${where ? ` · ${where}` : ''}${names}\n   ${signalLink(s.leadId)} (story id ${s.id})`
}

const storyOut = (s: ListedStory) => ({
  id: s.id, title: s.title, url: signalLink(s.leadId), leadReportId: s.leadId, place: s.place, category: s.category,
  severity: s.severity, outlets: s.outletCount, outletsAll: s.outletCountAll ?? s.outletCount, outletNames: s.outlets ?? [], verified: Boolean(s.verifiedAt),
  verifiedAt: s.verifiedAt, firstSeenAt: s.firstSeenAt ?? null, updatedAt: s.updatedAt ?? null,
  country: s.country ?? null, outletCountries: s.countries ?? 0, localOutlets: s.localOutlets ?? 0, localOutletNames: s.localNames ?? [],
})

/** "High" from "high" */
const cap = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')

/** A report's story, as GET /api/v1/stories/outlets counts it */
interface StoryCount { storyId?: string; outlets?: number; verified?: boolean; countries?: number; canonicalId?: string; firstReportAt?: string | null }

/** The stories of some reports (one call for all of them), by report id; {} when the count can't be had */
async function storyCounts(asker: Asker, ids: string[]): Promise<Record<string, StoryCount>> {
  const valid = [...new Set(ids.filter(id => UUID.test(id)))].slice(0, 60)
  if (valid.length === 0) return {}
  const { status, body } = await ask(asker, `/api/v1/stories/outlets?ids=${valid.join(',')}`)
  return status === 200 ? ((((body.data ?? {}) as { stories?: Record<string, StoryCount> }).stories) ?? {}) : {}
}

/** "Verified · 25 outlets in 12 countries", "3 outlets so far, not verified yet", "Only one outlet so far: unconfirmed" */
function proofLine(c: StoryCount | undefined): string {
  const outlets = Number(c?.outlets) || 1
  const where = (Number(c?.countries) || 0) >= 2 ? ` in ${c!.countries} countries` : ''
  if (c?.verified) return `Verified · ${outlets} outlet${outlets === 1 ? '' : 's'}${where}`
  return outlets >= 2 ? `${outlets} outlets so far${where}, not verified yet` : 'Only one outlet so far: unconfirmed'
}

/** The hazards tool's kinds: the hazards route's sources (GET /api/v1/hazards/map/points); {m}, the smallest magnitude */
const HAZARD_KINDS: Record<string, { slug: string; one: string; many: string; source: string; order: string }> = {
  earthquake: { slug: 'seismic', one: 'earthquake of magnitude {m} or more', many: 'earthquakes of magnitude {m} or more', source: 'USGS', order: 'the strongest first' },
  volcano: { slug: 'gvp-volcano', one: 'volcano alert', many: 'volcano alerts', source: 'USGS, US volcanoes', order: 'newest first' },
  tsunami: { slug: 'tsunami-warnings', one: 'tsunami message', many: 'tsunami messages', source: 'NOAA\'s tsunami warning centres', order: 'newest first' },
  wildfire: { slug: 'firms', one: 'large wildfire', many: 'large wildfires', source: 'NASA FIRMS, seen by satellite', order: 'the largest first' },
}

/** An earthquake's magnitude from its headline: 6.1 from "M 6.1 - 120 km E of Miyako, Japan" */
export const magnitudeOf = (title: string): number | null => {
  const m = /^M\s?(\d+(?:\.\d+)?)\b/i.exec(title.trim())
  return m ? Number(m[1]) : null
}

/** The subjects the latest tool takes: the reports' categories (GET /api/v1/public/categories) people ask about */
export const LATEST_CATEGORIES: readonly string[] = [
  'conflict', 'geopolitics', 'politics', 'elections', 'economy', 'finance', 'technology', 'science', 'health', 'climate', 'weather',
  'disaster', 'humanitarian', 'security', 'military', 'culture', 'sports', 'space', 'aviation', 'maritime', 'infrastructure',
]

/** "the Strait of Hormuz", "Bab el-Mandeb" */
const theChokepoint = (c: { id: string; name: string }) => (c.id === 'bab-el-mandeb' ? c.name : `the ${c.name}`)

/**
 * The map's news layers found by headline (GET /api/v1/map/topics/:topic, lib/map-topics.ts; Nov 9, 2026): one tool
 * each. The layers find their reports by words in the headline, in English, French, Spanish and Portuguese.
 */
const TOPIC_TOOLS = {
  protests: { title: 'Protests and unrest', what: 'protests, strikes, riots and unrest', none: 'No protest or unrest report' },
  outbreaks: { title: 'Disease outbreaks', what: 'disease outbreaks (cholera, measles, mpox, Ebola, bird flu and others)', none: 'No outbreak report' },
  displacement: { title: 'Refugees and displacement', what: 'refugees, people displaced and asylum seekers', none: 'No report of refugees or displacement' },
} as const
type TopicTool = keyof typeof TOPIC_TOOLS

/** A word or name as a whole word in a text, any case or accent ("Niger" is not in "Nigeria") */
const hasWord = (text: string, word: string) =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(foldName(word))}($|[^\\p{L}\\p{N}])`, 'u').test(foldName(text))

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }

/** A topic layer's reports, place by place: the most reports first, each place with its worst severity and newest headline */
async function topicPlaces(topic: TopicTool, args: Record<string, unknown>, asker: Asker): Promise<ToolResult> {
  const place = strArg(args, 'place', { max: 80 })
  if (place !== undefined && place.length < 2) throw new ToolError('place must be at least 2 characters')
  const limit = intArg(args, 'limit', 10, 1, 20)
  const { status, body } = await ask(asker, `/api/v1/map/topics/${topic}`)
  if (status !== 200) throw new Error(`the ${topic} layer answered ${status}`)
  type Feature = { properties?: { id?: string; title?: string; place?: string | null; severity?: string; created_at?: string } }
  const hours = Number(body.hours) || (topic === 'protests' ? 48 : 72)
  const all = (((body as { features?: Feature[] }).features) ?? [])
    .filter(f => f?.properties && typeof f.properties.title === 'string' && UUID.test(String(f.properties.id)))
  const reports = place ? all.filter(f => hasWord(`${f.properties!.place ?? ''} ${f.properties!.title}`, place)) : all
  type Place = { name: string; reports: number; worst: string; newest: { id: string; title: string; at: string | null } }
  const places = new Map<string, Place>()
  for (const f of reports) {
    const p = f.properties!
    const name = String(p.place ?? '').trim() || 'No named place'
    const e = places.get(name) ?? { name, reports: 0, worst: 'low', newest: { id: p.id!, title: p.title!, at: p.created_at ?? null } }
    e.reports++
    if ((SEVERITY_RANK[p.severity ?? ''] ?? 0) > (SEVERITY_RANK[e.worst] ?? 0)) e.worst = p.severity!
    if ((Date.parse(String(p.created_at)) || 0) > (Date.parse(String(e.newest.at)) || 0)) e.newest = { id: p.id!, title: p.title!, at: p.created_at ?? null }
    places.set(name, e)
  }
  // a town named alone and with its country is one place ("Dhaka" and "Dhaka, Bangladesh"), when only one country's has it
  for (const [name, bare] of [...places]) {
    if (name.includes(',')) continue
    const fuller = [...places.values()].filter(p => p !== bare && p.name.includes(',') && foldName(p.name.split(',')[0]!) === foldName(name))
    if (fuller.length !== 1) continue
    const into = fuller[0]!
    into.reports += bare.reports
    if ((SEVERITY_RANK[bare.worst] ?? 0) > (SEVERITY_RANK[into.worst] ?? 0)) into.worst = bare.worst
    if ((Date.parse(String(bare.newest.at)) || 0) > (Date.parse(String(into.newest.at)) || 0)) into.newest = bare.newest
    places.delete(name)
  }
  const top = [...places.values()]
    .sort((a, b) => b.reports - a.reports || (SEVERITY_RANK[b.worst] ?? 0) - (SEVERITY_RANK[a.worst] ?? 0) || (Date.parse(String(b.newest.at)) || 0) - (Date.parse(String(a.newest.at)) || 0))
    .slice(0, limit)
  // each place's newest report: its story's outlet count (one call for all of them)
  const counts = await storyCounts(asker, top.map(p => p.newest.id))
  const t = TOPIC_TOOLS[topic]
  const scope = `${place ? ` naming ${place}` : ''} in the last ${hours} hours`
  const text = top.length === 0
    ? `${t.none}${scope} on WorldPulse's map. The ${topic} layer finds reports by words in their headlines (English, French, Spanish, Portuguese); try without place or another spelling. Map: ${SITE}/map`
    : [
      `${t.title}${scope}: ${reports.length} report${reports.length === 1 ? '' : 's'} in ${places.size} place${places.size === 1 ? '' : 's'}, the most reports first:`,
      ...top.map((p, i) => `${i + 1}. ${p.name}: ${p.reports} report${p.reports === 1 ? '' : 's'}, worst ${p.worst}\n   Newest: "${p.newest.title}" (${[agoLabel(p.newest.at), proofLine(counts[p.newest.id])].filter(Boolean).join(' · ')})\n   ${signalLink(p.newest.id)}`),
      `Found by words in the headline, so a few may be off topic, and the same event can count more than once. The map's ${topic} layer: ${SITE}/map`,
    ].join('\n')
  return {
    text,
    data: {
      topic, hours, place: place ?? null, reports: reports.length, placesFound: places.size,
      places: top.map(p => {
        const c = counts[p.newest.id]
        return {
          place: p.name, reports: p.reports, worstSeverity: p.worst,
          newest: { id: p.newest.id, title: p.newest.title, url: signalLink(p.newest.id), at: p.newest.at, outlets: Number(c?.outlets) || 1, verified: Boolean(c?.verified) },
        }
      }),
    },
  }
}

/** A topic layer's tool, but its name (written out in TOOLS, where the pages' tests read the names) */
const topicTool = (topic: TopicTool, description: string): Omit<Tool, 'name'> => ({
  title: TOPIC_TOOLS[topic].title,
  description,
  inputSchema: {
    type: 'object',
    properties: {
      place: { type: 'string', minLength: 2, maxLength: 80, description: 'Only reports naming this place in their place or headline, e.g. Kenya or Gaza' },
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'How many places (1 to 20, default 10)' },
    },
    additionalProperties: false,
  },
  run: (args, asker) => topicPlaces(topic, args, asker),
})

/** "Danish" from "da"; the code itself when it is not one */
const LANGUAGE_NAMES = new Intl.DisplayNames(['en'], { type: 'language' })
function languageLabel(code: string): string {
  try { return LANGUAGE_NAMES.of(code) ?? code } catch { return code }
}

/** An optional place: both latitude and longitude, or neither */
function placeArgs(args: Record<string, unknown>): { lat: number; lng: number } | null {
  const given = (k: string) => args[k] !== undefined && args[k] !== null && args[k] !== ''
  if (!given('latitude') && !given('longitude')) return null
  if (!given('latitude') || !given('longitude')) throw new ToolError('Give both latitude and longitude, or neither')
  return { lat: numArg(args, 'latitude', -90, 90), lng: numArg(args, 'longitude', -180, 180) }
}

/** "26.20°N 52.50°E" */
function coords(lat: number, lng: number): string {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(2)}°${lng >= 0 ? 'E' : 'W'}`
}

/** The commonest values, the most first */
function topCounts(values: string[], n: number): Array<[string, number]> {
  const c = new Map<string, number>()
  for (const v of values) c.set(v, (c.get(v) ?? 0) + 1)
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
}

/** One aircraft of adsb.lol's (lib/aircraft.ts LiveAircraft) */
interface Aircraft {
  hex: string; callsign: string | null; reg: string | null; type: string | null; desc: string | null; operator: string | null
  lat: number; lng: number; alt: number | 'ground' | null; speed: number | null; squawk: string | null; emergency: string | null; military: boolean
}

/** adsb.lol's military aircraft and emergency squawks now (GET /api/v1/aircraft/live, read at most every 3 minutes) */
async function aircraftNow(asker: Asker): Promise<{ at: string | null; aircraft: Aircraft[]; emergency: number }> {
  const { status, body } = await ask(asker, `/api/v1/aircraft/live`)
  if (status !== 200) throw new Error(`aircraft answered ${status}`)
  const d = (body.data ?? body) as { at?: string | null; aircraft?: Aircraft[]; failed?: string[] }
  if (!d.at && (d.failed ?? []).includes('all')) throw new ToolError('Aircraft positions are not available just now (adsb.lol did not answer); try again in a few minutes')
  const aircraft = (d.aircraft ?? []).filter(a => a && Number.isFinite(a.lat) && Number.isFinite(a.lng))
  return { at: d.at ?? null, aircraft, emergency: aircraft.filter(a => a.emergency).length }
}

const feet = (a: Aircraft) => (typeof a.alt === 'number' && Number.isFinite(a.alt) ? a.alt : null)
const knots = (a: Aircraft) => (typeof a.speed === 'number' && Number.isFinite(a.speed) ? Math.round(a.speed) : null)

/** "RCH431 · C17 · 31,000 ft · 450 kt · 50.10°N 8.60°E" */
function aircraftLine(a: Aircraft): string {
  const alt = a.alt === 'ground' ? 'on the ground' : feet(a) !== null ? `${feet(a)!.toLocaleString('en-US')} ft` : ''
  return [a.callsign?.trim() || a.reg || a.hex, a.desc || a.type || '', a.operator || '', alt, knots(a) !== null ? `${knots(a)} kt` : '', coords(a.lat, a.lng)].filter(Boolean).join(' · ')
}

function aircraftData(a: Aircraft) {
  return {
    hex: a.hex, callsign: a.callsign?.trim() || null, registration: a.reg ?? null, type: a.type ?? null, description: a.desc ?? null, operator: a.operator ?? null,
    latitude: a.lat, longitude: a.lng, altitudeFt: feet(a), onGround: a.alt === 'ground', speedKt: knots(a),
  }
}

/** How many newsrooms based in a country WorldPulse reads the feeds of (who_covers's list), each outlet once */
function newsroomsIn(code: string): number {
  const names = new Set<string>()
  for (const e of Object.values(OUTLET_DIRECTORY)) if (e.country === code && !e.seen) names.add(e.name)
  return names.size
}

/** One report of GET /api/v1/public/feed-reports (routes/public-insights.ts) */
interface FeedRow { id: string; title: string; summary: string | null; severity: string | null; country: string | null; place: string | null; at: string | null; url: string | null }

/** The first sentence of a feed's summary, at most 220 characters */
const firstLine = (s?: string | null) => String(s ?? '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0]!.slice(0, 220)

/**
 * A tool on one feed of GET /api/v1/public/feed-reports: its newest reports in the last days, one country's when
 * asked, each with its place, date, first line and links (Nov 10, 2026, round 3 of the AI tools)
 */
function feedTool(t: { name: string; title: string; description: string; feed: string; source: string; none: string; onePer?: (title: string) => string }): Tool {
  return {
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 30, default: 7, description: 'How many days back (1 to 30, default 7)' },
        country: { type: 'string', description: 'Only one country: a two-letter code, e.g. JP' },
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 8, description: 'How many (1 to 20, default 8)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const days = intArg(args, 'days', 7, 1, 30)
      const country = strArg(args, 'country', { pattern: /^[A-Za-z]{2}$/, hint: 'must be a two-letter country code such as JP' })?.toUpperCase().replace(/^UK$/, 'GB')
      const limit = intArg(args, 'limit', 8, 1, 20)
      const { status, body } = await ask(asker, `/api/v1/public/feed-reports?feed=${t.feed}&days=${days}`)
      if (status !== 200) throw new Error(`${t.feed} answered ${status}`)
      const d = (body.data ?? {}) as { total?: number; reports?: FeedRow[] }
      const seen = new Set<string>()
      const rows = (d.reports ?? []).filter(r => r && typeof r.title === 'string' && (!country || r.country === country))
        // newest first: the first of each key is its latest
        .filter(r => { if (!t.onePer) return true; const k = t.onePer(r.title); if (seen.has(k)) return false; seen.add(k); return true })
      const scope = `in the last ${days} days${country ? ` for ${countryLabel(country, true)}` : ''}`
      const total = country || t.onePer ? rows.length : Number(d.total ?? rows.length)
      const text = rows.length === 0
        ? `${t.none} ${scope}.`
        : [
          `${t.title}, ${scope}: ${total.toLocaleString('en-US')}${total > rows.length ? ` (the newest ${Math.min(limit, rows.length)} here)` : ''}, newest first (${t.source}, as WorldPulse reads it):`,
          ...rows.slice(0, limit).map((r, i) => `${i + 1}. ${r.title}\n   ${[r.place || (r.country ? countryLabel(r.country, false) : ''), r.at ? r.at.slice(0, 10) : '', cap(r.severity)].filter(Boolean).join(' · ')}${r.summary && !r.title.includes(firstLine(r.summary)) ? `\n   ${firstLine(r.summary)}` : ''}\n   ${signalLink(r.id)}${r.url ? ` · source: ${r.url}` : ''}`),
        ].join('\n')
      return { text, data: { feed: t.feed, days, country: country ?? null, total, reports: rows.slice(0, limit).map(r => ({ ...r, link: signalLink(r.id) })) } }
    },
  }
}

/** One country of GET /api/v1/public/news-watch */
interface WatchRow { country: string; reports: number; verified: number; latest: { id: string; title: string; at: string | null } | null }

/** A tool on one watch of GET /api/v1/public/news-watch: the countries with the most of that news, and the newest */
function watchTool(t: { name: string; title: string; description: string; watch: string; what: string }): Tool {
  return {
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 14, default: 7, description: 'How many days back (1 to 14, default 7)' },
        limit: { type: 'integer', minimum: 1, maximum: 25, default: 10, description: 'How many countries (1 to 25, default 10)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const days = intArg(args, 'days', 7, 1, 14)
      const limit = intArg(args, 'limit', 10, 1, 25)
      const { status, body } = await ask(asker, `/api/v1/public/news-watch?watch=${t.watch}&days=${days}`)
      if (status !== 200) throw new Error(`${t.watch} answered ${status}`)
      const d = (body.data ?? {}) as { total?: number; countries?: WatchRow[]; newest?: Array<{ id: string; title: string; status: string; country: string | null; at: string | null }> }
      const countries = (d.countries ?? []).slice(0, limit)
      const total = Number(d.total ?? 0)
      const text = total === 0
        ? `No news report about ${t.what} in the last ${days} days.`
        : [
          `${total.toLocaleString('en-US')} news reports about ${t.what} in the last ${days} days (WorldPulse). The countries with the most:`,
          ...countries.map((c, i) => `${i + 1}. ${countryLabel(c.country, false)}: ${c.reports} report${c.reports === 1 ? '' : 's'}, ${c.verified} verified${c.latest ? `\n   Newest verified: ${c.latest.title} (${agoLabel(c.latest.at)}) ${signalLink(c.latest.id)}` : ''}`),
          (d.newest ?? []).length ? `Newest of all: ${d.newest![0]!.title} (${agoLabel(d.newest![0]!.at)}${d.newest![0]!.status === 'verified' ? ', verified' : ', not verified yet'}) ${signalLink(d.newest![0]!.id)}` : '',
        ].filter(Boolean).join('\n')
      return { text, data: { watch: t.watch, days, total, countries: countries.map(c => ({ ...c, name: countryLabel(c.country, false), latest: c.latest ? { ...c.latest, url: signalLink(c.latest.id) } : null })), newest: (d.newest ?? []).slice(0, 10).map(r => ({ ...r, url: signalLink(r.id) })) } }
    },
  }
}

export const TOOLS: Tool[] = [
  {
    name: 'top_stories',
    title: 'Top stories now',
    description: 'The stories the most independent outlets are reporting in the last hours, ranked by outlets, severity and how recent, each event once. Each story says how many outlets (websites) carry it, how many countries they are from and how many are from the story\'s own country, whether it is verified, where, and links to its page. Give country (a two-letter code such as NG or FR) for one country\'s stories.',
    inputSchema: {
      type: 'object',
      properties: {
        hours:   { type: 'integer', minimum: 1, maximum: 72, default: 12, description: 'How many hours back (1 to 72, default 12)' },
        limit:   { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'How many stories (1 to 20, default 10)' },
        country: { type: 'string', pattern: '^[A-Za-z]{2}$', description: 'Optional ISO 3166-1 alpha-2 country code, e.g. NG' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const hours = intArg(args, 'hours', 12, 1, 72)
      const limit = intArg(args, 'limit', 10, 1, 20)
      const country = strArg(args, 'country', { pattern: /^[A-Za-z]{2}$/, hint: 'must be a two-letter country code' })?.toUpperCase()
      const { status, body } = await ask(asker, `/api/v1/stories?hours=${hours}&limit=${limit}${country ? `&country=${country}` : ''}`)
      if (status !== 200) throw new Error(`stories answered ${status}`)
      const stories = ((body.data as { stories?: ListedStory[] } | undefined)?.stories ?? [])
      const head = `Top stories${country ? ` in ${country}` : ''}, last ${hours} hours, ranked by independent outlets (WorldPulse; how outlets are counted: ${SITE}/how-we-count)`
      const text = stories.length ? `${head}\n\n${stories.map(storyLine).join('\n')}` : `${head}\n\nNo story was reported by two or more outlets${country ? ` in ${country}` : ''} in the last ${hours} hours.`
      return { text, data: { hours, country: country ?? null, stories: stories.map(storyOut) } }
    },
  },
  {
    name: 'story',
    title: 'One story with every outlet',
    description: 'One story: every outlet (website) that reported it, how many countries they are from and which are the story\'s own country\'s, when it turned verified, and its reports in order (the first ones and the latest ones for a big story), each with its outlet, link and time. Takes a story id or a report id, as top_stories, week and search_reports give them.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'A story id or a report id (a UUID)' } },
      required: ['id'],
      additionalProperties: false,
    },
    async run(args, asker) {
      const id = strArg(args, 'id', { required: true, pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, hint: 'must be a story or report id (a UUID)' })!
      const { status, body } = await ask(asker, `/api/v1/stories/${id}`)
      if (status === 404) throw new ToolError('No story or report with that id')
      if (status !== 200) throw new Error(`story answered ${status}`)
      const d = (body.data ?? {}) as {
        storyId?: string; size?: number; outlets?: number; outletsAll?: number; firstReportAt?: string | null; outletNames?: string[]; verifiedAt?: string | null
        country?: string | null; outletCountries?: number; localOutlets?: number; localOutletNames?: string[]
        outletInfo?: Array<{ site: string; name: string | null; kind: string; country: string | null; stateMedia: boolean }>
        signals?: Array<{ id: string; title: string; status: string; outlet: string; url: string | null; createdAt: string | null; locationName: string | null }>
      }
      const reports = d.signals ?? []
      const first = reports[0]
      const lines = reports.map(r => `- ${r.createdAt ? r.createdAt.slice(0, 16).replace('T', ' ') + ' UTC' : ''} · ${r.outlet || 'unknown outlet'} · ${r.title}${r.url ? `\n  ${r.url}` : ''}`)
      // Where its outlets are from (Nov 8, 2026): "Outlets from 36 countries · 2 from Poland (Defence24, Notes from Poland)"
      const reach = [
        d.outletCountries && d.outletCountries > 1 ? `Outlets from ${d.outletCountries} countries` : '',
        localNote(d.country, d.localOutlets, d.localOutletNames),
      ].filter(Boolean).join(' · ')
      const text = [
        first?.title ?? 'Story',
        `${d.verifiedAt ? `Verified ${d.verifiedAt.slice(0, 16).replace('T', ' ')} UTC` : 'Not verified yet'} · ${d.outlets ?? 0} outlets in its last two days${sinceNote(d.outlets ?? 0, d.outletsAll, d.firstReportAt)} · ${d.size ?? reports.length} reports`,
        ...(reach ? [reach] : []),
        ...(d.outletNames?.length ? [`Outlets: ${d.outletNames.map(site => describeSite(site)).join(', ')}`] : []),
        `Page: ${signalLink(first?.id ?? id)}`,
        '',
        'Reports:',
        ...lines,
      ].join('\n')
      return {
        text,
        data: {
          storyId: d.storyId ?? id, url: signalLink(first?.id ?? id), verifiedAt: d.verifiedAt ?? null, outlets: d.outlets ?? 0,
          outletNames: d.outletNames ?? [], outletInfo: d.outletInfo ?? siteInfo(d.outletNames ?? []), reports: d.size ?? reports.length,
          country: d.country ?? null, outletCountries: d.outletCountries ?? 0, localOutlets: d.localOutlets ?? 0, localOutletNames: d.localOutletNames ?? [],
          items: reports.map(r => ({ id: r.id, title: r.title, outlet: r.outlet, url: r.url, status: r.status, at: r.createdAt, place: r.locationName })),
        },
      }
    },
  },
  {
    name: 'search_reports',
    title: 'Search reports by meaning',
    description: 'Finds WorldPulse reports about a subject by meaning, not only by exact words (e.g. "ships attacked in the Gulf"), closest first, each with its status (verified or pending), place, time and link. A report is one outlet\'s article; use story to see every outlet.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 2, maxLength: 300, description: 'What to look for, in plain words' },
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'How many reports (1 to 20, default 10)' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async run(args, asker) {
      const query = strArg(args, 'query', { required: true, max: 300 })!
      if (query.length < 2) throw new ToolError('query must be at least 2 characters')
      const limit = intArg(args, 'limit', 10, 1, 20)
      const { status, body } = await ask(asker, `/api/v1/search/semantic?q=${encodeURIComponent(query)}&limit=${limit}`)
      if (status !== 200) throw new Error(`search answered ${status}`)
      if (body.semantic === false) throw new ToolError('Search by meaning is starting up; try again in a few minutes')
      const results = (body.results as Array<{ id: string; title: string; status: string; locationName: string | null; createdAt: string | null; category: string | null; score: number }> | undefined) ?? []
      const text = results.length
        ? `Reports about "${query}", closest first (WorldPulse):\n\n${results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.status === 'verified' ? 'Verified' : 'Pending (one outlet so far)'}${r.locationName ? ` · ${r.locationName}` : ''}${r.createdAt ? ` · ${r.createdAt.slice(0, 10)}` : ''}\n   ${signalLink(r.id)} (report id ${r.id})`).join('\n')}`
        : `No report about "${query}" was found.`
      return {
        text,
        data: { query, results: results.map(r => ({ id: r.id, title: r.title, url: signalLink(r.id), status: r.status, place: r.locationName, at: r.createdAt, category: r.category, closeness: r.score })) },
      }
    },
  },
  {
    name: 'week',
    title: 'A week\'s top stories',
    description: '"WorldPulse Week": a week\'s top stories ranked by independent outlets (weeks run Monday to Monday, UTC), and the countries with the most verified stories. Without week, the week under way; or an ISO week such as 2026-W42.',
    inputSchema: {
      type: 'object',
      properties: { week: { type: 'string', pattern: '^\\d{4}-W\\d{2}$', description: 'Optional ISO week, e.g. 2026-W42' } },
      additionalProperties: false,
    },
    async run(args, asker) {
      const week = strArg(args, 'week', { pattern: /^\d{4}-W\d{2}$/, hint: 'must be an ISO week such as 2026-W42' })
      const { status, body } = await ask(asker, `/api/v1/stories/week${week ? `?week=${week}` : ''}`)
      if (status === 400 || status === 404) throw new ToolError(String((body as { error?: unknown }).error ?? 'No such week'))
      // a finished week nobody had asked for: being made in the background
      if (status === 503) throw new ToolError(String((body as { error?: unknown }).error ?? 'This week is being put together; try again in a couple of minutes'))
      if (status !== 200) throw new Error(`week answered ${status}`)
      const d = (body.data ?? {}) as { week?: string; underWay?: boolean; stories?: ListedStory[]; countries?: Array<{ code: string; name: string; stories: number }> }
      const stories = d.stories ?? []
      const page = d.underWay ? `${SITE}/week` : `${SITE}/week/${d.week}`
      const text = [
        `WorldPulse Week ${d.week}${d.underWay ? ' (so far)' : ''}: top stories by independent outlets. Page: ${page}`,
        '',
        stories.length ? stories.map(storyLine).join('\n') : 'No story was reported by two or more outlets that week.',
        d.countries?.length ? `\nBusiest countries (verified stories): ${d.countries.map(c => `${c.name} ${c.stories}`).join(', ')}` : '',
      ].join('\n').trim()
      return { text, data: { week: d.week ?? week ?? null, underWay: Boolean(d.underWay), url: page, stories: stories.map(storyOut), countries: d.countries ?? [] } }
    },
  },
  {
    name: 'check_link',
    title: 'Check a link',
    description: 'Paste a news article\'s address: the WorldPulse story it belongs to, how many outlets (websites) reported that story, which ones, and whether it is verified. Articles WorldPulse has collected in the last two weeks; for another link, WorldPulse opens the public page once to read its headline and looks for a story telling the same event (match "similar"). "Only one outlet so far" means unconfirmed, not false.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', minLength: 4, maxLength: 2048, description: 'The article\'s address, e.g. https://www.bbc.com/news/articles/c4g9xk2v7lzo' } },
      required: ['url'],
      additionalProperties: false,
    },
    async run(args, asker) {
      const url = strArg(args, 'url', { required: true, max: 2048 })!
      const { status, body } = await ask(asker, `/api/v1/stories/by-link?url=${encodeURIComponent(url)}`)
      if (status === 400) throw new ToolError(String((body as { error?: unknown }).error ?? 'url must be the address of a news article'))
      if (status !== 200) throw new Error(`by-link answered ${status}`)
      const d = (body.data ?? {}) as {
        found?: boolean; reason?: string; link?: string; match?: string; opened?: boolean
        page?: { title?: string | null } | null
        report?: { id?: string; title?: string; outlet?: string; url?: string; createdAt?: string }
        story?: { id?: string; outlets?: number; outletNames?: string[]; verified?: boolean; verifiedAt?: string | null; size?: number }
      }
      if (!d.found) {
        const why = d.reason === 'not_an_article'
          ? 'That is not the address of an article (a front page, or not a web address).'
          : d.reason === 'pending'
            ? 'WorldPulse is adding this article right now; ask again in a minute.'
            : d.reason === 'busy'
              ? 'Many links are being checked just now; ask again in a few minutes.'
              : d.opened && d.page?.title
                ? `WorldPulse read the page's headline ("${d.page.title}") and has no story telling the same event in the last week: it may be very new, local, or from a site WorldPulse does not read.`
                : 'WorldPulse has not collected this article: it may be too new, from a site WorldPulse does not read, or older than two weeks.'
        return { text: why, data: { found: false, reason: d.reason ?? 'not_seen' } }
      }
      const outlets = Number(d.story?.outlets) || 0
      const names = d.story?.outletNames ?? []
      const proof = d.story?.verified
        ? `Verified · ${outlets} outlets`
        : outlets <= 1 ? 'Only one outlet so far: treat it as unconfirmed' : `${outlets} outlets so far (not verified)`
      const text = [
        ...(d.match === 'similar' ? [`WorldPulse has not collected this article; its headline${d.page?.title ? ` ("${d.page.title}")` : ''} looks like the same event as this story (compare them before relying on it):`] : []),
        `${d.report?.title ?? 'This article'}${d.report?.outlet ? ` (${d.report.outlet})` : ''}`,
        `${proof}${names.length ? ` · ${names.slice(0, 10).join(', ')}${names.length > 10 ? ', …' : ''}` : ''}`,
        `${d.link ?? signalLink(d.report?.id)} (story id ${d.story?.id ?? '?'})`,
      ].join('\n')
      return {
        text,
        data: {
          found: true, match: d.match === 'similar' ? 'similar' : 'exact', url: d.link ?? signalLink(d.report?.id), report: d.report ?? null,
          story: { id: d.story?.id ?? null, outlets, outletNames: names, verified: Boolean(d.story?.verified), verifiedAt: d.story?.verifiedAt ?? null, size: d.story?.size ?? null },
        },
      }
    },
  },
  {
    name: 'under_reported',
    title: 'Under-reported crises',
    description: 'The coverage gap: the countries UNHCR counts at least a million people displaced from (inside the country or abroad), each with how many news outlets (websites) WorldPulse placed in it, ranked by people displaced per outlet, the most people for the fewest outlets first (a crisis no outlet covered comes before them). Without week, the last 7 days; or a finished ISO week such as 2026-W42. It counts the outlets WorldPulse reads, not all the world\'s media; displacement figures are UNHCR\'s (CC BY 4.0), to be credited.',
    inputSchema: {
      type: 'object',
      properties: { week: { type: 'string', pattern: '^\\d{4}-W\\d{2}$', description: 'Optional finished ISO week, e.g. 2026-W42' } },
      additionalProperties: false,
    },
    async run(args, asker) {
      const week = strArg(args, 'week', { pattern: /^\d{4}-W\d{2}$/, hint: 'must be an ISO week such as 2026-W42' })
      const { status, body } = await ask(asker, `/api/v1/coverage-gap${week ? `?week=${week}` : ''}`)
      if (status === 400 || status === 404) throw new ToolError(String((body as { error?: unknown }).error ?? 'No such week'))
      if (status === 503) throw new ToolError(String((body as { error?: unknown }).error ?? 'This week is being put together; try again in a couple of minutes'))
      if (status !== 200) throw new Error(`coverage-gap answered ${status}`)
      const d = (body.data ?? {}) as {
        week?: string | null; unhcrYear?: number
        crises?: Array<{ rank: number; code: string; name: string; displaced: number; outlets: number; outletsAbroad?: number; peoplePerOutlet: number; stories?: Array<{ id: string; title: string; outlets: number }> }>
        mostCovered?: Array<{ name: string; outlets: number }>
        totals?: { crisisShare?: number; crisisDisplaced?: number }
      }
      const crises = d.crises ?? []
      const page = d.week ? `${SITE}/under-reported/${d.week}` : `${SITE}/under-reported`
      const millions = (n: number) => `${(n / 1_000_000).toFixed(1)}M`
      const line = (c: (typeof crises)[number]) => {
        const lead = c.stories?.[0]
        const abroad = c.outletsAbroad ? `, ${c.outletsAbroad} based abroad` : ''
        return `${c.rank}. ${c.name}: ${millions(c.displaced)} displaced, ${c.outlets} outlet${c.outlets === 1 ? '' : 's'}${abroad} (${c.peoplePerOutlet.toLocaleString('en-US')} people per outlet)${lead ? ` · top story: ${lead.title} ${signalLink(lead.id)}` : ''}`
      }
      const share = d.totals?.crisisShare
      const text = [
        `Under-reported crises, ${d.week ? `week ${d.week}` : 'the last 7 days'}: ${crises.length} countries with at least a million people displaced (UNHCR ${d.unhcrYear ?? ''} figures), the fewest outlets per person first. Page: ${page}`,
        share !== undefined && d.totals?.crisisDisplaced ? `Together, ${millions(d.totals.crisisDisplaced)} people displaced; ${(share * 100).toFixed(1)}% of the news articles WorldPulse placed in a country.` : '',
        '',
        crises.map(line).join('\n'),
        d.mostCovered?.length ? `\nFor comparison, the most covered countries: ${d.mostCovered.map(c => `${c.name} ${c.outlets} outlets`).join(', ')}` : '',
      ].join('\n').trim()
      return {
        text,
        data: {
          week: d.week ?? null, url: page,
          crises: crises.map(c => ({ rank: c.rank, code: c.code, name: c.name, displaced: c.displaced, outlets: c.outlets, outletsAbroad: c.outletsAbroad ?? null, peoplePerOutlet: c.peoplePerOutlet, topStory: c.stories?.[0] ? { ...c.stories[0], url: signalLink(c.stories[0].id) } : null })),
          mostCovered: d.mostCovered ?? [],
        },
      }
    },
  },
  {
    name: 'story_numbers',
    title: 'A story\'s numbers, counted',
    description: 'The numbers in one story as its outlets report them: people killed, injured, missing, displaced, evacuated, abducted, arrested or rescued, each value with how many outlets (websites) give it and which, the most reported first, so you can say which figure most outlets give and where they differ. Read from the headlines of the story\'s reports in its last two days. Takes a story id or a report id, as top_stories, story and search_reports give them.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'A story id or a report id (a UUID)' } },
      required: ['id'],
      additionalProperties: false,
    },
    async run(args, asker) {
      const id = strArg(args, 'id', { required: true, pattern: UUID, hint: 'must be a story or report id (a UUID)' })!
      const { status, body } = await ask(asker, `/api/v1/stories/${id}/figures`)
      if (status === 404) throw new ToolError('No story or report with that id')
      if (status !== 200) throw new Error(`figures answered ${status}`)
      const d = (body.data ?? {}) as {
        storyId?: string; reports?: number; countedHours?: number
        figures?: Array<{ kind: string; label: string; values?: Array<{ value: number; text: string; outlets: number; outletNames?: string[]; headline?: string; url?: string }> }>
      }
      const figures = (d.figures ?? []).filter(f => (f.values ?? []).length > 0)
      const page = signalLink(id)
      const text = figures.length === 0
        ? `No numbers (killed, injured, missing, displaced, evacuated, abducted, arrested, rescued) in the headlines of this story's reports in its last ${d.countedHours ?? 48} hours. Page: ${page}`
        : [
          `The numbers in this story, as its outlets report them (from the headlines of its ${d.reports ?? 0} reports in its last ${d.countedHours ?? 48} hours; the most reported first):`,
          ...figures.map(figureLine),
          `Page: ${page}`,
        ].join('\n')
      return {
        text,
        data: {
          storyId: d.storyId ?? id, url: page, reports: d.reports ?? 0, countedHours: d.countedHours ?? 48,
          figures: figures.map(f => ({
            kind: f.kind, label: f.label,
            values: (f.values ?? []).map(v => ({ value: v.value, outlets: v.outlets, outletNames: v.outletNames ?? [], headline: v.headline ?? null, url: v.url ?? null })),
          })),
        },
      }
    },
  },
  {
    name: 'outlet',
    title: 'What an outlet is',
    description: 'What a news website is, from the directory of outlets WorldPulse counts: its name, home country, kind (news agency, international, national, local, specialist, aggregator or official source) and whether a government runs it (state media). Give websites or article addresses, up to 10. A website outside the directory can still count as an outlet in a story; WorldPulse just knows nothing more about it.',
    inputSchema: {
      type: 'object',
      properties: {
        sites: {
          type: 'array', minItems: 1, maxItems: 10,
          items: { type: 'string', minLength: 3, maxLength: 2048 },
          description: 'Websites or article addresses, e.g. ["tass.com", "https://www.bbc.co.uk/news/articles/c6n9r01d2709o"]',
        },
      },
      required: ['sites'],
      additionalProperties: false,
    },
    async run(args) {
      const raw = args.sites
      const given = (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,]+/) : [])
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= 2048)
      if (given.length === 0) throw new ToolError('sites must list at least one website or article address')
      if (given.length > 10) throw new ToolError('sites can list at most 10 websites')
      const size = Object.keys(OUTLET_DIRECTORY).length
      const outlets = given.map(g => {
        const site = siteOf(g)
        const e = site ? outletOf(site) : null
        return e
          ? { site: e.site, known: true, name: e.name, kind: e.kind, kindLabel: OUTLET_KIND_LABELS[e.kind], country: e.country, countryName: countryLabel(e.country, false), stateMedia: Boolean(e.state) }
          : { site: site || g, known: false, name: null, kind: null, kindLabel: null, country: null, countryName: null, stateMedia: null }
      })
      const text = [
        ...outlets.map(o => o.known
          ? `${o.site}: ${o.name}, ${String(o.kindLabel).toLowerCase()}, from ${countryLabel(String(o.country))}${o.stateMedia ? ', state media (a government runs it)' : ''}`
          : `${o.site}: not in WorldPulse's directory of ${size} outlets`),
        `What the kinds mean: ${SITE}/how-we-count#kinds`,
      ].join('\n')
      return { text, data: { outlets, directorySize: size } }
    },
  },
  {
    name: 'near',
    title: 'Reports near a place',
    description: 'The verified reports WorldPulse pinned on its map within a distance of a place, newest first: each with its headline, place, distance, its story\'s outlet count and its link. Give the place\'s latitude and longitude (Odesa is 46.48, 30.73). With pending true, reports not verified yet too (one outlet so far: unconfirmed). Reports are pinned to the place they name, often a city or a country\'s capital.',
    inputSchema: {
      type: 'object',
      properties: {
        latitude:  { type: 'number', minimum: -90, maximum: 90, description: 'The place\'s latitude, e.g. 46.48' },
        longitude: { type: 'number', minimum: -180, maximum: 180, description: 'The place\'s longitude, e.g. 30.73' },
        radius_km: { type: 'integer', minimum: 5, maximum: 500, default: 100, description: 'How far from it, in km (5 to 500, default 100)' },
        hours:     { type: 'integer', minimum: 1, maximum: 72, default: 24, description: 'How many hours back (1 to 72, default 24)' },
        pending:   { type: 'boolean', default: false, description: 'Also reports not verified yet' },
        limit:     { type: 'integer', minimum: 1, maximum: 25, default: 10, description: 'How many reports (1 to 25, default 10)' },
      },
      required: ['latitude', 'longitude'],
      additionalProperties: false,
    },
    async run(args, asker) {
      const lat = numArg(args, 'latitude', -90, 90)
      const lng = numArg(args, 'longitude', -180, 180)
      const km = intArg(args, 'radius_km', 100, 5, 500)
      const hours = intArg(args, 'hours', 24, 1, 72)
      const limit = intArg(args, 'limit', 10, 1, 25)
      const pending = boolArg(args, 'pending')
      const box = boxAround(lat, lng, km).join(',')
      type Item = { id: string; title: string; status: string; location?: { lat: number; lng: number } | null; locationName?: string | null; countryCode?: string | null; createdAt?: string | null }
      const statuses = pending ? ['verified', 'pending'] : ['verified']
      const pages = await Promise.all(statuses.map(st => ask(asker, `/api/v1/signals?bbox=${box}&status=${st}&limit=100`)))
      const items: Item[] = []
      for (const { status, body } of pages) {
        if (status !== 200) throw new Error(`signals answered ${status}`)
        items.push(...(((body.data ?? {}) as { items?: Item[] }).items ?? []))
      }
      const since = Date.now() - hours * 3_600_000
      const near = items
        .filter(it => it.location && Number.isFinite(it.location.lat) && Number.isFinite(it.location.lng) && Date.parse(String(it.createdAt)) >= since)
        .map(it => ({ ...it, km: distanceKm(lat, lng, it.location!.lat, it.location!.lng) }))
        .filter(it => it.km <= km)
        .sort((a, b) => Date.parse(String(b.createdAt)) - Date.parse(String(a.createdAt)))
        .slice(0, limit)
      // each report's story: how many outlets carry it (one call for all of them)
      let stories: Record<string, { outlets?: number; verified?: boolean }> = {}
      if (near.length > 0) {
        const { status, body } = await ask(asker, `/api/v1/stories/outlets?ids=${near.map(n => n.id).join(',')}`)
        if (status === 200) stories = (((body.data ?? {}) as { stories?: typeof stories }).stories) ?? {}
      }
      const where = `${lat.toFixed(2)}, ${lng.toFixed(2)}`
      const text = near.length === 0
        ? `No ${pending ? '' : 'verified '}report within ${km} km of ${where} in the last ${hours} hours. WorldPulse pins a report to the place it names; try a larger radius_km or more hours${pending ? '' : ', or pending true'}. Map: ${SITE}/map`
        : [
          `${near.length} ${pending ? '' : 'verified '}report${near.length === 1 ? '' : 's'} within ${km} km of ${where} in the last ${hours} hours, newest first:`,
          ...near.map((n, i) => {
            const st = stories[n.id]
            const outlets = Number(st?.outlets) || 0
            const proof = n.status === 'verified' || st?.verified ? `Verified${outlets >= 2 ? ` · ${outlets} outlets` : ''}` : outlets >= 2 ? `${outlets} outlets so far` : 'One outlet so far (unconfirmed)'
            return `${i + 1}. ${n.title}\n   ${proof} · ${n.locationName ?? 'here'}, ${Math.round(n.km)} km away · ${agoLabel(n.createdAt)}\n   ${signalLink(n.id)}`
          }),
          `Map: ${SITE}/map`,
        ].join('\n')
      return {
        text,
        data: {
          latitude: lat, longitude: lng, radiusKm: km, hours,
          reports: near.map(n => ({
            id: n.id, title: n.title, url: signalLink(n.id), status: n.status, place: n.locationName ?? null, country: n.countryCode ?? null,
            km: Math.round(n.km), at: n.createdAt ?? null, storyOutlets: Number(stories[n.id]?.outlets) || null,
          })),
        },
      }
    },
  },
  {
    name: 'country',
    title: 'A country right now',
    description: 'How WorldPulse covers a country now: how many of the outlets it counts are based there (and some of their names), the verified reports pinned there in the last 24 hours, the stories the most outlets carry there, and whether it is among the under-reported crises (at least a million people displaced, UNHCR). Give a two-letter country code, e.g. SD for Sudan.',
    inputSchema: {
      type: 'object',
      properties: { country: { type: 'string', pattern: '^[A-Za-z]{2}$', description: 'A two-letter country code (ISO 3166-1), e.g. SD' } },
      required: ['country'],
      additionalProperties: false,
    },
    async run(args, asker) {
      const given = strArg(args, 'country', { required: true, pattern: /^[A-Za-z]{2}$/, hint: 'must be a two-letter country code such as SD' })!.toUpperCase()
      const code = given === 'UK' ? 'GB' : given   // WorldPulse files the United Kingdom under GB
      const label = countryLabel(code, false)
      if (label === code) throw new ToolError(`${code} is not a country code WorldPulse knows`)
      const based = Object.entries(OUTLET_DIRECTORY).filter(([, e]) => e.country === code).map(([site, e]) => ({ site, name: e.name, kind: e.kind, stateMedia: Boolean(e.state) }))
      const [c, st, gap] = await Promise.all([
        ask(asker, `/api/v1/countries/${code}?window=24h`),
        ask(asker, `/api/v1/stories?hours=24&limit=5&country=${code}`),
        ask(asker, `/api/v1/coverage-gap`),
      ])
      const cd = (c.status === 200 ? ((c.body.data ?? c.body) as { total_signals?: number }) : {})
      const stories = st.status === 200 ? ((st.body.data ?? {}) as { stories?: ListedStory[] }).stories ?? [] : []
      const crises = gap.status === 200 ? ((gap.body.data ?? {}) as { crises?: Array<{ rank: number; code: string; displaced: number; outlets: number; peoplePerOutlet: number }> }).crises ?? [] : []
      const crisis = crises.find(x => x.code === code) ?? null
      const page = `${SITE}/countries/${code.toLowerCase()}`
      const named = based.slice(0, 6).map(b => `${b.name}${b.stateMedia ? ' (state media)' : ''}`)
      const head = [
        `${label}, the last 24 hours. Page: ${page}`,
        based.length
          ? `Outlets WorldPulse counts that are based there: ${based.length} (${named.join(', ')}${based.length > named.length ? ', …' : ''}).`
          : 'WorldPulse counts no outlet based there: its stories come from outlets abroad.',
        ...(typeof cd.total_signals === 'number' ? [`Verified reports pinned there: ${cd.total_signals}.`] : []),
        ...(crisis
          ? [`Among the under-reported crises: number ${crisis.rank} of ${crises.length}, ${(crisis.displaced / 1_000_000).toFixed(1)}M people displaced (UNHCR) and ${crisis.outlets} outlet${crisis.outlets === 1 ? '' : 's'} in the last 7 days. ${SITE}/under-reported`]
          : []),
      ]
      const text = `${head.join('\n')}\n\n${stories.length
        ? `The stories the most outlets carry there:\n${stories.map(storyLine).join('\n')}`
        : 'No story there was reported by two or more outlets in the last 24 hours.'}`
      return {
        text,
        data: {
          country: code, name: label, url: page,
          outletsBasedThere: based.length, outlets: based.slice(0, 20),
          verifiedReports24h: typeof cd.total_signals === 'number' ? cd.total_signals : null,
          underReported: crisis ? { rank: crisis.rank, of: crises.length, displaced: crisis.displaced, outlets: crisis.outlets, peoplePerOutlet: crisis.peoplePerOutlet } : null,
          stories: stories.map(storyOut),
        },
      }
    },
  },
  {
    name: 'daily_brief',
    title: 'Today\'s briefing',
    description: 'WorldPulse\'s Daily Briefing for the last 24 hours: a few sentences on the main developments, then its sections (threats, geopolitics, economy, maritime, climate and disasters, cyber, what to watch), with outlet counts. An AI model writes it once a day from the verified stories; check a story with top_stories or story before relying on a detail.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(_args, asker) {
      const { status, body } = await ask(asker, `/api/v1/briefing/structured`)
      if (status !== 200) throw new Error(`briefing answered ${status}`)
      const d = (body.data ?? body) as { date?: string; generated_at?: string; executive_summary?: string; sections?: Array<{ id?: string; title?: string; body?: string }> }
      const sections = (d.sections ?? []).filter(x => typeof x.title === 'string' && typeof x.body === 'string' && x.body.trim() !== '')
      if (!d.executive_summary && sections.length === 0) throw new ToolError('Today\'s briefing is being written; try again in a few minutes')
      const at = d.generated_at ? new Date(d.generated_at) : null
      const when = at && Number.isFinite(at.getTime()) ? `, written ${at.toISOString().slice(11, 16)} UTC` : ''
      const text = [
        `WorldPulse Daily Briefing, ${d.date ?? 'today'}${when} by an AI model from verified stories. Page: ${SITE}/briefing`,
        '',
        d.executive_summary ?? '',
        ...sections.map(x => `\n${x.title}: ${x.body}`),
      ].join('\n').trim()
      return { text, data: { date: d.date ?? null, generatedAt: d.generated_at ?? null, url: `${SITE}/briefing`, summary: d.executive_summary ?? null, sections: sections.map(x => ({ id: x.id ?? null, title: x.title, body: x.body })) } }
    },
  },
  {
    name: 'entity',
    title: 'Who or what is in the news',
    description: 'A person, organisation or place in the news, by name (e.g. "NATO", "Elon Musk", "the Houthis", "Kharkiv"): how many WorldPulse reports name it in the last 24 hours, the day before and the last 7 days, the stories naming it with how many outlets carry each and from how many countries, and who or what it is in the news with. Other entities matching the name are listed with their ids; pass id to open one of them.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 120, description: 'The name, e.g. NATO' },
        id: { type: 'string', pattern: '^[A-Za-z0-9_-]{4,64}$', description: 'An entity id this tool gave, instead of name' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const id = strArg(args, 'id', { pattern: /^[A-Za-z0-9_-]{4,64}$/, hint: 'must be an entity id this tool gave' })
      const name = id ? undefined : strArg(args, 'name', { required: true, max: 120 })
      if (name !== undefined && name.length < 2) throw new ToolError('name must be at least 2 characters')
      let others: EntityHit[] = []
      let entityId = id
      if (!entityId) {
        const found = await findEntity(asker, name!)
        if (!found.entity) throw new ToolError(`No person, organisation or place named "${name}" in WorldPulse's reports`)
        entityId = found.entity.id
        others = found.others
      }
      const { status, body } = await ask(asker, `/api/v1/knowledge-graph/entities/${encodeURIComponent(entityId)}/profile`)
      if (status === 404) throw new ToolError('No person, organisation or place with that id')
      if (status !== 200) throw new Error(`entity profile answered ${status}`)
      const p = (body.data ?? {}) as {
        entity?: { id: string; type: string; name: string; firstSeen?: string | null; lastSeen?: string | null }
        activity?: { last24h?: number; previous24h?: number; last7d?: number }
        stories?: ListedStory[]
        connections?: Array<{ id: string; type: string; name: string; shared: number }>
      }
      const e = p.entity ?? { id: entityId, type: 'other', name: name ?? entityId }
      const page = entityPage(e.id, e.name)
      const a = p.activity ?? {}
      const stories = (p.stories ?? []).slice(0, 6)
      const connections = (p.connections ?? []).slice(0, 8)
      const text = [
        `${e.name} (${e.type}). Page: ${page}`,
        `Reports naming it: ${a.last24h ?? 0} in the last 24 hours (${a.previous24h ?? 0} the day before), ${a.last7d ?? 0} in the last 7 days.`,
        '',
        stories.length ? `Stories naming it, the most outlets first:\n${stories.map(storyLine).join('\n')}` : 'No story naming it was reported by two or more outlets in the last two weeks.',
        connections.length ? `\nIn the news with: ${connections.map(c => `${c.name} (${c.shared} report${c.shared === 1 ? '' : 's'} together)`).join(', ')}` : '',
        others.length ? `\nOther matches for "${name}": ${others.map(o => `${o.canonical_name} (${o.type}, id ${o.id})`).join('; ')}` : '',
      ].join('\n').trim()
      return {
        text,
        data: {
          entity: { id: e.id, type: e.type, name: e.name, url: page, firstSeen: e.firstSeen ?? null, lastSeen: e.lastSeen ?? null },
          activity: { last24h: a.last24h ?? 0, previous24h: a.previous24h ?? 0, last7d: a.last7d ?? 0 },
          stories: stories.map(storyOut),
          connections: connections.map(c => ({ id: c.id, type: c.type, name: c.name, shared: c.shared })),
          otherMatches: others.map(o => ({ id: o.id, type: o.type, name: o.canonical_name, mentions: o.mention_count })),
        },
      }
    },
  },
  {
    name: 'trend',
    title: 'How coverage changed',
    description: 'How much WorldPulse\'s outlets report about a country, or about a person, organisation or place, day by day: the total, the last 7 days against the 7 before, the busiest day, week by week and the last 7 days one by one. Give country (a two-letter code such as SD, 7 to 90 days, default 30) or name (an entity, the last 30 days). The counts are reports WorldPulse holds, and it reads more sources over time: compare recent weeks rather than months.',
    inputSchema: {
      type: 'object',
      properties: {
        country: { type: 'string', pattern: '^[A-Za-z]{2}$', description: 'A two-letter country code, e.g. SD' },
        name: { type: 'string', minLength: 2, maxLength: 120, description: 'A person, organisation or place, e.g. NATO' },
        days: { type: 'integer', minimum: 7, maximum: 90, default: 30, description: 'For a country: 7 to 90 days (default 30)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const country = strArg(args, 'country', { pattern: /^[A-Za-z]{2}$/, hint: 'must be a two-letter country code such as SD' })
      const name = strArg(args, 'name', { max: 120 })
      if (!country === !name) throw new ToolError('Give either country (a two-letter code) or name (a person, organisation or place)')
      let label: string
      let page: string
      let days: Array<{ day: string; n: number; verified?: number }>
      if (country) {
        const code = country.toUpperCase() === 'UK' ? 'GB' : country.toUpperCase()
        label = countryLabel(code, false)
        if (label === code) throw new ToolError(`${code} is not a country code WorldPulse knows`)
        const n = intArg(args, 'days', 30, 7, 90)
        const { status, body } = await ask(asker, `/api/v1/countries/${code}/daily?days=${n}`)
        if (status === 400) throw new ToolError('country must be a two-letter country code such as SD')
        if (status !== 200) throw new Error(`country daily answered ${status}`)
        const d = (body.data ?? {}) as { daily?: Array<{ day: string; reports: number; verified: number }> }
        page = `${SITE}/countries/${code.toLowerCase()}`
        days = (d.daily ?? []).map(x => ({ day: x.day, n: x.reports, verified: x.verified }))
      } else {
        if (name!.length < 2) throw new ToolError('name must be at least 2 characters')
        const found = await findEntity(asker, name!)
        if (!found.entity) throw new ToolError(`No person, organisation or place named "${name}" in WorldPulse's reports`)
        const { status, body } = await ask(asker, `/api/v1/knowledge-graph/entities/${encodeURIComponent(found.entity.id)}/profile`)
        if (status !== 200) throw new Error(`entity profile answered ${status}`)
        const p = (body.data ?? {}) as { entity?: { name: string }; activity?: { daily?: Array<{ day: string; n: number }> } }
        label = p.entity?.name ?? found.entity.canonical_name
        page = entityPage(found.entity.id, label)
        days = p.activity?.daily ?? []
      }
      if (days.length === 0) throw new ToolError('WorldPulse has no counts for that just now; try again in a few minutes')
      const sum = (xs: typeof days) => xs.reduce((t, x) => t + (Number(x.n) || 0), 0)
      const total = sum(days)
      const last7 = sum(days.slice(-7))
      const prev7 = sum(days.slice(-14, -7))
      const change = prev7 > 0 ? `${last7 >= prev7 ? '+' : ''}${Math.round(((last7 - prev7) / prev7) * 100)}%` : last7 > 0 ? 'up from none' : 'none either week'
      const busiest = days.reduce((b, x) => (x.n > b.n ? x : b), days[0]!)
      // weeks from the newest back, so the last one is the last 7 days
      const weeks: string[] = []
      for (let end = days.length; end > 0; end -= 7) {
        const w = days.slice(Math.max(0, end - 7), end)
        weeks.unshift(`${shortDay(w[0]!.day)}–${shortDay(w[w.length - 1]!.day)}: ${sum(w)}`)
      }
      const verifiedTotal = days.some(x => typeof x.verified === 'number') ? days.reduce((t, x) => t + (x.verified ?? 0), 0) : null
      const text = [
        `Coverage of ${label} on WorldPulse, the last ${days.length} days (reports a day, UTC). Page: ${page}`,
        `Total: ${total} reports${verifiedTotal !== null ? ` (${verifiedTotal} verified)` : ''}. The last 7 days: ${last7}; the 7 before: ${prev7} (${change}). Busiest day: ${shortDay(busiest.day)} (${busiest.n}).`,
        `By week: ${weeks.join(' · ')}`,
        `The last 7 days: ${days.slice(-7).map(x => `${shortDay(x.day)}: ${x.n}`).join(' · ')}`,
        'These are the reports WorldPulse holds; it reads more sources over time, so compare recent weeks rather than months.',
      ].join('\n')
      return {
        text,
        data: { subject: label, kind: country ? 'country' : 'entity', url: page, total, verifiedTotal, last7, previous7: prev7, busiest: { day: busiest.day, reports: busiest.n }, daily: days.map(x => ({ day: x.day, reports: x.n, ...(typeof x.verified === 'number' ? { verified: x.verified } : {}) })) },
      }
    },
  },
  {
    name: 'check_claim',
    title: 'Check a claim against the newsrooms',
    description: 'What the newsrooms WorldPulse reads report about a claim (e.g. "nine people were killed in the Krakow shooting"): the closest stories, each with how many outlets carry it, from how many countries, whether it is verified and its link, and for the closest one the numbers its outlets give (the dead, the injured…) with how many outlets give each. It never rules a claim true or false: it shows what the outlets say. When no story is close (close: false), the nearest are shown as probably about something else; that is not evidence that a claim is false.',
    inputSchema: {
      type: 'object',
      properties: { claim: { type: 'string', minLength: 5, maxLength: 300, description: 'The claim, in plain words' } },
      required: ['claim'],
      additionalProperties: false,
    },
    async run(args, asker) {
      const claim = strArg(args, 'claim', { required: true, max: 300 })!
      if (claim.length < 5) throw new ToolError('claim must be at least 5 characters')
      const search = await ask(asker, `/api/v1/search/semantic?q=${encodeURIComponent(claim)}&limit=10`)
      if (search.status !== 200) throw new Error(`search answered ${search.status}`)
      if (search.body.semantic === false) throw new ToolError('Search by meaning is starting up; try again in a few minutes')
      type Hit = { id: string; title: string; status?: string; score?: number; createdAt?: string; locationName?: string | null }
      const hits = ((search.body.results ?? []) as Hit[]).filter(r => r && UUID.test(String(r.id)) && typeof r.title === 'string')
      if (hits.length === 0) {
        return {
          text: `WorldPulse holds no report close to "${claim}". That is not evidence the claim is false: it may be very new, local, or reported only by newsrooms WorldPulse doesn't read.`,
          data: { claim, close: false, stories: [], figures: null },
        }
      }
      // the reports about the claim; when none is that close, the nearest, said to be probably about something else
      const close = hits.filter(h => typeof h.score !== 'number' || h.score >= CLAIM_CLOSE)
      const nearOnly = close.length === 0
      const pool = nearOnly ? hits : close
      const outlets = await ask(asker, `/api/v1/stories/outlets?ids=${pool.map(h => h.id).join(',')}`)
      const counts = (outlets.status === 200 ? ((outlets.body.data ?? {}) as { stories?: Record<string, { storyId?: string; outlets?: number; verified?: boolean; countries?: number; canonicalId?: string; firstReportAt?: string | null }> }).stories : undefined) ?? {}
      // one line per story: its closest report (the search gives the closest first)
      const seen = new Set<string>()
      const stories: Array<{ hit: Hit; storyId: string; outlets: number; verified: boolean; countries: number; url: string; since: string | null }> = []
      for (const h of pool) {
        const c = counts[h.id]
        const storyId = c?.storyId ?? h.id
        if (seen.has(storyId)) continue
        seen.add(storyId)
        stories.push({
          hit: h, storyId, outlets: Number(c?.outlets) || 1, verified: c?.verified === true || h.status === 'verified',
          countries: Number(c?.countries) || 0, url: signalLink(c?.canonicalId ?? h.id), since: c?.firstReportAt ?? null,
        })
        if (stories.length === 3) break
      }
      const top = stories[0]!
      // the closest story's numbers, as its outlets give them (not for a story about something else)
      const fig = nearOnly ? null : await ask(asker, `/api/v1/stories/${top.storyId}/figures`)
      const figures = fig?.status === 200 ? ((((fig.body.data ?? {}) as { figures?: FigureValues[] }).figures) ?? []).filter(f => (f.values ?? []).length > 0) : []
      const proof = (s: (typeof stories)[number]) => {
        const where = s.countries >= 2 ? ` in ${s.countries} countries` : ''
        const since = s.since ? ` · reported since ${shortDay(s.since.slice(0, 10))}` : ''
        return s.verified
          ? `Verified · ${s.outlets} outlets${where}${since}`
          : s.outlets >= 2 ? `${s.outlets} outlets so far${where}, not verified yet${since}` : `Only one outlet so far: unconfirmed${since}`
      }
      const text = [
        `What the newsrooms WorldPulse reads report about: "${claim}"`,
        nearOnly
          ? 'Nothing WorldPulse holds is close to this claim. The nearest stories are below, probably about something else. That is not evidence the claim is false: it may be very new, local, or reported only by newsrooms WorldPulse doesn\'t read.'
          : 'WorldPulse does not rule claims true or false; here are the closest stories, the closest first. Compare them with the claim before relying on one.',
        '',
        ...stories.map((s, i) => `${i + 1}. ${s.hit.title}${s.hit.locationName ? ` (${s.hit.locationName})` : ''}\n   ${proof(s)}\n   ${s.url}`),
        figures.length ? `\nThe numbers the first story's outlets give, the most reported first:\n${figures.map(figureLine).join('\n')}` : '',
      ].join('\n').trim()
      return {
        text,
        data: {
          claim,
          close: !nearOnly,
          stories: stories.map(s => ({ storyId: s.storyId, title: s.hit.title, url: s.url, place: s.hit.locationName ?? null, verified: s.verified, outlets: s.outlets, outletCountries: s.countries, reportedSince: s.since, match: s.hit.score ?? null })),
          figures: figures.length ? figures.map(f => ({ label: f.label, values: (f.values ?? []).map(v => ({ value: v.text, outlets: v.outlets, outletNames: v.outletNames ?? [] })) })) : null,
        },
      }
    },
  },
  {
    name: 'breaking',
    title: 'Breaking now',
    description: 'The urgent reports of the last few hours: the critical and high-severity news reports WorldPulse flagged as breaking (each stays up for 6 hours), newest first and each story once, each with its severity, kind, place, how long ago, how many outlets carry its story (verified or not yet) and its link. Never aircraft transponder alarms (automatic readings, often wrong), satellite and sensor readings (wildfire detections, earthquakes: the hazards tool has them) or opinion pieces. A breaking report may come from one outlet so far: check its line before relying on it.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'How many (1 to 20, default 10)' } },
      additionalProperties: false,
    },
    async run(args, asker) {
      const limit = intArg(args, 'limit', 10, 1, 20)
      const { status, body } = await ask(asker, `/api/v1/breaking/alerts`)
      if (status !== 200) throw new Error(`breaking alerts answered ${status}`)
      type Alert = { signalId: string; title: string; severity?: string; category?: string; locationName?: string | null; countryCode?: string | null; timestamp?: string; expiresAt?: string }
      const now = Date.now()
      const live = ((((body.data ?? {}) as { alerts?: Alert[] }).alerts) ?? [])
        .filter(a => a && typeof a.title === 'string' && UUID.test(String(a.signalId)) && !(Date.parse(String(a.expiresAt)) < now))
      // news only (the list keeps none other since Nov 8, 2026: lib/breaking-news.ts), newest first
      const news = live.filter(a => notBreakingNews(a.title) === null)
        .sort((x, y) => (Date.parse(String(y.timestamp)) || 0) - (Date.parse(String(x.timestamp)) || 0))
      // newest first, each story once (an alert can be raised for several reports of one story, or twice for one)
      const counts = await storyCounts(asker, news.map(a => a.signalId))
      const seen = new Set<string>()
      const alerts: Alert[] = []
      for (const a of news) {
        const story = counts[a.signalId]?.storyId ?? a.signalId
        if (seen.has(story)) continue
        seen.add(story)
        alerts.push(a)
        if (alerts.length === limit) break
      }
      const placeOf = (a: Alert) => a.locationName || (a.countryCode ? countryLabel(a.countryCode, false) : '')
      const urlOf = (a: Alert) => signalLink(counts[a.signalId]?.canonicalId ?? a.signalId)
      const text = alerts.length === 0
        ? `No breaking report right now. The stories the most outlets carry: top_stories. ${SITE}`
        : [
          'Breaking: the critical and high-severity news reports of the last few hours, newest first:',
          ...alerts.map((a, i) => `${i + 1}. ${a.title}\n   ${[cap(a.severity), a.category, placeOf(a), agoLabel(a.timestamp, now)].filter(Boolean).join(' · ')} · ${proofLine(counts[a.signalId])}\n   ${urlOf(a)}`),
          'A breaking report may come from one outlet so far: check its line before relying on it.',
        ].join('\n')
      return {
        text,
        data: {
          alerts: alerts.map(a => {
            const c = counts[a.signalId]
            return {
              reportId: a.signalId, title: a.title, url: urlOf(a), severity: a.severity ?? null, category: a.category ?? null, place: placeOf(a) || null,
              country: a.countryCode ?? null, at: a.timestamp ?? null, storyOutlets: Number(c?.outlets) || 1, verified: c?.verified === true, outletCountries: Number(c?.countries) || 0,
            }
          }),
        },
      }
    },
  },
  {
    name: 'trending',
    title: 'Who and what is in the news',
    description: 'The people, organisations and places named in the most WorldPulse reports in the last 24 hours, weighted by how much more than in the 24 hours before (so a sudden name ranks above a constant one): each with its reports in both windows, whether it is new in the news, its page and its id (open one with entity, or trend for day by day). Give type for only people, organisations or places.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['person', 'organisation', 'place'], description: 'Only people, organisations or places' },
        limit: { type: 'integer', minimum: 1, maximum: 10, default: 10, description: 'How many (1 to 10, default 10)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const given = strArg(args, 'type', { pattern: /^(person|people|organisation|organization|place|location)$/i, hint: 'must be person, organisation or place' })?.toLowerCase()
      const type = given ? ({ person: 'person', people: 'person', organisation: 'organisation', organization: 'organisation', place: 'location', location: 'location' } as Record<string, string>)[given] : undefined
      const limit = intArg(args, 'limit', 10, 1, 10)
      // the website's own question (its "In the news" row), so the answer is usually kept and ready
      const { status, body } = await ask(asker, `/api/v1/knowledge-graph/trending?limit=10&window_hours=24&lean=1${type ? `&type=${type}` : ''}`)
      if (status !== 200) throw new Error(`trending answered ${status}`)
      type Row = { entity?: { id: string; type: string; canonical_name?: string; name?: string }; recent_mentions?: number; previous_mentions?: number; is_new?: boolean }
      const rows = (((body as { trending?: Row[] }).trending) ?? []).filter(r => r?.entity && typeof r.entity.id === 'string').slice(0, limit)
      const kind = (t: string) => (t === 'location' ? 'place' : t)
      const plural: Record<string, string> = { person: 'people', organisation: 'organisations', location: 'places' }
      const nameOf = (r: Row) => r.entity!.canonical_name || r.entity!.name || r.entity!.id
      const text = rows.length === 0
        ? 'No name stands out in the news just now; try again in a few minutes.'
        : [
          `In the news most, the last 24 hours against the 24 before${type ? ` (${plural[type]} only)` : ''}:`,
          ...rows.map((r, i) => `${i + 1}. ${nameOf(r)} (${kind(r.entity!.type)}): ${r.recent_mentions ?? 0} report${r.recent_mentions === 1 ? '' : 's'} (${r.previous_mentions ?? 0} the 24 hours before)${r.is_new ? ' · new in the news' : ''}\n   ${entityPage(r.entity!.id, nameOf(r))} (id ${r.entity!.id})`),
          'Open one with entity (its stories, who it is in the news with) or trend (day by day).',
        ].join('\n')
      return {
        text,
        data: {
          type: type ? kind(type) : 'all', windowHours: 24, generatedAt: (body as { generated_at?: string }).generated_at ?? null,
          entities: rows.map(r => ({
            id: r.entity!.id, type: kind(r.entity!.type), name: nameOf(r), url: entityPage(r.entity!.id, nameOf(r)),
            reports24h: r.recent_mentions ?? 0, reportsDayBefore: r.previous_mentions ?? 0, newInTheNews: r.is_new === true,
          })),
        },
      }
    },
  },
  {
    name: 'hotspots',
    title: 'Where the news meets',
    description: 'Where the most is happening in the last 24 hours: the places (map cells about 100 km across) where serious reports of several kinds meet (conflict, disaster, economy, health…), the most serious first: each with its reports, its kinds, its worst severity, how recent, two of its headlines and a map link. A place named for a whole country also gathers that country\'s stories pinned to it as a whole.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 15, default: 8, description: 'How many places (1 to 15, default 8)' } },
      additionalProperties: false,
    },
    async run(args, asker) {
      const limit = intArg(args, 'limit', 8, 1, 15)
      // the website's globe asks this, so the answer is usually kept and ready
      const { status, body } = await ask(asker, `/api/v1/signals/map/hotspots?hours=24&min_categories=2&limit=25`)
      if (status !== 200) throw new Error(`hotspots answered ${status}`)
      type Spot = { centerLat: number; centerLng: number; place: string | null; signalCount: number; categoryCount: number; categories?: string[]; maxSeverity?: string; latestSignalAt?: string | null; sampleTitles?: string[]; sampleIds?: string[] }
      const spots = ((((body.data ?? {}) as { hotspots?: Spot[] }).hotspots) ?? [])
        .filter(s => s && Number.isFinite(s.centerLat) && Number.isFinite(s.centerLng))
        .slice(0, limit)
      const mapLink = (s: Spot) => `${SITE}/map?lat=${s.centerLat.toFixed(2)}&lng=${s.centerLng.toFixed(2)}&z=6`
      const placeOf = (s: Spot) => s.place || `${s.centerLat.toFixed(1)}, ${s.centerLng.toFixed(1)}`
      const headlines = (s: Spot) => (s.sampleTitles ?? [])
        .map((title, k) => ({ title, url: UUID.test(String((s.sampleIds ?? [])[k])) ? signalLink((s.sampleIds ?? [])[k]) : null }))
        .filter(h => !SQUAWK.test(h.title))
        .slice(0, 2)
      const text = spots.length === 0
        ? `No place stands out in the last 24 hours. Map: ${SITE}/map`
        : [
          'Where the most is happening, the last 24 hours: places where serious reports of several kinds meet, the most serious first.',
          ...spots.map((s, i) => [
            `${i + 1}. ${placeOf(s)}: ${s.signalCount} reports, ${s.categoryCount} kinds (${(s.categories ?? []).join(', ')}), worst ${s.maxSeverity ?? 'unknown'}${s.latestSignalAt ? ` · latest ${agoLabel(s.latestSignalAt)}` : ''}`,
            ...headlines(s).map(h => `   "${h.title}"${h.url ? ` ${h.url}` : ''}`),
            `   Map: ${mapLink(s)}`,
          ].join('\n')),
          'A place named for a whole country also gathers that country\'s stories pinned to it as a whole. The reports near a point: near.',
        ].join('\n')
      return {
        text,
        data: {
          hours: 24,
          hotspots: spots.map(s => ({
            place: placeOf(s), latitude: s.centerLat, longitude: s.centerLng, reports: s.signalCount, kinds: s.categoryCount, categories: s.categories ?? [],
            worstSeverity: s.maxSeverity ?? null, latestAt: s.latestSignalAt ?? null, headlines: headlines(s), map: mapLink(s),
          })),
        },
      }
    },
  },
  {
    name: 'story_by_country',
    title: 'One story, country by country',
    description: 'Where a story\'s outlets are from, country by country: for each country, how many of the outlets that carried the story in its last two days are based there, their names (state media marked) and one of their headlines, so how each country\'s newsrooms put it can be compared; the story\'s own country first, then the most outlets. Websites the outlet directory doesn\'t place are listed apart. Takes a story id or a report id, as top_stories, search_reports and the other tools give them.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'A story id or a report id (a UUID)' },
        limit: { type: 'integer', minimum: 1, maximum: 40, default: 15, description: 'How many countries (1 to 40, default 15)' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    async run(args, asker) {
      const id = strArg(args, 'id', { required: true, pattern: UUID, hint: 'must be a story or report id (a UUID)' })!
      const limit = intArg(args, 'limit', 15, 1, 40)
      const { status, body } = await ask(asker, `/api/v1/stories/${id}`)
      if (status === 404) throw new ToolError('No story or report with that id')
      if (status !== 200) throw new Error(`story answered ${status}`)
      type Info = { site: string; name: string | null; kind: string; country: string | null; stateMedia: boolean }
      const d = (body.data ?? {}) as {
        storyId?: string; outlets?: number; outletNames?: string[]; verifiedAt?: string | null; country?: string | null
        outletInfo?: Info[]
        signals?: Array<{ id: string; title: string; outlet?: string | null; url?: string | null }>
      }
      const info: Info[] = d.outletInfo ?? siteInfo(d.outletNames ?? [])
      const reports = d.signals ?? []
      const byCountry = new Map<string, Info[]>()
      const notPlaced: string[] = []
      for (const o of info) {
        if (!o.country) { notPlaced.push(o.site); continue }
        byCountry.set(o.country, [...(byCountry.get(o.country) ?? []), o])
      }
      const own = d.country ?? null
      const order = [...byCountry.entries()].sort((a, b) =>
        Number(b[0] === own) - Number(a[0] === own) || b[1].length - a[1].length || countryLabel(a[0], false).localeCompare(countryLabel(b[0], false)))
      const countries = order.slice(0, limit).map(([code, outlets]) => {
        // one of its outlets' own reports in the story (a website whose article was merged into another report has none)
        const sites = new Set(outlets.map(o => o.site))
        const r = reports.find(x => sites.has(String(x.outlet ?? '')))
        const outlet = r?.outlet ? (outlets.find(o => o.site === r.outlet)?.name ?? outletOf(r.outlet)?.name ?? r.outlet) : null
        const headline = r ? { title: r.title, outlet, url: signalLink(r.id) } : null
        return { code, name: countryLabel(code, false), own: code === own, outlets, headline }
      })
      const first = reports[0]
      const page = signalLink(first?.id ?? id)
      // each outlet once by name: "BBC (2 websites)" for bbc.co.uk and bbc.com
      const names = (outlets: Info[]) => {
        const by = new Map<string, { sites: number; state: boolean }>()
        for (const o of outlets) {
          const e = by.get(o.name ?? o.site) ?? { sites: 0, state: false }
          by.set(o.name ?? o.site, { sites: e.sites + 1, state: e.state || o.stateMedia })
        }
        return [...by.entries()].map(([name, e]) => `${name}${e.sites > 1 ? ` (${e.sites} websites)` : ''}${e.state ? ' (state media)' : ''}`)
      }
      const more = order.length - countries.length
      const text = [
        first?.title ?? 'Story',
        `${d.verifiedAt ? 'Verified' : 'Not verified yet'} · ${d.outlets ?? info.length} outlets in its last two days, from ${byCountry.size} countr${byCountry.size === 1 ? 'y' : 'ies'}${notPlaced.length ? ` (and ${notPlaced.length} website${notPlaced.length === 1 ? '' : 's'} the outlet directory doesn't place)` : ''}. Page: ${page}`,
        '',
        ...countries.map(c => [
          `${c.name}${c.own ? ' (where the story is)' : ''}: ${c.outlets.length} outlet${c.outlets.length === 1 ? '' : 's'} · ${names(c.outlets).slice(0, 8).join(', ')}${names(c.outlets).length > 8 ? ', …' : ''}`,
          ...(c.headline ? [`   "${c.headline.title}"${c.headline.outlet ? ` (${c.headline.outlet})` : ''}`] : []),
        ].join('\n')),
        ...(more > 0 ? [`… and ${more} more countr${more === 1 ? 'y' : 'ies'} (limit takes up to 40).`] : []),
        ...(notPlaced.length ? [`Not placed: ${notPlaced.slice(0, 8).join(', ')}${notPlaced.length > 8 ? ', …' : ''}`] : []),
      ].join('\n')
      return {
        text,
        data: {
          storyId: d.storyId ?? id, url: page, verified: Boolean(d.verifiedAt), outlets: d.outlets ?? info.length, country: own, outletCountries: byCountry.size,
          countries: countries.map(c => ({
            code: c.code, name: c.name, ownCountry: c.own, outlets: c.outlets.length, outletNames: [...new Set(c.outlets.map(o => o.name ?? o.site))],
            stateMedia: c.outlets.filter(o => o.stateMedia).map(o => o.name ?? o.site), headline: c.headline,
          })),
          moreCountries: Math.max(0, more), notPlaced,
        },
      }
    },
  },
  {
    name: 'shipping',
    title: 'Ships, ports, straits and navies',
    description: 'The last 7 days\' reports about ships, ports, straits, navies, piracy and sanctions at sea, newest first, each with how many outlets carry its story, its place, how long ago and its link. Give chokepoint for those within 500 km of one (suez, panama, hormuz, malacca, bab-el-mandeb, dover, gibraltar, taiwan, good-hope, bosporus, lombok, danish-straits) and type for one kind (piracy, naval, shipping, port, sanctions).',
    inputSchema: {
      type: 'object',
      properties: {
        chokepoint: { type: 'string', enum: CHOKEPOINTS.map(c => c.id), description: 'A chokepoint, e.g. hormuz' },
        type: { type: 'string', enum: ['piracy', 'naval', 'shipping', 'port', 'sanctions'], description: 'One kind of report' },
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'How many (1 to 20, default 10)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const asked = strArg(args, 'chokepoint', { max: 40 })?.toLowerCase()
      const cp = asked ? CHOKEPOINTS.find(c => c.id === asked || c.name.toLowerCase() === asked) : undefined
      if (asked && !cp) throw new ToolError(`chokepoint must be one of ${CHOKEPOINTS.map(c => c.id).join(', ')}`)
      const type = strArg(args, 'type', { pattern: /^(piracy|naval|shipping|port|sanctions)$/, hint: 'must be piracy, naval, shipping, port or sanctions' })
      const limit = intArg(args, 'limit', 10, 1, 20)
      const near = cp ? `&near=${cp.lat},${cp.lng}&radius=500` : ''
      const { status, body } = await ask(asker, `/api/v1/maritime/signals?type=${type ?? 'all'}&limit=30${near}`)
      if (status !== 200) throw new Error(`shipping news answered ${status}`)
      type Item = { id: string; title: string; category?: string; severity?: string; location_name?: string | null; created_at?: string | null }
      const items = (((body as { data?: Item[] }).data) ?? []).filter(x => x && UUID.test(String(x.id)) && typeof x.title === 'string').slice(0, limit)
      const counts = await storyCounts(asker, items.map(x => x.id))
      const urlOf = (x: Item) => signalLink(counts[x.id]?.canonicalId ?? x.id)
      const scope = `${cp ? `, within 500 km of ${theChokepoint(cp)}` : ''}${type ? ` (${type})` : ''}`
      const text = items.length === 0
        ? `No report about ships, ports or navies in the last 7 days${scope}. Maritime page: ${SITE}/maritime`
        : [
          `Ships, ports, straits and navies, the last 7 days, newest first${scope}:`,
          ...items.map((x, i) => `${i + 1}. ${x.title}\n   ${[proofLine(counts[x.id]), x.location_name, agoLabel(x.created_at)].filter(Boolean).join(' · ')}\n   ${urlOf(x)}`),
          `Maritime page: ${SITE}/maritime${cp ? '' : ` · chokepoints: ${CHOKEPOINTS.map(c => c.id).join(', ')}`}`,
        ].join('\n')
      return {
        text,
        data: {
          chokepoint: cp ? { id: cp.id, name: cp.name, latitude: cp.lat, longitude: cp.lng, radiusKm: 500 } : null, type: type ?? 'all',
          reports: items.map(x => ({
            id: x.id, title: x.title, url: urlOf(x), place: x.location_name ?? null, at: x.created_at ?? null, category: x.category ?? null,
            storyOutlets: Number(counts[x.id]?.outlets) || 1, verified: counts[x.id]?.verified === true,
          })),
        },
      }
    },
  },
  {
    name: 'hazards',
    title: 'Earthquakes, volcanoes, tsunamis and wildfires',
    description: 'Natural hazards in the last 48 hours (1 to 168): earthquakes of magnitude 4.5 or more (USGS), US volcano alerts (USGS), tsunami messages (NOAA\'s tsunami warning centres) and large wildfires seen by satellite (NASA FIRMS), each with its place, how long ago and its link; the strongest earthquakes and the largest fires first. Give kind for one of them, latitude and longitude (and radius_km) for those near a place, min_magnitude for stronger earthquakes.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['earthquake', 'volcano', 'tsunami', 'wildfire'], description: 'Only one kind' },
        hours: { type: 'integer', minimum: 1, maximum: 168, default: 48, description: 'How many hours back (1 to 168, default 48)' },
        latitude: { type: 'number', minimum: -90, maximum: 90, description: 'With longitude: only those near this place, e.g. 35.68' },
        longitude: { type: 'number', minimum: -180, maximum: 180, description: 'With latitude, e.g. 139.69' },
        radius_km: { type: 'integer', minimum: 10, maximum: 2000, default: 500, description: 'How far from the place, in km (10 to 2000, default 500)' },
        min_magnitude: { type: 'number', minimum: 4.5, maximum: 10, description: 'Only earthquakes of at least this magnitude, e.g. 6' },
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 5, description: 'How many of each kind (1 to 20, default 5)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const kind = strArg(args, 'kind', { pattern: /^(earthquake|volcano|tsunami|wildfire)$/, hint: 'must be earthquake, volcano, tsunami or wildfire' })
      const hours = intArg(args, 'hours', 48, 1, 168)
      const limit = intArg(args, 'limit', 5, 1, 20)
      const given = (name: string) => args[name] !== undefined && args[name] !== null && args[name] !== ''
      if (given('latitude') !== given('longitude')) throw new ToolError('Give latitude and longitude together')
      const at = given('latitude') ? { lat: numArg(args, 'latitude', -90, 90), lng: numArg(args, 'longitude', -180, 180), km: intArg(args, 'radius_km', 500, 10, 2000) } : null
      const minMag = given('min_magnitude') ? numArg(args, 'min_magnitude', 4.5, 10) : null
      // the map's own question at 48 hours, so the answer is usually kept and ready
      const { status, body } = await ask(asker, `/api/v1/hazards/map/points?hours=${hours}`)
      if (status !== 200) throw new Error(`hazards answered ${status}`)
      type Point = { id: string; title: string; lat: number; lng: number; severity?: string; source_slug?: string; published_at?: string | null }
      const kmFrom = (p: Point) => (at ? distanceKm(at.lat, at.lng, p.lat, p.lng) : 0)
      const points = ((((body.data ?? {}) as { points?: Point[] }).points) ?? [])
        .filter(p => p && typeof p.title === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .filter(p => !at || kmFrom(p) <= at.km)
        .filter(p => minMag === null || p.source_slug !== 'seismic' || (magnitudeOf(p.title) ?? 0) >= minMag)
        // by its own time: the route's window is when WorldPulse stored it (a tsunami message 4 days old was in 48 hours)
        .filter(p => !(Date.parse(String(p.published_at)) < Date.now() - hours * 3_600_000))
      const time = (p: Point) => Date.parse(String(p.published_at)) || 0
      const rank = (s?: string) => ({ critical: 4, high: 3, medium: 2, low: 1 } as Record<string, number>)[s ?? ''] ?? 0
      const sections = (kind ? [kind] : Object.keys(HAZARD_KINDS)).map(k => {
        const meta = HAZARD_KINDS[k]!
        const all = points.filter(p => p.source_slug === meta.slug)
        const sorted = all.slice().sort(
          k === 'earthquake' ? (a, b) => (magnitudeOf(b.title) ?? 0) - (magnitudeOf(a.title) ?? 0) || time(b) - time(a)
            : k === 'wildfire' ? (a, b) => rank(b.severity) - rank(a.severity) || time(b) - time(a)
              : (a, b) => time(b) - time(a))
        return { kind: k, meta, total: all.length, shown: sorted.slice(0, limit) }
      })
      const where = at ? ` within ${at.km} km of ${at.lat.toFixed(2)}, ${at.lng.toFixed(2)}` : ''
      const label = (k: { one: string; many: string }, n: number) => (n === 1 ? k.one : k.many).replace('{m}', String(minMag ?? 4.5))
      const text = [
        `Natural hazards, the last ${hours} hours${where}: ${sections.map(s => `${s.total} ${label(s.meta, s.total)} (${s.meta.source})`).join(', ')}.`,
        ...sections.filter(s => s.shown.length > 0).map(s => [
          '',
          `${cap(label(s.meta, 2))}, ${s.meta.order}:`,
          ...s.shown.map((p, i) => `${i + 1}. ${p.title} · ${agoLabel(p.published_at)}${s.kind === 'wildfire' ? ` · at ${p.lat.toFixed(1)}, ${p.lng.toFixed(1)}` : ''}${at ? ` · ${Math.round(kmFrom(p))} km away` : ''}\n   ${signalLink(p.id)}`),
        ].join('\n')),
        '',
        `Map: ${SITE}/map`,
      ].join('\n')
      return {
        text,
        data: {
          hours, near: at ? { latitude: at.lat, longitude: at.lng, radiusKm: at.km } : null, minMagnitude: minMag,
          kinds: sections.map(s => ({
            kind: s.kind, source: s.meta.source, total: s.total,
            items: s.shown.map(p => ({
              id: p.id, title: p.title, url: signalLink(p.id), magnitude: s.kind === 'earthquake' ? magnitudeOf(p.title) : null, severity: p.severity ?? null,
              latitude: p.lat, longitude: p.lng, at: p.published_at ?? null, ...(at ? { km: Math.round(kmFrom(p)) } : {}),
            })),
          })),
        },
      }
    },
  },
  {
    name: 'latest',
    title: 'The latest verified reports',
    description: 'The newest verified reports, each story once: of one subject (category, e.g. conflict, climate, economy, health, technology, elections, sports) and of one country when asked, each with how long ago, its place, how many outlets carry its story, from how many countries, and its link. For the biggest stories use top_stories; for the urgent ones, breaking.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: [...LATEST_CATEGORIES], description: 'One subject, e.g. climate' },
        country: { type: 'string', description: 'A two-letter country code, e.g. KE' },
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'How many stories (1 to 20, default 10)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const category = strArg(args, 'category', { max: 30 })?.toLowerCase()
      if (category && !LATEST_CATEGORIES.includes(category)) throw new ToolError(`category must be one of ${LATEST_CATEGORIES.join(', ')}`)
      const country = strArg(args, 'country', { pattern: /^[A-Za-z]{2}$/, hint: 'must be a two-letter country code such as KE' })?.toUpperCase()
      const limit = intArg(args, 'limit', 10, 1, 20)
      const { status, body } = await ask(asker, `/api/v1/signals?status=verified&limit=50${category ? `&category=${category}` : ''}${country ? `&country=${country}` : ''}`)
      if (status !== 200) throw new Error(`signals answered ${status}`)
      type Report = { id: string; title: string; locationName?: string | null; countryCode?: string | null; category?: string; createdAt?: string | null }
      const reports = ((((body.data ?? {}) as { items?: Report[] }).items) ?? []).filter(r => r && UUID.test(String(r.id)) && typeof r.title === 'string')
      // enough to fill the list once each story is counted once (the outlet counts of 50 took 1.7 s)
      const counts = await storyCounts(asker, reports.slice(0, 30).map(r => r.id))
      // each story once, as its newest report
      const seen = new Set<string>()
      const shown: Report[] = []
      for (const r of reports.slice(0, 30)) {
        const story = counts[r.id]?.storyId ?? r.id
        if (seen.has(story)) continue
        seen.add(story)
        shown.push(r)
        if (shown.length === limit) break
      }
      const scope = `${category ? ` about ${category}` : ''}${country ? ` from ${countryLabel(country, true)}` : ''}`
      const placeOf = (r: Report) => r.locationName || (r.countryCode ? countryLabel(r.countryCode, false) : '')
      const urlOf = (r: Report) => signalLink(counts[r.id]?.canonicalId ?? r.id)
      const text = shown.length === 0
        ? `No verified report${scope} lately. ${SITE}`
        : [
          `The latest verified reports${scope}, newest first, each story once:`,
          ...shown.map((r, i) => `${i + 1}. ${r.title}\n   ${[agoLabel(r.createdAt), placeOf(r), proofLine(counts[r.id])].filter(Boolean).join(' · ')}\n   ${urlOf(r)}`),
        ].join('\n')
      return {
        text,
        data: {
          category: category ?? null, country: country ?? null,
          reports: shown.map(r => ({
            id: r.id, title: r.title, url: urlOf(r), at: r.createdAt ?? null, place: placeOf(r) || null, category: r.category ?? null,
            storyOutlets: Number(counts[r.id]?.outlets) || 1, verified: counts[r.id]?.verified === true, outletCountries: Number(counts[r.id]?.countries) || 0,
          })),
        },
      }
    },
  },
  {
    name: 'how_verified',
    title: 'How a story was checked',
    description: 'How WorldPulse checked a story: whether it is verified (independent outlets report it) and how many outlets in how many countries, then each check WorldPulse ran on it, newest first: an AI model comparing what the outlets report, its result (they agree, or they differ, and how) and when. Takes a story id or a report id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'A story id or a report id (a UUID)' } },
      required: ['id'],
      additionalProperties: false,
    },
    async run(args, asker) {
      const id = strArg(args, 'id', { required: true, pattern: UUID, hint: 'must be a story or report id (a UUID)' })!
      const counts = await storyCounts(asker, [id])
      const c = counts[id]
      if (!c) throw new ToolError('No story or report with that id')
      type Check = { verifierType?: string; checkType?: string; result?: string | null; confidence?: number | null; notes?: string | null; createdAt?: string }
      const checksOf = async (rid: string): Promise<Check[]> => {
        const r = await ask(asker, `/api/v1/signals/${rid}/verifications?limit=20`)
        return r.status === 200 ? ((((r.body.data ?? {}) as { items?: Check[] }).items) ?? []) : []
      }
      // the checks sit on the report they were run for: this one, else the story's page
      let checks = await checksOf(id)
      const page = c.canonicalId && UUID.test(c.canonicalId) ? c.canonicalId : id
      if (checks.length === 0 && page !== id) checks = await checksOf(page)
      const said = (k: Check) => {
        const note = String(k.notes ?? '').replace(/^\[[^\]]+\]\s*/, '').trim()
        const verdict = k.result === 'confirmed' ? 'the outlets agree' : k.result === 'warning' ? 'the outlets differ' : k.result === 'rejected' ? 'the reports don\'t match' : (k.result ?? 'checked')
        const who = (k.checkType ?? k.verifierType) === 'cross_check' ? 'An AI model compared the outlets\' reports' : `Check: ${k.checkType ?? k.verifierType ?? 'unknown'}`
        return `${who} (${k.createdAt ? `${k.createdAt.slice(0, 16).replace('T', ' ')} UTC` : 'undated'}): ${verdict}${k.confidence != null ? ` (confidence ${k.confidence})` : ''}.${note ? ` "${note}"` : ''}`
      }
      const text = [
        `${proofLine(c)}. Page: ${signalLink(page)}`,
        'Verified means independent outlets report the story: https://world-pulse.io/how-we-count',
        ...(checks.length
          ? ['', `The checks WorldPulse ran on it, newest first (${checks.length}):`, ...checks.slice(0, 8).map((k, i) => `${i + 1}. ${said(k)}`)]
          : ['', 'No check recorded on it yet: its count of outlets is the whole of its proof so far.']),
      ].join('\n')
      return {
        text,
        data: {
          storyId: c.storyId ?? null, url: signalLink(page), verified: c.verified === true, outlets: Number(c.outlets) || 1, outletCountries: Number(c.countries) || 0,
          firstReportAt: c.firstReportAt ?? null,
          checks: checks.slice(0, 8).map(k => ({
            kind: (k.checkType ?? k.verifierType) === 'cross_check' ? 'outlets compared by an AI model' : (k.checkType ?? k.verifierType ?? null),
            result: k.result ?? null, confidence: k.confidence ?? null, note: String(k.notes ?? '').replace(/^\[[^\]]+\]\s*/, '').trim() || null, at: k.createdAt ?? null,
          })),
        },
      }
    },
  },
  {
    name: 'story_timeline',
    title: 'How a story spread',
    description: 'How a story spread: who reported it first and when, the next outlets in order with how many minutes after the first, when it became verified and how long that took, and how many outlets and reports it has had since. Takes a story id or a report id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'A story id or a report id (a UUID)' } },
      required: ['id'],
      additionalProperties: false,
    },
    async run(args, asker) {
      const id = strArg(args, 'id', { required: true, pattern: UUID, hint: 'must be a story or report id (a UUID)' })!
      const { status, body } = await ask(asker, `/api/v1/stories/${id}`)
      if (status === 404) throw new ToolError('No story or report with that id')
      if (status !== 200) throw new Error(`story answered ${status}`)
      const d = (body.data ?? {}) as {
        storyId?: string; size?: number; outletsAll?: number; outlets?: number; firstReportAt?: string | null; latestReportAt?: string | null; verifiedAt?: string | null
        signals?: Array<{ id: string; title: string; outlet?: string | null; createdAt?: string | null }>
      }
      const reports = (d.signals ?? []).filter(r => r && typeof r.title === 'string')
        .slice().sort((a, b) => (Date.parse(String(a.createdAt)) || 0) - (Date.parse(String(b.createdAt)) || 0))
      const first = reports[0]
      const t0 = Date.parse(String(d.firstReportAt ?? first?.createdAt)) || null
      const after = (at?: string | null) => {
        const t = Date.parse(String(at))
        if (!t0 || !Number.isFinite(t)) return ''
        const m = Math.max(0, Math.round((t - t0) / 60_000))
        return m < 120 ? `${m} min` : m < 2_880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1_440)} days`
      }
      const utc = (at?: string | null) => (at ? `${at.slice(0, 16).replace('T', ' ')} UTC` : 'an unknown time')
      // the first report of each outlet, in order (the story's first ten reports are always among those given)
      const seenOutlets = new Set<string>()
      const firsts = reports.filter(r => {
        const o = String(r.outlet ?? '')
        if (!o || seenOutlets.has(o)) return false
        seenOutlets.add(o)
        return true
      }).slice(0, 10)
      const nameOf = (site?: string | null) => (site ? (outletOf(site)?.name ?? site) : 'an unknown outlet')
      const toVerified = d.verifiedAt ? after(d.verifiedAt) : ''
      const text = [
        first ? `First reported ${utc(d.firstReportAt ?? first.createdAt)} by ${nameOf(first.outlet)}: "${first.title}"` : 'Story',
        d.verifiedAt ? `Verified ${utc(d.verifiedAt)}${toVerified ? `, ${toVerified} after the first report` : ''}.` : 'Not verified yet: no second independent outlet so far.',
        `Since: ${d.outletsAll ?? d.outlets ?? firsts.length} outlets in all, ${d.size ?? reports.length} reports${d.latestReportAt ? `, the latest ${agoLabel(d.latestReportAt)}` : ''}. Page: ${signalLink(first?.id ?? id)}`,
        '',
        'The first outlets, in order:',
        ...firsts.map((r, i) => `${i + 1}. ${nameOf(r.outlet)}${i === 0 ? ' (first)' : ` (+${after(r.createdAt) || '?'})`}: "${r.title}"`),
      ].join('\n')
      return {
        text,
        data: {
          storyId: d.storyId ?? id, url: signalLink(first?.id ?? id), firstReportAt: d.firstReportAt ?? first?.createdAt ?? null, verifiedAt: d.verifiedAt ?? null,
          minutesToVerified: d.verifiedAt && t0 ? Math.max(0, Math.round(((Date.parse(d.verifiedAt) || t0) - t0) / 60_000)) : null,
          outletsAll: d.outletsAll ?? d.outlets ?? null, reports: d.size ?? reports.length, latestReportAt: d.latestReportAt ?? null,
          firstOutlets: firsts.map(r => ({ outlet: nameOf(r.outlet), site: r.outlet ?? null, at: r.createdAt ?? null, title: r.title, reportId: r.id })),
        },
      }
    },
  },
  {
    name: 'conflicts',
    title: 'Where fighting is reported',
    description: 'Where conflict and military news is reported in the last 72 hours: the places with the most conflict and military reports, each with its count, its worst severity, its newest headline and link. These count reports, not attacks: a place in the news a lot is not always where the most fighting is.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'How many places (1 to 20, default 10)' } },
      additionalProperties: false,
    },
    async run(args, asker) {
      const limit = intArg(args, 'limit', 10, 1, 20)
      // the map's conflict layer, so the answer is usually kept and ready
      const { status, body } = await ask(asker, `/api/v1/signals/map/conflict-zones`)
      if (status !== 200) throw new Error(`conflict reports answered ${status}`)
      type Feature = { properties?: { id?: string; title?: string; severity?: string; source_name?: string | null; published_at?: string | null } }
      const features = (((body as { features?: Feature[] }).features) ?? []).filter(f => f?.properties && typeof f.properties.title === 'string')
      const rank = (s?: string) => ({ critical: 4, high: 3, medium: 2, low: 1 } as Record<string, number>)[s ?? ''] ?? 0
      type Place = { name: string; reports: number; worst: string; newest: { title: string; id: string | null; at: string | null } }
      const places = new Map<string, Place>()
      for (const f of features) {
        const p = f.properties!
        const name = String(p.source_name ?? '').trim()
        if (!name) continue
        const e = places.get(name) ?? { name, reports: 0, worst: 'low', newest: { title: '', id: null, at: null } }
        e.reports++
        if (rank(p.severity) > rank(e.worst)) e.worst = p.severity!
        // its newest headline, a news report's rather than an opinion piece's ("The Unavoidable War – OpEd")
        const opinion = notBreakingNews(p.title!) === 'opinion'
        const wasOpinion = Boolean(e.newest.at) && notBreakingNews(e.newest.title) === 'opinion'
        const newer = !e.newest.at || (Date.parse(String(p.published_at)) || 0) > (Date.parse(e.newest.at) || 0)
        if (!e.newest.at || (wasOpinion && !opinion) || (opinion === wasOpinion && newer)) {
          e.newest = { title: p.title!, id: UUID.test(String(p.id)) ? p.id! : null, at: p.published_at ?? null }
        }
        places.set(name, e)
      }
      const top = [...places.values()].sort((a, b) => b.reports - a.reports || rank(b.worst) - rank(a.worst)).slice(0, limit)
      const text = top.length === 0
        ? `No conflict or military report placed in the last 72 hours. Map: ${SITE}/map`
        : [
          `Where conflict and military news is reported, the last 72 hours (${features.length >= 1_500 ? 'the newest 1,500 reports' : `${features.length} reports`} in ${places.size} places), the most reports first:`,
          ...top.map((p, i) => `${i + 1}. ${p.name}: ${p.reports} report${p.reports === 1 ? '' : 's'}, worst ${p.worst}\n   Newest: "${p.newest.title}"${p.newest.at ? ` (${agoLabel(p.newest.at)})` : ''}${p.newest.id ? ` ${signalLink(p.newest.id)}` : ''}`),
          'These count reports, not attacks. The map: ' + `${SITE}/map`,
        ].join('\n')
      return { text, data: { hours: 72, reports: features.length, places: top.map(p => ({ place: p.name, reports: p.reports, worstSeverity: p.worst, newest: { ...p.newest, url: p.newest.id ? signalLink(p.newest.id) : null } })) } }
    },
  },
  {
    name: 'internet_outages',
    title: 'Internet outages',
    description: 'Internet outages WorldPulse reports from IODA (Georgia Tech\'s Internet Outage Detection and Analysis: routing, active probing and network telescope signals), newest first, for the last 1 to 168 hours (default 72) and one country when asked: each with its country, how long ago, what IODA saw and its link.',
    inputSchema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: 'A two-letter country code, e.g. IR' },
        hours: { type: 'integer', minimum: 1, maximum: 168, default: 72, description: 'How many hours back (1 to 168, default 72)' },
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'How many (1 to 20, default 10)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const country = strArg(args, 'country', { pattern: /^[A-Za-z]{2}$/, hint: 'must be a two-letter country code such as IR' })?.toUpperCase()
      const hours = intArg(args, 'hours', 72, 1, 168)
      const limit = intArg(args, 'limit', 10, 1, 20)
      const { status, body } = await ask(asker, `/api/v1/outages/recent?hours=${hours}&limit=100`)
      if (status !== 200) throw new Error(`outages answered ${status}`)
      type Outage = { id: string; title: string; summary?: string | null; severity?: string; country_code?: string | null; location_name?: string | null; published_at?: string | null }
      const all = ((((body.data ?? {}) as { events?: Outage[] }).events) ?? []).filter(o => o && typeof o.title === 'string')
      const events = all.filter(o => !country || String(o.country_code ?? '').toUpperCase() === country).slice(0, limit)
      const where = (o: Outage) => o.location_name || (o.country_code ? countryLabel(o.country_code, false) : '')
      const firstSentence = (s?: string | null) => String(s ?? '').split(/(?<=[.!?])\s/)[0]!.slice(0, 220)
      const scope = `${country ? ` in ${countryLabel(country, true)}` : ''} in the last ${hours} hours`
      const text = events.length === 0
        ? `No internet outage reported${scope} (IODA: routing, probing and telescope signals).${country ? '' : ` ${SITE}/map`}`
        : [
          `Internet outages${scope}, newest first (from IODA, Georgia Tech):`,
          ...events.map((o, i) => `${i + 1}. ${o.title}\n   ${[cap(o.severity), where(o), agoLabel(o.published_at)].filter(Boolean).join(' · ')}${o.summary ? `\n   ${firstSentence(o.summary)}` : ''}\n   ${signalLink(o.id)}`),
        ].join('\n')
      return {
        text,
        data: {
          hours, country: country ?? null,
          outages: events.map(o => ({ id: o.id, title: o.title, url: signalLink(o.id), severity: o.severity ?? null, country: o.country_code ?? null, place: where(o) || null, at: o.published_at ?? null, summary: o.summary ?? null })),
        },
      }
    },
  },
  // ── Nov 9, 2026 (Devon: "Build the 5 let's get up to 30") ──
  {
    name: 'connections',
    title: 'Who and what is in the news together',
    description: 'Who and what a person, organisation or place is named with in WorldPulse\'s reports, the most reports together first (e.g. name "Hamas"); or, with with (e.g. name "Hamas", with "Israel"), the stories and the newest reports naming both, each story with how many outlets carry it and its link. Both look at the newest 100 reports naming each, of the last 30 days. Named together means in the same reports: it is not a tie between them.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 120, description: 'A person, organisation or place, e.g. Hamas' },
        with: { type: 'string', minLength: 2, maxLength: 120, description: 'Another one, for the stories naming both, e.g. Qatar' },
        limit: { type: 'integer', minimum: 1, maximum: 12, default: 10, description: 'How many it is named with (1 to 12, default 10)' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    async run(args, asker) {
      const name = strArg(args, 'name', { required: true, max: 120 })!
      const other = strArg(args, 'with', { max: 120 })
      if (name.length < 2 || (other !== undefined && other.length < 2)) throw new ToolError('Names must be at least 2 characters')
      const limit = intArg(args, 'limit', 10, 1, 12)
      const found = await findEntity(asker, name)
      if (!found.entity) throw new ToolError(`No person, organisation or place named "${name}" in WorldPulse's reports`)
      const a = found.entity
      if (other === undefined) {
        const { status, body } = await ask(asker, `/api/v1/knowledge-graph/entities/${encodeURIComponent(a.id)}/profile`)
        if (status !== 200) throw new Error(`entity profile answered ${status}`)
        const p = (body.data ?? {}) as { entity?: { name?: string }; connections?: Array<{ id: string; type: string; name: string; shared: number }> }
        const aName = p.entity?.name ?? a.canonical_name
        const connections = (p.connections ?? []).filter(c => c && typeof c.name === 'string').slice(0, limit)
        const text = connections.length === 0
          ? `Nothing is named in the same reports as ${aName} in the last 30 days. Page: ${entityPage(a.id, aName)}`
          : [
            `Who and what ${aName} (${a.type}) is named with in WorldPulse's reports, the last 30 days (its newest 100 reports), the most reports together first:`,
            ...connections.map((c, i) => `${i + 1}. ${c.name} (${c.type}): ${c.shared} report${c.shared === 1 ? '' : 's'} together · ${entityPage(c.id, c.name)}`),
            `Named together means in the same reports, not a tie between them. For the stories naming both, ask again with with. Page: ${entityPage(a.id, aName)}`,
          ].join('\n')
        return {
          text,
          data: {
            entity: { id: a.id, type: a.type, name: aName, url: entityPage(a.id, aName) },
            namedWith: connections.map(c => ({ id: c.id, type: c.type, name: c.name, reportsTogether: c.shared, url: entityPage(c.id, c.name) })),
            otherMatches: found.others.map(o => ({ id: o.id, type: o.type, name: o.canonical_name })),
          },
        }
      }
      const foundB = await findEntity(asker, other)
      if (!foundB.entity) throw new ToolError(`No person, organisation or place named "${other}" in WorldPulse's reports`)
      const b = foundB.entity
      if (b.id === a.id) throw new ToolError(`"${name}" and "${other}" are both ${a.canonical_name}: give two different names`)
      const { status, body } = await ask(asker, `/api/v1/knowledge-graph/entities/${encodeURIComponent(a.id)}/with/${encodeURIComponent(b.id)}`)
      if (status === 404) throw new ToolError(`WorldPulse can't open ${a.canonical_name} and ${b.canonical_name} together just now`)
      if (status !== 200) throw new Error(`shared stories answered ${status}`)
      const d = (body.data ?? {}) as { stories?: ListedStory[]; latest?: Array<{ id: string; title: string; place?: string | null; verified?: boolean; createdAt?: string }> }
      const stories = (d.stories ?? []).filter(s => s && typeof s.title === 'string').slice(0, 8)
      const latest = (d.latest ?? []).filter(r => r && typeof r.title === 'string' && UUID.test(String(r.id))).slice(0, 8)
      const both = `${a.canonical_name} and ${b.canonical_name}`
      const pages = `Pages: ${entityPage(a.id, a.canonical_name)} · ${entityPage(b.id, b.canonical_name)}`
      const text = stories.length === 0 && latest.length === 0
        ? `None of the newest reports naming either (WorldPulse looks at the newest 100 naming each, of the last 30 days) names both ${both}. ${pages}`
        : [
          `${both} in the same reports (of the newest 100 naming each, the last 30 days):`,
          stories.length ? `Stories naming both, the most outlets first:\n${stories.map(storyLine).join('\n')}` : 'No story naming both was reported by two or more outlets.',
          latest.length ? `\nThe newest other reports naming both:\n${latest.map((r, i) => `${i + 1}. ${r.title}\n   ${[r.verified ? 'Verified' : 'Not verified yet', r.place, agoLabel(r.createdAt)].filter(Boolean).join(' · ')}\n   ${signalLink(r.id)}`).join('\n')}` : '',
          `\n${pages}`,
        ].join('\n').trim()
      return {
        text,
        data: {
          entities: [a, b].map(e => ({ id: e.id, type: e.type, name: e.canonical_name, url: entityPage(e.id, e.canonical_name) })),
          stories: stories.map(storyOut),
          latest: latest.map(r => ({ id: r.id, title: r.title, url: signalLink(r.id), place: r.place ?? null, verified: Boolean(r.verified), at: r.createdAt ?? null })),
        },
      }
    },
  },
  {
    name: 'protests',
    ...topicTool('protests', 'Protests, strikes, riots and unrest on WorldPulse\'s map in the last 48 hours, place by place: the places with the most reports first, each with its worst severity and its newest headline, with how many outlets carry that story and its link. place narrows it to reports naming a place (e.g. "Kenya"). Found by words in the headline (English, French, Spanish, Portuguese): these count reports, not protests.'),
  },
  {
    name: 'outbreaks',
    ...topicTool('outbreaks', 'Disease outbreaks on WorldPulse\'s map in the last 72 hours (cholera, measles, mpox, Ebola, bird flu, dengue and others), place by place: the places with the most reports first, each with its worst severity and its newest headline, with how many outlets carry that story and its link. place narrows it to reports naming a place (e.g. "Sudan"). Found by words in the headline (English, French, Spanish, Portuguese): these count reports, not cases.'),
  },
  {
    name: 'displacement',
    ...topicTool('displacement', 'Refugees, people displaced and asylum seekers on WorldPulse\'s map in the last 72 hours, place by place: the places with the most reports first, each with its worst severity and its newest headline, with how many outlets carry that story and its link. place narrows it to reports naming a place (e.g. "Gaza"). Found by words in the headline (English, French, Spanish, Portuguese): these count reports, not people. For the crises with the fewest outlets for the people displaced, use under_reported.'),
  },
  {
    name: 'who_covers',
    title: 'The newsrooms WorldPulse reads in a country',
    description: 'The newsrooms based in a country whose feeds WorldPulse reads (e.g. GL for Greenland): each with its website, its kind (national, local, news agency, official source…), its language and whether a government runs it (state media), and the well-known outlets from there it only sees in GDELT\'s articles. A place with three or fewer is thinly covered: its own stories rest on few voices, and outlets from abroad report on it too. For what is reported there, use country.',
    inputSchema: {
      type: 'object',
      properties: { country: { type: 'string', pattern: '^[A-Za-z]{2}$', description: 'A two-letter country code, e.g. GL' } },
      required: ['country'],
      additionalProperties: false,
    },
    async run(args) {
      const given = strArg(args, 'country', { required: true, pattern: /^[A-Za-z]{2}$/, hint: 'must be a two-letter country code such as GL' })!.toUpperCase()
      const code = given === 'UK' ? 'GB' : given
      const label = countryLabel(code, false)
      if (label === code) throw new ToolError(`${code} is not a country code WorldPulse knows`)
      // one entry per outlet: its websites together (abcnews.com and abcnews.go.com are ABC News)
      type Newsroom = { name: string; kind: string; state: boolean; lang: string | null; sites: string[]; seen: boolean }
      const byName = new Map<string, Newsroom>()
      for (const [site, e] of Object.entries(OUTLET_DIRECTORY)) {
        if (e.country !== code) continue
        const n = byName.get(e.name) ?? { name: e.name, kind: e.kind, state: Boolean(e.state), lang: e.lang ?? null, sites: [], seen: Boolean(e.seen) }
        n.sites.push(site)
        if (!e.seen) n.seen = false
        n.lang = n.lang ?? e.lang ?? null
        byName.set(e.name, n)
      }
      const order = (x: Newsroom, y: Newsroom) => x.name.localeCompare(y.name, 'en')
      const read = [...byName.values()].filter(n => !n.seen).sort(order)
      const seen = [...byName.values()].filter(n => n.seen).sort(order)
      const page = `${SITE}/countries/${code.toLowerCase()}`
      const thin = read.length <= 3
      const line = (n: Newsroom, i: number) => `${i + 1}. ${n.name} (${n.sites.join(', ')}): ${String(OUTLET_KIND_LABELS[n.kind as keyof typeof OUTLET_KIND_LABELS] ?? n.kind).toLowerCase()}${n.lang ? `, in ${languageLabel(n.lang)}` : ''}${n.state ? ', state media (a government runs it)' : ''}`
      const text = [
        read.length === 0
          ? `WorldPulse reads no newsroom based in ${countryLabel(code)}: what it knows of it comes from outlets elsewhere.`
          : `WorldPulse reads ${read.length} newsroom${read.length === 1 ? '' : 's'} based in ${countryLabel(code)}:`,
        ...read.map(line),
        seen.length ? `\nAlso from ${countryLabel(code)}, seen only in GDELT's articles: ${seen.map(n => `${n.name} (${n.sites.join(', ')})`).join('; ')}` : '',
        thin && read.length > 0 ? `\nThinly covered: ${read.length === 1 ? 'one newsroom' : `${read.length} newsrooms`} of its own, so its own stories rest on few voices; outlets from abroad report on it too.` : '',
        `\nWhat is reported there: ${page}. What the kinds mean: ${SITE}/how-we-count#kinds`,
      ].join('\n').replace(/\n{3,}/g, '\n\n').trim()
      const out = (n: Newsroom) => ({ name: n.name, sites: n.sites, kind: n.kind, language: n.lang, languageName: n.lang ? languageLabel(n.lang) : null, stateMedia: n.state })
      return { text, data: { country: code, name: label, url: page, newsrooms: read.map(out), seenInGdelt: seen.map(out), thin } }
    },
  },
  // ─── The five tools of Nov 10, 2026 (Devon: "30 ai tools! Nice! - can we get to 35?") ───
  {
    name: 'day',
    title: 'One day\'s top stories',
    description: 'One day\'s top stories (a UTC day, from the last 30 days), ranked by independent outlets as WorldPulse ranks a week: that day\'s own reports counted, each event once. Without date, yesterday; for today so far, use top_stories with hours 24. Each story with how many outlets carried it that day, from how many countries, whether it is verified, and its link.',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'A day (UTC), e.g. 2026-11-03; yesterday when left out' } },
      additionalProperties: false,
    },
    async run(args, asker) {
      const date = strArg(args, 'date', { pattern: /^\d{4}-\d{2}-\d{2}$/, hint: 'must be a day such as 2026-11-03' })
      const askDay = () => ask(asker, `/api/v1/stories/day${date ? `?date=${date}` : ''}`)
      let res = await askDay()
      // a day nobody had asked for is made in the background, in seconds: wait for it a little
      for (let i = 0; res.status === 503 && i < DAY_WAIT.tries; i++) {
        await new Promise(resolve => setTimeout(resolve, DAY_WAIT.ms))
        res = await askDay()
      }
      const { status, body } = res
      if (status === 400 || status === 404) throw new ToolError(String((body as { error?: unknown }).error ?? 'No such day'))
      if (status === 503) throw new ToolError('That day is still being put together; ask again in a minute')
      if (status !== 200) throw new Error(`day answered ${status}`)
      const d = (body.data ?? {}) as { date?: string; stories?: ListedStory[] }
      const day = typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : date ?? null
      const label = day
        ? new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
        : 'That day'
      const stories = d.stories ?? []
      const text = [
        `${label} (UTC): the top stories by independent outlets, each with the outlets that carried it that day (WorldPulse; how outlets are counted: ${SITE}/how-we-count)`,
        '',
        stories.length ? stories.map(storyLine).join('\n') : 'No story was reported by two or more outlets that day.',
      ].join('\n').trim()
      return { text, data: { date: day, stories: stories.map(storyOut) } }
    },
  },
  {
    name: 'unconfirmed',
    title: 'Reports waiting for a second outlet',
    description: 'The newest serious reports no second outlet has confirmed yet: early leads, not facts, newest first, each story once, each with its severity, how long ago, its place, its outlet and its link. WorldPulse marks a story verified once separate outlets report it. High and critical severity by default; severity "medium" adds the medium ones. Give category or country to narrow it. The answer also says how many reports are waiting: every 15 minutes WorldPulse looks for a second outlet in GDELT\'s index of news articles (newly_verified lists the ones it found).',
    inputSchema: {
      type: 'object',
      properties: {
        severity: { type: 'string', enum: ['high', 'medium'], default: 'high', description: 'high: high and critical (the default); medium: medium and up' },
        category: { type: 'string', enum: [...LATEST_CATEGORIES], description: 'One subject, e.g. conflict' },
        country: { type: 'string', pattern: '^[A-Za-z]{2}$', description: 'A two-letter country code, e.g. KE' },
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'How many reports (1 to 20, default 10)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const severity = strArg(args, 'severity', { max: 10 })?.toLowerCase() ?? 'high'
      if (severity !== 'high' && severity !== 'medium') throw new ToolError('severity must be high or medium')
      const category = strArg(args, 'category', { max: 30 })?.toLowerCase()
      if (category && !LATEST_CATEGORIES.includes(category)) throw new ToolError(`category must be one of ${LATEST_CATEGORIES.join(', ')}`)
      const country = strArg(args, 'country', { pattern: /^[A-Za-z]{2}$/, hint: 'must be a two-letter country code such as KE' })?.toUpperCase()
      const limit = intArg(args, 'limit', 10, 1, 20)
      const levels = severity === 'medium' ? ['critical', 'high', 'medium'] : ['critical', 'high']
      const scope = `${category ? `&category=${category}` : ''}${country ? `&country=${country}` : ''}`
      const [lists, second] = await Promise.all([
        Promise.all(levels.map(level => ask(asker, `/api/v1/signals?status=pending&severity=${level}&limit=30${scope}`))),
        ask(asker, `/api/v1/public/second-outlets`).catch(() => null),
      ])
      const failed = lists.find(l => l.status !== 200)
      if (failed) throw new Error(`signals answered ${failed.status}`)
      type Report = { id: string; title: string; severity?: string; locationName?: string | null; countryCode?: string | null; category?: string; createdAt?: string | null; originalUrls?: unknown }
      const reports = lists
        .flatMap(l => ((((l.body.data ?? {}) as { items?: Report[] }).items) ?? []))
        .filter(r => r && UUID.test(String(r.id)) && typeof r.title === 'string')
        .sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0))
        .slice(0, 60)
      const counts = await storyCounts(asker, reports.map(r => r.id))
      // each story once, and none a second outlet has verified since
      const seen = new Set<string>()
      const shown: Report[] = []
      for (const r of reports) {
        const c = counts[r.id]
        if (c?.verified) continue
        const story = c?.storyId ?? r.id
        if (seen.has(story)) continue
        seen.add(story)
        shown.push(r)
        if (shown.length === limit) break
      }
      const placeOf = (r: Report) => r.locationName || (r.countryCode ? countryLabel(r.countryCode, false) : '')
      const outletOfReport = (r: Report) => (Array.isArray(r.originalUrls) && typeof r.originalUrls[0] === 'string' ? hostOf(r.originalUrls[0]) : '')
      const days = ((second?.status === 200 ? (second.body.data as { days?: Record<string, Record<string, unknown>> } | undefined)?.days : null) ?? {})
      const today = days[new Date().toISOString().slice(0, 10)]
      const waiting = today && typeof today.waiting === 'number'
        ? { reports: today.waiting, foundToday: Number(today.matched) || 0, verifiedToday: Number(today.promoted) || 0 }
        : null
      const what = `${severity === 'medium' ? 'medium, high and critical' : 'high and critical'}${category ? ` ${category}` : ''} reports`
      const where = country ? ` from ${countryLabel(country, true)}` : ''
      const text = [
        shown.length
          ? `The newest unconfirmed ${what}${where}, newest first: leads to check, not facts (WorldPulse):`
          : `No unconfirmed ${what}${where} lately: the newest are verified, or none came in. ${SITE}`,
        ...shown.map((r, i) => {
          const site = outletOfReport(r)
          return `${i + 1}. ${r.title}\n   ${[cap(r.severity), agoLabel(r.createdAt), placeOf(r), site ? `via ${describeSite(site)}` : '', proofLine(counts[r.id])].filter(Boolean).join(' · ')}\n   ${signalLink(r.id)}`
        }),
        waiting
          ? `\nEvery 15 minutes WorldPulse looks for a second outlet for each medium-or-higher English report with one outlet, in GDELT's index of news articles: ${waiting.reports.toLocaleString('en-US')} are waiting now; today ${waiting.foundToday.toLocaleString('en-US')} found one and ${waiting.verifiedToday.toLocaleString('en-US')} turned verified (newly_verified lists them).`
          : '',
      ].join('\n').replace(/\n{3,}/g, '\n\n').trim()
      return {
        text,
        data: {
          severity, category: category ?? null, country: country ?? null,
          reports: shown.map(r => ({
            id: r.id, title: r.title, url: signalLink(r.id), severity: r.severity ?? null, at: r.createdAt ?? null, place: placeOf(r) || null,
            outlet: outletOfReport(r) || null, storyOutlets: Number(counts[r.id]?.outlets) || 1,
          })),
          waiting,
        },
      }
    },
  },
  {
    name: 'newly_verified',
    title: 'Just verified',
    description: 'The reports that most recently turned verified because WorldPulse found a second, separate outlet reporting the same event in GDELT\'s index of news articles (it looks every 15 minutes), newest first: each with the outlets and headlines that confirmed it, and its link. Verification as it happens; for the newest verified reports of a subject, use latest; for the ones still waiting, unconfirmed.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'How many reports (1 to 20, default 10)' } },
      additionalProperties: false,
    },
    async run(args, asker) {
      const limit = intArg(args, 'limit', 10, 1, 20)
      const { status, body } = await ask(asker, `/api/v1/public/second-outlets`)
      if (status !== 200) throw new Error(`second-outlets answered ${status}`)
      type Found = { site?: unknown; title?: unknown; url?: unknown }
      type Match = { at?: string; id?: string; severity?: string; title?: string; promoted?: boolean; found?: Found[] }
      const d = (body.data ?? {}) as { days?: Record<string, Record<string, unknown>>; latest?: Match[] }
      // each report once (a report can find more outlets in a later look), and only those that turned verified
      const seen = new Set<string>()
      const shown = (d.latest ?? [])
        .filter((m): m is Match & { id: string; title: string } => Boolean(m) && m.promoted === true && UUID.test(String(m.id)) && typeof m.title === 'string')
        .filter(m => !seen.has(m.id) && Boolean(seen.add(m.id)))
        .slice(0, limit)
      const confirmedBy = (m: Match) => (Array.isArray(m.found) ? m.found : [])
        .filter(f => f && typeof f.site === 'string' && f.site !== '')
        .map(f => ({ site: String(f.site), title: typeof f.title === 'string' ? f.title : null, url: typeof f.url === 'string' ? f.url : null }))
      const today = (d.days ?? {})[new Date().toISOString().slice(0, 10)]
      const text = [
        shown.length
          ? 'Just verified: reports that turned verified when WorldPulse found a second, separate outlet reporting the same event, newest first:'
          : 'No report has turned verified this way lately.',
        ...shown.map((m, i) => {
          const by = confirmedBy(m).map(f => `${describeSite(f.site)}${f.title ? `: "${f.title}"` : ''}`)
          return `${i + 1}. ${m.title}\n   ${[cap(m.severity), agoLabel(m.at)].filter(Boolean).join(' · ')}${by.length ? ` · confirmed by ${by.join('; ')}` : ''}\n   ${signalLink(m.id)}`
        }),
        today
          ? `\nToday so far (UTC): ${(Number(today.matched) || 0).toLocaleString('en-US')} reports found a second outlet and ${(Number(today.promoted) || 0).toLocaleString('en-US')} turned verified; ${(Number(today.waiting) || 0).toLocaleString('en-US')} are waiting (unconfirmed lists the newest). How WorldPulse counts: ${SITE}/how-we-count`
          : '',
      ].join('\n').replace(/\n{3,}/g, '\n\n').trim()
      return {
        text,
        data: {
          reports: shown.map(m => ({ id: m.id, title: m.title, url: signalLink(m.id), severity: m.severity ?? null, at: m.at ?? null, confirmedBy: confirmedBy(m) })),
          today: today ? { found: Number(today.matched) || 0, verified: Number(today.promoted) || 0, waiting: Number(today.waiting) || 0 } : null,
        },
      }
    },
  },
  {
    name: 'local_press',
    title: 'Covered abroad, quiet at home',
    description: 'How much of a story\'s coverage comes from newsrooms of the country where it happens. Without country: the top stories of the last 24 hours that outlets from 10 or more countries carry while one or none of the outlets matched to them is based in the story\'s own country, the fewest first. With country (e.g. SN): that country\'s top stories, each with how many of its outlets are based there. Counts cover the outlets WorldPulse matched to each story and knows the home country of; reports in the local language can sit in a story of their own, so a low count is a lead to check, not proof that the local press is silent.',
    inputSchema: {
      type: 'object',
      properties: {
        country: { type: 'string', pattern: '^[A-Za-z]{2}$', description: 'Optional two-letter country code, e.g. SN' },
        hours: { type: 'integer', minimum: 1, maximum: 72, default: 24, description: 'How many hours back (1 to 72, default 24)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const hours = intArg(args, 'hours', 24, 1, 72)
      const given = strArg(args, 'country', { pattern: /^[A-Za-z]{2}$/, hint: 'must be a two-letter country code such as SN' })?.toUpperCase()
      const country = given === 'UK' ? 'GB' : given
      const { status, body } = await ask(asker, `/api/v1/stories?hours=${hours}&limit=20${country ? `&country=${country}` : ''}`)
      if (status !== 200) throw new Error(`stories answered ${status}`)
      const listed = ((body.data as { stories?: ListedStory[] } | undefined)?.stories ?? []).filter(s => s && typeof s.country === 'string' && s.country !== '')
      const home = (s: ListedStory) => s.localOutlets ?? 0
      const rows = country
        ? listed.filter(s => s.country === country)
        : listed.filter(s => home(s) <= 1 && (s.countries ?? 0) >= 10).sort((a, b) => home(a) - home(b) || (b.countries ?? 0) - (a.countries ?? 0))
      const homeNote = (s: ListedStory) => home(s)
        ? `${home(s)} from ${countryLabel(String(s.country))}${s.localNames?.length ? ` (${s.localNames.join(', ')})` : ''}`
        : `none of them from ${countryLabel(String(s.country))}`
      const line = (s: ListedStory, i: number) =>
        `${i + 1}. ${s.title}\n   ${s.outletCount} outlets${(s.countries ?? 0) > 1 ? ` from ${s.countries} countries` : ''} · ${homeNote(s)}${s.verifiedAt ? '' : ' · not verified yet'}\n   ${signalLink(s.leadId)}`
      const head = country
        ? `Top stories in ${countryLabel(country)}, the last ${hours} hours: how many of their outlets are based there (WorldPulse):`
        : `Stories outlets from many countries report while one or none of their outlets is from the country where they happen (of the last ${hours} hours' 20 biggest stories, the fewest home outlets first; WorldPulse):`
      const none = country
        ? `No story mostly placed in ${countryLabel(country)} was reported by two or more outlets in the last ${hours} hours.`
        : `Each of the last ${hours} hours' 20 biggest stories that outlets from 10 or more countries report has two or more outlets from its own country.`
      const text = [
        rows.length ? head : none,
        ...rows.map(line),
        '\nThese count the outlets WorldPulse matched to each story and knows the home country of. Reports in the local language can sit in a story of their own, so a low count is a lead to check, not proof that the local press is silent. The newsrooms WorldPulse reads in a country: who_covers.',
      ].join('\n').replace(/\n{3,}/g, '\n\n').trim()
      return { text, data: { hours, country: country ?? null, stories: rows.map(s => ({ ...storyOut(s), homeOutlets: home(s) })) } }
    },
  },
  {
    name: 'site_check',
    title: 'Is this site a content farm?',
    description: 'Red flags for a website before you trust it: whether it is on WorldPulse\'s list of known AI content farms (sites that publish machine-written articles in bulk; from NewsGuard\'s and the CCDH\'s public reports), the reliability score WorldPulse gives it if it is one of WorldPulse\'s own sources, and what WorldPulse\'s outlet directory knows of it (name, home country, kind, state media). Give a website or an article\'s address. Not on the list only means WorldPulse knows of no problem with it, not that it is reliable.',
    inputSchema: {
      type: 'object',
      properties: { site: { type: 'string', minLength: 3, maxLength: 2048, description: 'A website or an article\'s address, e.g. example.com' } },
      required: ['site'],
      additionalProperties: false,
    },
    async run(args, asker) {
      const given = strArg(args, 'site', { required: true, max: 2048 })!
      const site = siteOf(given)
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(site)) throw new ToolError('site must be a website such as example.com, or an article\'s address')
      const { status, body } = await ask(asker, `/api/v1/slop/check?domain=${encodeURIComponent(site)}`)
      if (status === 400) throw new ToolError(String((body as { error?: unknown }).error ?? 'That is not a website WorldPulse can check'))
      if (status !== 200) throw new Error(`site check answered ${status}`)
      const c = body as { is_ai_farm?: unknown; reliability_score?: unknown; source_name?: unknown; warnings?: unknown }
      const farm = c.is_ai_farm === true
      const farms = KNOWN_AI_CONTENT_FARMS.length
      const score = typeof c.reliability_score === 'number' && Number.isFinite(c.reliability_score) ? c.reliability_score : null
      const sourceName = typeof c.source_name === 'string' && c.source_name ? c.source_name : null
      const e = outletOf(site)
      const size = Object.keys(OUTLET_DIRECTORY).length
      const verdict = farm || (score !== null && score < 0.4) ? 'red flag' : score !== null && score < 0.65 ? 'caution' : 'no red flag known'
      const text = [
        farm
          ? `${site}: on WorldPulse's list of ${farms} known AI content farms. Its articles are likely machine-written: don't cite it as a news source.`
          : `${site}: not on WorldPulse's list of ${farms} known AI content farms (from NewsGuard's and the CCDH's public reports).`,
        score !== null
          ? `WorldPulse reads it as a source${sourceName ? ` (${sourceName})` : ''}, with a reliability score of ${Math.round(score * 100)}%${score < 0.4 ? ': low, treat what it says with care' : score < 0.65 ? ': moderate, check its claims elsewhere' : ''}.`
          : 'It is not one of the sources WorldPulse scores.',
        e
          ? `In WorldPulse's outlet directory: ${e.name}, ${String(OUTLET_KIND_LABELS[e.kind]).toLowerCase()}, from ${countryLabel(e.country)}${e.state ? ', state media (a government runs it)' : ''}.`
          : `It is not in WorldPulse's directory of ${size} outlets.`,
        `Overall: ${verdict}. Not on the list only means WorldPulse knows of no problem with it, not that it is reliable. The list: https://api.world-pulse.io/api/v1/slop/farms`,
      ].join('\n')
      return {
        text,
        data: {
          site, aiContentFarm: farm, farmListSize: farms, reliabilityScore: score, sourceName,
          directory: e ? { name: e.name, kind: e.kind, country: e.country, stateMedia: Boolean(e.state) } : null,
          verdict, warnings: Array.isArray(c.warnings) ? c.warnings.filter((w): w is string => typeof w === 'string') : [],
        },
      }
    },
  },
  // ─── The five tools of Nov 10, 2026, evening (Devon: "AI tools from 35 to 40, built on today's work") ───
  {
    name: 'quiet_places',
    title: 'Where news goes unconfirmed',
    description: 'The places whose news most rarely finds a second outlet: of each country\'s news reports in the last days (7 by default, up to 14), how many turned verified (a second, separate outlet reported the same event) and how many still wait with one outlet, the lowest verified share first, among places with 10 reports or more. Each with the languages its reports are in. Give country for one place\'s numbers. A low share often means few newsrooms report on a place, or report in a language few others read: its reports are leads to check (unconfirmed lists the serious ones; who_covers, the newsrooms read there).',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 14, default: 7, description: 'How many days back (1 to 14, default 7)' },
        country: { type: 'string', pattern: '^[A-Za-z]{2}$', description: 'One place, by its two-letter country code, e.g. BI' },
        limit: { type: 'integer', minimum: 1, maximum: 30, default: 10, description: 'How many places (1 to 30, default 10)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const days = intArg(args, 'days', 7, 1, 14)
      const given = strArg(args, 'country', { pattern: /^[A-Za-z]{2}$/, hint: 'must be a two-letter country code such as BI' })?.toUpperCase()
      const country = given === 'UK' ? 'GB' : given
      const limit = intArg(args, 'limit', 10, 1, 30)
      const { status, body } = await ask(asker, `/api/v1/public/unconfirmed-places?days=${days}`)
      if (status !== 200) throw new Error(`unconfirmed-places answered ${status}`)
      type Place = { country: string; reports: number; verified: number; waiting: number; waitingSerious: number; languages: string[] }
      const all = (((body.data ?? {}) as { places?: Place[] }).places ?? []).filter(p => p && /^[A-Z]{2}$/.test(String(p.country)))
      const share = (p: Place) => (p.reports > 0 ? p.verified / p.reports : 0)
      const pct = (p: Place) => `${Math.round(share(p) * 100)}%`
      const langs = (p: Place) => (p.languages?.length ? `in ${p.languages.map(languageLabel).join(', ')}` : '')
      const line = (p: Place, i: number) =>
        `${i + 1}. ${countryLabel(p.country, false)}: ${p.reports.toLocaleString('en-US')} reports, ${p.verified.toLocaleString('en-US')} verified (${pct(p)}) · ${p.waiting.toLocaleString('en-US')} waiting for a second outlet${p.waitingSerious ? `, ${p.waitingSerious.toLocaleString('en-US')} of them serious` : ''}${langs(p) ? ` · ${langs(p)}` : ''}`
      const out = (p: Place) => ({ ...p, name: countryLabel(p.country, false), verifiedShare: Math.round(share(p) * 1000) / 1000, url: `${SITE}/countries/${p.country.toLowerCase()}` })
      if (country) {
        const p = all.find(x => x.country === country)
        if (countryLabel(country, false) === country) throw new ToolError(`${country} is not a country code WorldPulse knows`)
        const text = p
          ? [`${countryLabel(country)}, the last ${days} days (WorldPulse): ${line(p, 0).replace(/^1\. [^:]+: /, '')}.`,
            `Verified means a second, separate outlet reported the same event. The serious ones still waiting: unconfirmed with country ${country}. Its newsrooms: who_covers. ${SITE}/countries/${country.toLowerCase()}`].join('\n')
          : `No news report was pinned in ${countryLabel(country)} in the last ${days} days. Its newsrooms: who_covers.`
        return { text, data: { days, country, place: p ? out(p) : null } }
      }
      const quiet = all.filter(p => p.reports >= 10).sort((a, b) => share(a) - share(b) || b.reports - a.reports).slice(0, limit)
      const total = all.reduce((n, p) => n + p.reports, 0)
      const verified = all.reduce((n, p) => n + p.verified, 0)
      const text = [
        quiet.length
          ? `Where news goes unconfirmed, the last ${days} days: the places whose reports most rarely found a second outlet (10 reports or more), the lowest verified share first (WorldPulse):`
          : `No place had 10 news reports or more in the last ${days} days.`,
        ...quiet.map(line),
        total ? `\nAcross all ${all.length} places: ${total.toLocaleString('en-US')} reports, ${Math.round((verified / total) * 100)}% verified. Verified means a second, separate outlet reported the same event; a low share often means few newsrooms report on the place, or report in a language few others read. Leads to check: unconfirmed. ${SITE}/how-we-count` : '',
      ].join('\n').replace(/\n{3,}/g, '\n\n').trim()
      return { text, data: { days, places: quiet.map(out), all: { places: all.length, reports: total, verified } } }
    },
  },
  {
    name: 'story_languages',
    title: 'The languages a story is reported in',
    description: 'The languages a story is reported in, with its outlets in each: give a story id or a report id (as top_stories, story or search_reports give them). For each language, the outlets of the story\'s last two days that write in it, from WorldPulse\'s directory of the newsrooms whose feeds it reads (an outlet seen only in GDELT\'s articles has no language there), and the languages of the story\'s own reports; and how many countries its outlets are from. A story told in many languages is one the world is watching; one told only in languages other than English may be one the English-language press missed (missed_in_english).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'A story id or a report id (a UUID)' } },
      required: ['id'],
      additionalProperties: false,
    },
    async run(args, asker) {
      const id = strArg(args, 'id', { required: true, pattern: UUID, hint: 'must be a story or report id (a UUID)' })!
      const { status, body } = await ask(asker, `/api/v1/stories/${id}`)
      if (status === 404) throw new ToolError('No story or report with that id')
      if (status !== 200) throw new Error(`story answered ${status}`)
      const d = (body.data ?? {}) as {
        storyId?: string; outlets?: number; outletNames?: string[]; outletCountries?: number; languages?: string[]; verifiedAt?: string | null
        signals?: Array<{ id: string; title: string }>
      }
      const first = d.signals?.[0]
      const byLanguage = new Map<string, string[]>()
      const unknown: string[] = []
      for (const site of d.outletNames ?? []) {
        const e = outletOf(site)
        if (!e?.lang) { unknown.push(site); continue }
        const list = byLanguage.get(e.lang) ?? []
        if (!list.includes(e.name)) list.push(e.name)
        byLanguage.set(e.lang, list)
      }
      const languages = [...new Set([...(d.languages ?? []), ...byLanguage.keys()])]
        .sort((a, b) => (byLanguage.get(b)?.length ?? 0) - (byLanguage.get(a)?.length ?? 0) || a.localeCompare(b))
      const countries = Number(d.outletCountries) || 0
      const head = languages.length >= 2
        ? `Reported in ${languages.length} languages${countries >= 2 ? ` across ${countries} countries` : ''}`
        : languages.length === 1 ? `Reported in ${languageLabel(languages[0]!)} only` : 'Its languages aren\'t known'
      const named = (names: string[]) => names.length > 6 ? `${names.slice(0, 6).join(', ')} and ${names.length - 6} more` : names.join(', ')
      const text = [
        `${first?.title ?? 'Story'}`,
        `${head}${d.outlets ? `, by ${d.outlets} outlet${d.outlets === 1 ? '' : 's'} in its last two days` : ''}${d.verifiedAt ? '' : ' (not verified yet)'} (WorldPulse):`,
        ...languages.map(l => {
          const names = byLanguage.get(l) ?? []
          return `- ${languageLabel(l)}: ${names.length ? `${names.length} outlet${names.length === 1 ? '' : 's'} (${named(names)})` : 'its own reports'}`
        }),
        unknown.length ? `- Language not in the directory: ${unknown.length} outlet${unknown.length === 1 ? '' : 's'} (${named(unknown.map(describeSite))})` : '',
        `Page: ${signalLink(first?.id ?? id)}`,
      ].filter(Boolean).join('\n')
      return {
        text,
        data: {
          storyId: d.storyId ?? id, url: signalLink(first?.id ?? id), title: first?.title ?? null, verified: Boolean(d.verifiedAt),
          outlets: d.outlets ?? 0, outletCountries: countries,
          languages: languages.map(l => ({ code: l, name: languageLabel(l), outlets: byLanguage.get(l) ?? [] })),
          unknownLanguage: unknown,
        },
      }
    },
  },
  {
    name: 'verified_in_languages',
    title: 'Just verified, in other languages',
    description: 'The newest reports in languages other than English that turned verified (a second, separate outlet reported the same event), newest first, from the last hours (24 by default, up to 72): each with its language, place, severity, how long ago it turned verified, the languages its story is reported in, and its link. Give language (a two-letter code: fr, es, pt, de, ru, ar…) for one language. WorldPulse reads its feeds in their own languages and looks for second outlets in English, French, German, Spanish, Portuguese, Russian and Arabic articles.',
    inputSchema: {
      type: 'object',
      properties: {
        language: { type: 'string', pattern: '^[A-Za-z]{2}$', description: 'One language, by its two-letter code, e.g. fr' },
        hours: { type: 'integer', minimum: 1, maximum: 72, default: 24, description: 'How many hours back (1 to 72, default 24)' },
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'How many reports (1 to 20, default 10)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const language = strArg(args, 'language', { pattern: /^[A-Za-z]{2}$/, hint: 'must be a two-letter language code such as fr' })?.toLowerCase()
      if (language === 'en') throw new ToolError('language must be one other than English (for the newest verified reports in English, use latest)')
      const hours = intArg(args, 'hours', 24, 1, 72)
      const limit = intArg(args, 'limit', 10, 1, 20)
      const { status, body } = await ask(asker, `/api/v1/public/languages?hours=${hours}`)
      if (status !== 200) throw new Error(`languages answered ${status}`)
      type Report = { id: string; title: string; language: string; country: string | null; severity: string | null; category: string | null; verifiedAt: string | null; storyId: string | null; storyLanguages: string[] }
      const seen = new Set<string>()
      const shown = ((((body.data ?? {}) as { verified?: Report[] }).verified) ?? [])
        .filter(r => r && UUID.test(String(r.id)) && typeof r.title === 'string' && (!language || r.language === language))
        .filter(r => { const k = r.storyId ?? r.id; if (seen.has(k)) return false; seen.add(k); return true })
        .slice(0, limit)
      const which = language ? `in ${languageLabel(language)}` : 'in languages other than English'
      const text = [
        shown.length
          ? `Just verified ${which}, the last ${hours} hours, newest first (WorldPulse):`
          : `No report ${which} turned verified in the last ${hours} hours.`,
        ...shown.map((r, i) => `${i + 1}. ${r.title}\n   ${[languageLabel(r.language), r.country ? countryLabel(r.country, false) : '', cap(r.severity), r.verifiedAt ? `verified ${agoLabel(r.verifiedAt)}` : ''].filter(Boolean).join(' · ')}${r.storyLanguages.length >= 2 ? ` · its story in ${r.storyLanguages.map(languageLabel).join(', ')}` : ''}\n   ${signalLink(r.id)}`),
        '\nVerified means a second, separate outlet reported the same event. A story\'s languages: story_languages; the stories reported in no English: missed_in_english.',
      ].join('\n').replace(/\n{3,}/g, '\n\n').trim()
      return {
        text,
        data: {
          hours, language: language ?? null,
          reports: shown.map(r => ({ id: r.id, title: r.title, url: signalLink(r.id), language: r.language, languageName: languageLabel(r.language), country: r.country, severity: r.severity, category: r.category, verifiedAt: r.verifiedAt, storyLanguages: r.storyLanguages })),
        },
      }
    },
  },
  {
    name: 'languages_today',
    title: 'The languages the news came in',
    description: 'The languages of the reports WorldPulse read in the last hours (24 by default, up to 72), the most first: for each, how many reports, from how many countries, how many turned verified (a second, separate outlet reported the same event) and how many still wait with one outlet. WorldPulse reads its feeds in their own languages; verified_in_languages lists the newest verified reports in languages other than English.',
    inputSchema: {
      type: 'object',
      properties: { hours: { type: 'integer', minimum: 1, maximum: 72, default: 24, description: 'How many hours back (1 to 72, default 24)' } },
      additionalProperties: false,
    },
    async run(args, asker) {
      const hours = intArg(args, 'hours', 24, 1, 72)
      const { status, body } = await ask(asker, `/api/v1/public/languages?hours=${hours}`)
      if (status !== 200) throw new Error(`languages answered ${status}`)
      type Count = { language: string; reports: number; verified: number; waiting: number; countries: number }
      const counts = ((((body.data ?? {}) as { languages?: Count[] }).languages) ?? []).filter(c => c && /^[a-z]{2}$/.test(String(c.language)) && c.reports > 0)
      const total = counts.reduce((n, c) => n + c.reports, 0)
      const pct = (a: number, b: number) => `${b ? Math.round((a / b) * 100) : 0}%`
      const text = [
        counts.length
          ? `The last ${hours} hours, WorldPulse read reports in ${counts.length} languages (${total.toLocaleString('en-US')} reports), the most first:`
          : `WorldPulse read no report in the last ${hours} hours.`,
        ...counts.map((c, i) => `${i + 1}. ${languageLabel(c.language)}: ${c.reports.toLocaleString('en-US')} reports (${pct(c.reports, total)}) from ${c.countries} countr${c.countries === 1 ? 'y' : 'ies'} · ${pct(c.verified, c.reports)} verified · ${c.waiting.toLocaleString('en-US')} waiting for a second outlet`),
        '\nVerified means a second, separate outlet reported the same event. The newest verified in other languages: verified_in_languages. Where news goes unconfirmed: quiet_places.',
      ].join('\n').replace(/\n{3,}/g, '\n\n').trim()
      return {
        text,
        data: { hours, reports: total, languages: counts.map(c => ({ ...c, name: languageLabel(c.language), verifiedShare: c.reports ? Math.round((c.verified / c.reports) * 1000) / 1000 : 0 })) },
      }
    },
  },
  {
    name: 'missed_in_english',
    title: 'Verified, but not in English',
    description: 'Stories verified in the last hours (24 by default, up to 72) that WorldPulse found reported only in languages other than English: none of their reports is in English. Each with its languages, place, severity, when it turned verified and its link, newest first. A lead on what the English-language press is missing, not proof: WorldPulse reads some newsrooms only through GDELT\'s articles, and an English report can sit in a story of its own.',
    inputSchema: {
      type: 'object',
      properties: {
        hours: { type: 'integer', minimum: 1, maximum: 72, default: 24, description: 'How many hours back (1 to 72, default 24)' },
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'How many stories (1 to 20, default 10)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const hours = intArg(args, 'hours', 24, 1, 72)
      const limit = intArg(args, 'limit', 10, 1, 20)
      const { status, body } = await ask(asker, `/api/v1/public/languages?hours=${hours}`)
      if (status !== 200) throw new Error(`languages answered ${status}`)
      type Report = { id: string; title: string; language: string; country: string | null; severity: string | null; verifiedAt: string | null; storyId: string | null; storyLanguages: string[] }
      const seen = new Set<string>()
      const stories = ((((body.data ?? {}) as { verified?: Report[] }).verified) ?? [])
        .filter(r => r && UUID.test(String(r.id)) && typeof r.title === 'string' && !(r.storyLanguages ?? []).includes('en'))
        .filter(r => { const k = r.storyId ?? r.id; if (seen.has(k)) return false; seen.add(k); return true })
        .slice(0, limit)
      const text = [
        stories.length
          ? `Verified in the last ${hours} hours, and reported in no English (WorldPulse), newest first:`
          : `Every story verified in the last ${hours} hours in another language has a report in English too, or none turned verified.`,
        ...stories.map((r, i) => `${i + 1}. ${r.title}\n   ${[(r.storyLanguages?.length ? r.storyLanguages : [r.language]).map(languageLabel).join(', '), r.country ? countryLabel(r.country, false) : '', cap(r.severity), r.verifiedAt ? `verified ${agoLabel(r.verifiedAt)}` : ''].filter(Boolean).join(' · ')}\n   ${signalLink(r.id)}`),
        '\nA lead on what the English-language press is missing, not proof: WorldPulse reads some newsrooms only through GDELT\'s articles, and an English report can sit in a story of its own. A story\'s languages: story_languages.',
      ].join('\n').replace(/\n{3,}/g, '\n\n').trim()
      return {
        text,
        data: { hours, stories: stories.map(r => ({ id: r.id, title: r.title, url: signalLink(r.id), languages: r.storyLanguages?.length ? r.storyLanguages : [r.language], country: r.country, severity: r.severity, verifiedAt: r.verifiedAt })) },
      }
    },
  },
  // ── Nov 10, 2026, night (Devon, 6:48 PM: "Let's get to 100 AI tools before we list it on the directories") ──
  {
    name: 'military_aircraft',
    title: 'Military aircraft in the air now',
    description: 'Military aircraft broadcasting their position right now, from adsb.lol (open data under the ODbL; aircraft that switch their transponder off, or are in privacy programmes, are not there): how many, their commonest types, and, when you give a place\'s latitude and longitude, the ones within a distance of it (500 km by default), the nearest first, each with its callsign, type, altitude, speed and position. Read at most every 3 minutes: a snapshot, not a track, and not every air force broadcasts.',
    inputSchema: {
      type: 'object',
      properties: {
        latitude: { type: 'number', minimum: -90, maximum: 90, description: 'A place\'s latitude, e.g. 26.2 for the Gulf' },
        longitude: { type: 'number', minimum: -180, maximum: 180, description: 'A place\'s longitude, e.g. 52.5 for the Gulf' },
        radius_km: { type: 'integer', minimum: 10, maximum: 3000, default: 500, description: 'How far from the place, in km (10 to 3000, default 500)' },
        limit: { type: 'integer', minimum: 1, maximum: 30, default: 15, description: 'How many to list (1 to 30, default 15)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const place = placeArgs(args)
      const km = intArg(args, 'radius_km', 500, 10, 3000)
      const limit = intArg(args, 'limit', 15, 1, 30)
      const snap = await aircraftNow(asker)
      const military = snap.aircraft.filter(a => a.military)
      const types = topCounts(military.map(a => a.type).filter((t): t is string => Boolean(t)), 6)
      const near = place
        ? military.map(a => ({ ...a, km: distanceKm(place.lat, place.lng, a.lat, a.lng) })).filter(a => a.km <= km).sort((a, b) => a.km - b.km)
        : []
      const at = snap.at ? ` (adsb.lol, ${snap.at.slice(11, 16)} UTC)` : ' (adsb.lol)'
      const text = [
        `${military.length.toLocaleString('en-US')} military aircraft broadcasting their position now${at}.${types.length ? ` Commonest types: ${types.map(([t, n]) => `${t} (${n})`).join(', ')}.` : ''}`,
        place
          ? near.length
            ? [`Within ${km} km of ${coords(place.lat, place.lng)}, nearest first:`, ...near.slice(0, limit).map((a, i) => `${i + 1}. ${aircraftLine(a)} · ${Math.round(a.km)} km away`)].join('\n')
            : `None within ${km} km of ${coords(place.lat, place.lng)}.`
          : 'Give a place\'s latitude and longitude for the ones near it.',
        snap.emergency ? `Squawking an emergency code now: ${snap.emergency} aircraft (emergency_flights).` : '',
        'Aircraft that switch their transponders off are not there. Map: ' + `${SITE}/map`,
      ].filter(Boolean).join('\n')
      return {
        text,
        data: {
          at: snap.at, source: 'adsb.lol', license: 'ODbL 1.0', military: military.length, types: types.map(([type, count]) => ({ type, count })),
          place: place ? { latitude: place.lat, longitude: place.lng, radiusKm: km } : null,
          aircraft: near.slice(0, limit).map(a => aircraftData(a)),
        },
      }
    },
  },
  {
    name: 'emergency_flights',
    title: 'Aircraft squawking an emergency now',
    description: 'Aircraft squawking an emergency code right now, from adsb.lol (open data under the ODbL): 7700 (an emergency), 7600 (radio failure) and 7500 (hijack), each with its callsign, type, altitude, speed and position, and its distance from a place when you give its latitude and longitude. Most of the time there are none or a few: a squawk is a pilot\'s signal, often a precaution, and the news says what it was.',
    inputSchema: {
      type: 'object',
      properties: {
        latitude: { type: 'number', minimum: -90, maximum: 90, description: 'A place\'s latitude, for each aircraft\'s distance from it' },
        longitude: { type: 'number', minimum: -180, maximum: 180, description: 'A place\'s longitude' },
        limit: { type: 'integer', minimum: 1, maximum: 30, default: 15, description: 'How many to list (1 to 30, default 15)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const place = placeArgs(args)
      const limit = intArg(args, 'limit', 15, 1, 30)
      const snap = await aircraftNow(asker)
      const squawking = snap.aircraft.filter(a => a.emergency)
        .map(a => ({ ...a, km: place ? distanceKm(place.lat, place.lng, a.lat, a.lng) : null }))
        .sort((a, b) => (a.km ?? 0) - (b.km ?? 0))
      const at = snap.at ? ` (adsb.lol, ${snap.at.slice(11, 16)} UTC)` : ' (adsb.lol)'
      const text = squawking.length === 0
        ? `No aircraft is squawking an emergency code now${at}: no 7700 (emergency), 7600 (radio failure) or 7500 (hijack).`
        : [
          `${squawking.length} aircraft squawking an emergency code now${at}${place ? `, nearest to ${coords(place.lat, place.lng)} first` : ''}:`,
          ...squawking.slice(0, limit).map((a, i) => `${i + 1}. ${a.emergency} (${a.squawk}): ${aircraftLine(a)}${a.km !== null ? ` · ${Math.round(a.km)} km away` : ''}`),
          'A squawk is the crew\'s signal, often a precaution; reports of what happened come later (breaking, search_reports).',
        ].join('\n')
      return {
        text,
        data: { at: snap.at, source: 'adsb.lol', license: 'ODbL 1.0', count: squawking.length, aircraft: squawking.slice(0, limit).map(a => ({ ...aircraftData(a), emergency: a.emergency, squawk: a.squawk, km: a.km === null ? null : Math.round(a.km) })) },
      }
    },
  },
  {
    name: 'live_cameras',
    title: 'Public live cameras near a place',
    description: 'Public live cameras, from the agencies that publish them (Transport for London, NYC DOT, Caltrans in Los Angeles and San Francisco, Fintraffic in Finland, Hong Kong\'s Transport Department, New Zealand\'s NZTA): the nearest to a place you give by latitude and longitude, or those of a country, each with its name, city, kind (traffic or weather), distance and a link to its latest picture. About 5,100 cameras in 5 countries; without a place or country, where they are.',
    inputSchema: {
      type: 'object',
      properties: {
        latitude: { type: 'number', minimum: -90, maximum: 90, description: 'A place\'s latitude, e.g. 51.51 for London' },
        longitude: { type: 'number', minimum: -180, maximum: 180, description: 'A place\'s longitude, e.g. -0.13 for London' },
        country: { type: 'string', description: 'A two-letter country code, e.g. FI' },
        type: { type: 'string', enum: ['traffic', 'weather'], description: 'Only traffic or only weather cameras' },
        radius_km: { type: 'integer', minimum: 1, maximum: 300, default: 25, description: 'How far from the place, in km (1 to 300, default 25)' },
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 8, description: 'How many (1 to 20, default 8)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const place = placeArgs(args)
      const country = strArg(args, 'country', { pattern: /^[A-Za-z]{2}$/, hint: 'must be a two-letter country code such as FI' })?.toUpperCase().replace(/^UK$/, 'GB')
      const type = strArg(args, 'type', { pattern: /^(traffic|weather)$/, hint: 'must be traffic or weather' })
      const km = intArg(args, 'radius_km', 25, 1, 300)
      const limit = intArg(args, 'limit', 8, 1, 20)
      const { status, body } = await ask(asker, `/api/v1/cameras?limit=6000${type ? `&type=${type}` : ''}`)
      if (status !== 200) throw new Error(`cameras answered ${status}`)
      type Camera = { id: string; name: string; city?: string | null; country?: string; countryCode?: string; lat: number; lng: number; type?: string; snapshotUrl?: string; embedUrl?: string; sourceName?: string }
      type Source = { name: string; page?: string; count?: number }
      const d = ((body.data ?? body) as { cameras?: Camera[]; sources?: Source[] })
      const cameras = (d.cameras ?? []).filter(c => c && typeof c.name === 'string' && Number.isFinite(c.lat) && Number.isFinite(c.lng))
      const where = new Map<string, number>()
      for (const c of cameras) if (c.countryCode) where.set(c.countryCode, (where.get(c.countryCode) ?? 0) + 1)
      const places = [...where.entries()].sort((a, b) => b[1] - a[1]).map(([code, n]) => `${countryLabel(code, false)} (${n.toLocaleString('en-US')})`).join(', ')
      if (!place && !country) {
        const sources = (d.sources ?? []).map(s => `${s.name} (${Number(s.count ?? 0).toLocaleString('en-US')})`).join(', ')
        return {
          text: `${cameras.length.toLocaleString('en-US')} public live cameras${type ? ` (${type})` : ''} in ${places || 'no country yet'}, from ${sources || 'their agencies'}. Give a place's latitude and longitude, or a country, for the cameras there. Map: ${SITE}/map`,
          data: { cameras: cameras.length, countries: [...where.entries()].map(([code, count]) => ({ code, count })), sources: d.sources ?? [] },
        }
      }
      const picked = cameras
        .filter(c => !country || c.countryCode === country)
        .map(c => ({ ...c, km: place ? distanceKm(place.lat, place.lng, c.lat, c.lng) : null }))
        .filter(c => c.km === null || c.km <= km)
        .sort((a, b) => (a.km ?? 0) - (b.km ?? 0) || a.name.localeCompare(b.name))
      const scope = place ? `within ${km} km of ${coords(place.lat, place.lng)}${country ? ` in ${countryLabel(country, true)}` : ''}` : `in ${countryLabel(country!, true)}`
      const text = picked.length === 0
        ? `No public camera WorldPulse shows ${scope}${type ? ` (${type})` : ''}. It has cameras in ${places}.`
        : [
          `Public live cameras ${scope}${type ? ` (${type})` : ''}${place ? ', nearest first' : ''}:`,
          ...picked.slice(0, limit).map((c, i) => `${i + 1}. ${c.name}${c.city ? `, ${c.city}` : ''} · ${c.type ?? 'camera'}${c.km !== null ? ` · ${c.km < 1 ? '<1' : Math.round(c.km)} km` : ''} · ${c.sourceName ?? ''}\n   Picture: ${c.snapshotUrl ?? ''}`),
          picked.length > limit ? `…and ${picked.length - limit} more.` : '',
        ].filter(Boolean).join('\n')
      return {
        text,
        data: {
          place: place ? { latitude: place.lat, longitude: place.lng, radiusKm: km } : null, country: country ?? null, total: picked.length,
          cameras: picked.slice(0, limit).map(c => ({ id: c.id, name: c.name, city: c.city ?? null, country: c.countryCode ?? null, type: c.type ?? null, latitude: c.lat, longitude: c.lng, km: c.km === null ? null : Math.round(c.km * 10) / 10, picture: c.snapshotUrl ?? null, page: c.embedUrl ?? null, source: c.sourceName ?? null })),
        },
      }
    },
  },
  {
    name: 'busiest_countries',
    title: 'The countries with the most news now',
    description: 'The countries with the most news in WorldPulse\'s reports of the last 24 hours, the most first: each with its reports, how many came in the last 6 hours, whether that is rising, steady or falling, and how reliable its sources are on average. Busy is not the same as dangerous: a big country has many outlets. For where serious things are happening, use hotspots or conflicts; for one country, country.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 30, default: 15, description: 'How many countries (1 to 30, default 15)' } },
      additionalProperties: false,
    },
    async run(args, asker) {
      const limit = intArg(args, 'limit', 15, 1, 30)
      const { status, body } = await ask(asker, `/api/v1/countries`)
      if (status !== 200) throw new Error(`countries answered ${status}`)
      type Row = { code: string; name?: string; signal_count?: number; recent_6h?: number; trend?: string; avg_reliability?: number | null; latest_signal_at?: string | null }
      const rows = (((body.data ?? body) as { countries?: Row[] }).countries ?? [])
        .filter(r => r && /^[A-Z]{2}$/.test(String(r.code)))
        .sort((a, b) => Number(b.signal_count ?? 0) - Number(a.signal_count ?? 0))
        .slice(0, limit)
      const trendWord = (t?: string) => t === 'escalating' || t === 'rising' ? 'rising' : t === 'de-escalating' || t === 'falling' ? 'falling' : 'steady'
      const text = rows.length === 0
        ? 'No country counts are available just now.'
        : [
          'The countries with the most news in the last 24 hours (WorldPulse), the most first:',
          ...rows.map((r, i) => `${i + 1}. ${r.name || countryLabel(r.code, false)}: ${Number(r.signal_count ?? 0).toLocaleString('en-US')} reports, ${Number(r.recent_6h ?? 0).toLocaleString('en-US')} in the last 6 hours (${trendWord(r.trend)})${typeof r.avg_reliability === 'number' ? ` · sources ${Math.round(r.avg_reliability * 100)}% reliable on average` : ''}`),
          'Busy is not the same as dangerous: see hotspots for where serious reports meet. One country: country.',
        ].join('\n')
      return {
        text,
        data: { hours: 24, countries: rows.map(r => ({ code: r.code, name: r.name || countryLabel(r.code, false), reports: Number(r.signal_count ?? 0), last6h: Number(r.recent_6h ?? 0), trend: trendWord(r.trend), reliability: typeof r.avg_reliability === 'number' ? r.avg_reliability : null, latestAt: r.latest_signal_at ?? null })) },
      }
    },
  },
  {
    name: 'news_volume',
    title: 'How much news WorldPulse is reading',
    description: 'How much news WorldPulse is reading right now: its reports in the last hour and the last 24 hours, how many turned verified in the last 24 hours (a second, separate outlet reported the same event), from how many outlets (websites) and how many countries and territories, and its reports since it began.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(_args, asker) {
      const { status, body } = await ask(asker, `/api/v1/signals/count`)
      if (status !== 200) throw new Error(`counts answered ${status}`)
      const d = (body.data ?? body) as { total?: number; last24h?: number; lastHour?: number; verified24h?: number; countries24h?: number; outlets24h?: number }
      const n = (v: unknown) => Number(v ?? 0).toLocaleString('en-US')
      const text = [
        `WorldPulse read ${n(d.lastHour)} reports in the last hour and ${n(d.last24h)} in the last 24 hours, from ${n(d.outlets24h)} outlets in ${n(d.countries24h)} countries and territories.`,
        `${n(d.verified24h)} turned verified in the last 24 hours: a second, separate outlet reported the same event.`,
        `${n(d.total)} reports since it began. Live: ${SITE}`,
      ].join('\n')
      return {
        text,
        data: { lastHour: Number(d.lastHour ?? 0), last24h: Number(d.last24h ?? 0), verified24h: Number(d.verified24h ?? 0), outlets24h: Number(d.outlets24h ?? 0), countries24h: Number(d.countries24h ?? 0), total: Number(d.total ?? 0) },
      }
    },
  },
  {
    name: 'similar_reports',
    title: 'Reports like this one',
    description: 'The reports closest in meaning to one report, from three weeks either side of it, by WorldPulse\'s own text fingerprints (no AI service): the closest first, each with its status (verified or not yet), severity, place, date and link. To find the same event told another way, in another language, or what came before and after it. Give a report id or a story id (search_reports, latest or top_stories give them).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'A report id or a story id (a UUID)' },
        limit: { type: 'integer', minimum: 1, maximum: 10, default: 6, description: 'How many (1 to 10, default 6)' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    async run(args, asker) {
      const id = strArg(args, 'id', { required: true, pattern: UUID, hint: 'must be a report or story id (a UUID)' })!
      const limit = intArg(args, 'limit', 6, 1, 10)
      const story = await ask(asker, `/api/v1/stories/${id}`)
      if (story.status === 404) throw new ToolError('No report or story with that id')
      if (story.status !== 200) throw new Error(`story answered ${story.status}`)
      const first = (((story.body.data ?? {}) as { signals?: Array<{ id: string; title: string }> }).signals ?? [])[0]
      const reportId = first?.id && UUID.test(first.id) ? first.id : id
      const { status, body } = await ask(asker, `/api/v1/signals/${reportId}/similar?limit=${limit}`)
      if (status !== 200) throw new Error(`similar answered ${status}`)
      type Similar = { id: string; title: string; status?: string; severity?: string; location_name?: string | null; country_code?: string | null; created_at?: string | null }
      const similar = (((body as { similar?: Similar[] }).similar) ?? []).filter(s => s && UUID.test(String(s.id)) && typeof s.title === 'string' && s.id !== reportId).slice(0, limit)
      const text = similar.length === 0
        ? `No report close to "${first?.title ?? 'this one'}" in the three weeks either side of it.`
        : [
          `Reports closest in meaning to "${first?.title ?? 'this report'}" (WorldPulse's text fingerprints), the closest first:`,
          ...similar.map((s, i) => `${i + 1}. ${s.title}\n   ${[s.status === 'verified' ? 'Verified' : 'Not verified yet', cap(s.severity), s.location_name || (s.country_code ? countryLabel(s.country_code, false) : ''), s.created_at ? s.created_at.slice(0, 10) : ''].filter(Boolean).join(' · ')}\n   ${signalLink(s.id)}`),
          'Close in meaning, not always the same event: open each to check.',
        ].join('\n')
      return {
        text,
        data: { id: reportId, title: first?.title ?? null, similar: similar.map(s => ({ id: s.id, title: s.title, url: signalLink(s.id), verified: s.status === 'verified', severity: s.severity ?? null, place: s.location_name ?? null, country: s.country_code ?? null, at: s.created_at ?? null })) },
      }
    },
  },
  {
    name: 'reader_flags',
    title: 'What readers flagged on a report',
    description: 'Whether WorldPulse readers flagged a report as inaccurate, outdated, a duplicate or misinformation, and how many for each reason. A flag is a reader\'s note that something looks wrong, not a correction: WorldPulse shows the count and reasons, never who flagged it. Give a report id or a story id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'A report id or a story id (a UUID)' } },
      required: ['id'],
      additionalProperties: false,
    },
    async run(args, asker) {
      const id = strArg(args, 'id', { required: true, pattern: UUID, hint: 'must be a report or story id (a UUID)' })!
      const story = await ask(asker, `/api/v1/stories/${id}`)
      if (story.status === 404) throw new ToolError('No report or story with that id')
      if (story.status !== 200) throw new Error(`story answered ${story.status}`)
      const first = (((story.body.data ?? {}) as { signals?: Array<{ id: string; title: string }> }).signals ?? [])[0]
      const reportId = first?.id && UUID.test(first.id) ? first.id : id
      const { status, body } = await ask(asker, `/api/v1/signals/${reportId}/flags`)
      if (status !== 200) throw new Error(`flags answered ${status}`)
      const d = (body.data ?? {}) as { count?: number; reasons?: Record<string, number> }
      const count = Number(d.count ?? 0)
      const reasons = Object.entries(d.reasons ?? {}).filter(([, n]) => Number(n) > 0).sort((a, b) => Number(b[1]) - Number(a[1]))
      const text = count === 0
        ? `No reader has flagged "${first?.title ?? 'this report'}". ${signalLink(reportId)}`
        : `${count} reader${count === 1 ? '' : 's'} flagged "${first?.title ?? 'this report'}": ${reasons.map(([r, n]) => `${r} (${n})`).join(', ')}. A flag is a reader's note, not a correction. ${signalLink(reportId)}`
      return { text, data: { id: reportId, title: first?.title ?? null, url: signalLink(reportId), flags: count, reasons: Object.fromEntries(reasons) } }
    },
  },
  {
    name: 'outlet_mix',
    title: 'What kinds of newsroom carry a story',
    description: 'What kinds of newsroom carry a story: of its outlets (websites) in its last two days, how many are news agencies, international, national or local outlets, specialists, aggregators and official sources, from WorldPulse\'s directory of outlets, and how many a government runs (state media), with their names. A story carried mostly by state media or by one kind of outlet is one to read with care. Give a story id or a report id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'A story id or a report id (a UUID)' } },
      required: ['id'],
      additionalProperties: false,
    },
    async run(args, asker) {
      const id = strArg(args, 'id', { required: true, pattern: UUID, hint: 'must be a story or report id (a UUID)' })!
      const { status, body } = await ask(asker, `/api/v1/stories/${id}`)
      if (status === 404) throw new ToolError('No story or report with that id')
      if (status !== 200) throw new Error(`story answered ${status}`)
      type Info = { site: string; name: string | null; kind: string; country: string | null; stateMedia: boolean }
      const d = (body.data ?? {}) as { outlets?: number; outletNames?: string[]; outletInfo?: Info[]; verifiedAt?: string | null; signals?: Array<{ id: string; title: string }> }
      const info: Info[] = d.outletInfo ?? siteInfo(d.outletNames ?? [])
      // each outlet once by name: bbc.co.uk and bbc.com are the BBC
      const outlets = new Map<string, Info>()
      for (const o of info) if (!outlets.has(o.name ?? o.site)) outlets.set(o.name ?? o.site, o)
      const byKind = new Map<string, string[]>()
      for (const [name, o] of outlets) byKind.set(o.kind, [...(byKind.get(o.kind) ?? []), name])
      const state = [...outlets.entries()].filter(([, o]) => o.stateMedia).map(([name, o]) => `${name}${o.country ? ` (${countryLabel(o.country, false)})` : ''}`)
      const label = (kind: string) => kind === 'unknown' ? 'Not in the directory' : String(OUTLET_KIND_LABELS[kind as keyof typeof OUTLET_KIND_LABELS] ?? kind)
      const order = [...byKind.entries()].sort((a, b) => Number(a[0] === 'unknown') - Number(b[0] === 'unknown') || b[1].length - a[1].length)
      const named = (names: string[]) => names.length > 6 ? `${names.slice(0, 6).join(', ')} and ${names.length - 6} more` : names.join(', ')
      const first = d.signals?.[0]
      const total = outlets.size
      const text = [
        first?.title ?? 'Story',
        `${d.verifiedAt ? 'Verified' : 'Not verified yet'} · ${total} outlet${total === 1 ? '' : 's'} in its last two days, by kind (WorldPulse's outlet directory):`,
        ...order.map(([kind, names]) => `- ${label(kind)}: ${names.length} (${named(names)})`),
        state.length
          ? `State media (a government runs it): ${state.length} of ${total}${state.length * 2 > total ? ', more than half: read with care' : ''} · ${named(state)}`
          : 'State media: none among them.',
        `Page: ${signalLink(first?.id ?? id)}`,
      ].join('\n')
      return {
        text,
        data: {
          url: signalLink(first?.id ?? id), title: first?.title ?? null, verified: Boolean(d.verifiedAt), outlets: total,
          kinds: order.map(([kind, names]) => ({ kind, label: label(kind), count: names.length, outlets: names })),
          stateMedia: state,
        },
      }
    },
  },
  {
    name: 'country_compare',
    title: 'Two countries side by side',
    description: 'Two countries side by side in WorldPulse\'s reports: news reports in the last 7 days, how many turned verified and how many wait for a second outlet, the languages they come in, the newsrooms based there whose feeds WorldPulse reads, and reports a day this week against the week before. Give two two-letter country codes, e.g. KE and TZ.',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'string', description: 'A two-letter country code, e.g. KE' },
        b: { type: 'string', description: 'Another one, e.g. TZ' },
      },
      required: ['a', 'b'],
      additionalProperties: false,
    },
    async run(args, asker) {
      const code = (name: 'a' | 'b') => {
        const c = strArg(args, name, { required: true, pattern: /^[A-Za-z]{2}$/, hint: 'must be a two-letter country code such as KE' })!.toUpperCase().replace(/^UK$/, 'GB')
        if (countryLabel(c, false) === c) throw new ToolError(`${c} is not a country code WorldPulse knows`)
        return c
      }
      const [a, b] = [code('a'), code('b')]
      if (a === b) throw new ToolError('Give two different countries')
      const places = await ask(asker, `/api/v1/public/unconfirmed-places?days=7`)
      if (places.status !== 200) throw new Error(`places answered ${places.status}`)
      type Place = { country: string; reports: number; verified: number; waiting: number; languages: string[] }
      const all = (((places.body.data ?? {}) as { places?: Place[] }).places ?? [])
      const sides = await Promise.all([a, b].map(async c => {
        const daily = await ask(asker, `/api/v1/countries/${c}/daily?days=14`)
        const days = daily.status === 200 ? ((((daily.body.data ?? {}) as { daily?: Array<{ day: string; reports: number }> }).daily) ?? []) : []
        const sum = (list: Array<{ reports: number }>) => list.reduce((s, x) => s + Number(x.reports || 0), 0)
        const thisWeek = sum(days.slice(-7))
        const weekBefore = sum(days.slice(-14, -7))
        const p = all.find(x => x.country === c)
        return { code: c, name: countryLabel(c, false), reports: Number(p?.reports ?? 0), verified: Number(p?.verified ?? 0), waiting: Number(p?.waiting ?? 0), languages: p?.languages ?? [], newsrooms: newsroomsIn(c), thisWeek, weekBefore, days: days.length }
      }))
      const share = (s: (typeof sides)[number]) => s.reports ? `${Math.round(100 * s.verified / s.reports)}%` : '–'
      const change = (s: (typeof sides)[number]) => s.days < 14 || !s.weekBefore ? '' : ` (${s.thisWeek >= s.weekBefore ? '+' : ''}${Math.round(100 * (s.thisWeek - s.weekBefore) / s.weekBefore)}% on the week before)`
      const line = (s: (typeof sides)[number]) => [
        `${s.name}:`,
        `- News reports, last 7 days: ${s.reports.toLocaleString('en-US')}, ${s.verified.toLocaleString('en-US')} verified (${share(s)}), ${s.waiting.toLocaleString('en-US')} waiting for a second outlet`,
        `- Reports a day: ${s.days ? `${Math.round(s.thisWeek / 7).toLocaleString('en-US')} this week${change(s)}` : 'not counted'}`,
        `- Languages: ${s.languages.length ? s.languages.map(languageLabel).join(', ') : 'none counted'}`,
        `- Newsrooms based there whose feeds WorldPulse reads: ${s.newsrooms}${s.newsrooms <= 3 ? ' (thinly covered)' : ''}`,
        `- Page: ${SITE}/countries/${s.code.toLowerCase()}`,
      ].join('\n')
      const text = [`${sides[0]!.name} and ${sides[1]!.name} in WorldPulse's reports:`, ...sides.map(line)].join('\n\n')
      return { text, data: { countries: sides.map(s => ({ code: s.code, name: s.name, reports7d: s.reports, verified7d: s.verified, waiting7d: s.waiting, languages: s.languages, newsrooms: s.newsrooms, perDayThisWeek: Math.round(s.thisWeek / 7), thisWeek: s.thisWeek, weekBefore: s.weekBefore })) } }
    },
  },
  {
    name: 'space_weather',
    title: 'Space weather alerts',
    description: 'Space weather from NOAA\'s Space Weather Prediction Center: the highest levels in its alerts of the last 24 hours on NOAA\'s three scales (geomagnetic storms G1 to G5, solar radiation storms S1 to S5, radio blackouts R1 to R5; 0 is none), and the alerts, warnings and watches it issued in the last days (7 by default, up to 30), newest first, each once. Strong storms can disturb satellites, GPS, radio and power grids, and bring auroras far from the poles.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 30, default: 7, description: 'How many days back (1 to 30, default 7)' },
        limit: { type: 'integer', minimum: 1, maximum: 15, default: 8, description: 'How many alerts (1 to 15, default 8)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const days = intArg(args, 'days', 7, 1, 30)
      const limit = intArg(args, 'limit', 8, 1, 15)
      const [summary, recent] = await Promise.all([ask(asker, `/api/v1/space-weather/summary`), ask(asker, `/api/v1/space-weather/recent?hours=${days * 24}&limit=100`)])
      if (summary.status !== 200 || recent.status !== 200) throw new Error(`space weather answered ${summary.status}, ${recent.status}`)
      const s = (summary.body.data ?? {}) as { geomagnetic_level?: number; solar_radiation_level?: number; radio_blackout_level?: number }
      type Event = { id: string; title: string; severity?: string; published_at?: string | null }
      const seen = new Set<string>()
      const events = ((((recent.body.data ?? {}) as { events?: Event[] }).events) ?? [])
        .filter(e => e && typeof e.title === 'string')
        .sort((x, y) => String(y.published_at ?? '').localeCompare(String(x.published_at ?? '')))
        // NOAA reissues a watch: each title once a day
        .filter(e => { const k = `${e.title}|${String(e.published_at ?? '').slice(0, 10)}`; if (seen.has(k)) return false; seen.add(k); return true })
        .slice(0, limit)
      const level = (letter: string, n?: number) => Number(n) > 0 ? `${letter}${n}` : `${letter}0 (none)`
      const text = [
        `Highest in NOAA's alerts of the last 24 hours: geomagnetic storms ${level('G', s.geomagnetic_level)}, solar radiation ${level('S', s.solar_radiation_level)}, radio blackouts ${level('R', s.radio_blackout_level)}.`,
        events.length
          ? [`NOAA's alerts, warnings and watches, the last ${days} days, newest first:`, ...events.map((e, i) => `${i + 1}. ${e.title.replace(/^Space weather (alert|warning|watch|summary): /i, '')} · ${e.published_at ? `${e.published_at.slice(0, 16).replace('T', ' ')} UTC` : ''}\n   ${signalLink(e.id)}`)].join('\n')
          : `No NOAA alert, warning or watch in the last ${days} days.`,
        'Source: NOAA SWPC, https://www.swpc.noaa.gov/',
      ].join('\n')
      return {
        text,
        data: { levels24h: { geomagnetic: Number(s.geomagnetic_level ?? 0), solarRadiation: Number(s.solar_radiation_level ?? 0), radioBlackout: Number(s.radio_blackout_level ?? 0) }, days, alerts: events.map(e => ({ id: e.id, title: e.title, url: signalLink(e.id), at: e.published_at ?? null })) },
      }
    },
  },
  // ── Nov 10, 2026, night: round 2 of 6 (Devon, 6:48 PM: "Let's get to 100 AI tools") ──
  {
    name: 'chokepoints_news',
    title: 'The shipping chokepoints in the news',
    description: 'The world\'s 12 shipping chokepoints (the Strait of Hormuz, the Suez Canal, Bab el-Mandeb, the Strait of Malacca, the Panama Canal, the Taiwan Strait, the Turkish Straits and others) ranked by how many of the last days\' news reports name them (7 days by default, up to 14), in English and the other languages WorldPulse reads most, each with how many are verified and its newest headline. For the reports at one of them, use shipping with its chokepoint.',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'integer', minimum: 1, maximum: 14, default: 7, description: 'How many days back (1 to 14, default 7)' } },
      additionalProperties: false,
    },
    async run(args, asker) {
      const days = intArg(args, 'days', 7, 1, 14)
      const { status, body } = await ask(asker, `/api/v1/public/chokepoints?days=${days}`)
      if (status !== 200) throw new Error(`chokepoints answered ${status}`)
      type Row = { id: string; name: string; reports: number; verified: number; latest: { id: string; title: string; at: string | null; verified: boolean } | null }
      const rows = (((body.data ?? {}) as { chokepoints?: Row[] }).chokepoints ?? []).filter(r => r && typeof r.name === 'string')
      const named = rows.filter(r => r.reports > 0)
      const quiet = rows.filter(r => r.reports === 0).map(r => r.name)
      const text = [
        named.length ? `The shipping chokepoints named in the last ${days} days' news reports (WorldPulse), the most first:` : `No shipping chokepoint was named in the last ${days} days' news reports.`,
        ...named.map((r, i) => `${i + 1}. ${r.name}: ${r.reports} report${r.reports === 1 ? '' : 's'}, ${r.verified} verified${r.latest ? `\n   Newest${r.latest.verified ? ' verified' : ''}: ${r.latest.title} (${agoLabel(r.latest.at)}) ${signalLink(r.latest.id)}` : ''}`),
        quiet.length && named.length ? `Not named: ${quiet.join(', ')}.` : '',
        'Named in a headline, in English, French, Spanish, Portuguese, German, Russian or Arabic. One chokepoint\'s reports: shipping.',
      ].filter(Boolean).join('\n')
      return { text, data: { days, chokepoints: rows.map(r => ({ id: r.id, name: r.name, reports: r.reports, verified: r.verified, latest: r.latest ? { ...r.latest, url: signalLink(r.latest.id) } : null })) } }
    },
  },
  {
    name: 'exploited_vulnerabilities',
    title: 'Software flaws attackers are using',
    description: 'The newest entries of the US cybersecurity agency CISA\'s Known Exploited Vulnerabilities catalogue, as WorldPulse read them (the last 30 days by default, up to 90): flaws in named products that attackers are already using, newest first, each with its CVE number, the product, whether it is known to be used in ransomware campaigns, and its link. For which to patch first, not a scan of anyone\'s systems.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 90, default: 30, description: 'How many days back (1 to 90, default 30)' },
        vendor: { type: 'string', maxLength: 60, description: 'Only one maker\'s products, e.g. Microsoft' },
        limit: { type: 'integer', minimum: 1, maximum: 25, default: 12, description: 'How many (1 to 25, default 12)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const days = intArg(args, 'days', 30, 1, 90)
      const vendor = strArg(args, 'vendor', { max: 60 })?.toLowerCase()
      const limit = intArg(args, 'limit', 12, 1, 25)
      const { status, body } = await ask(asker, `/api/v1/public/vulnerabilities?days=${days}`)
      if (status !== 200) throw new Error(`vulnerabilities answered ${status}`)
      type Vuln = { id: string; title: string; summary: string | null; at: string | null; cve: string | null; vendor: string | null; ransomware: boolean }
      const all = (((body.data ?? {}) as { vulnerabilities?: Vuln[] }).vulnerabilities ?? []).filter(v => v && typeof v.title === 'string')
      const mine = all.filter(v => !vendor || `${v.vendor ?? ''} ${v.title}`.toLowerCase().includes(vendor))
      const ransom = mine.filter(v => v.ransomware).length
      const scope = `in the last ${days} days${vendor ? ` for ${vendor}` : ''}`
      const text = mine.length === 0
        ? `No new entry in CISA's Known Exploited Vulnerabilities catalogue ${scope}.`
        : [
          `${mine.length} new entr${mine.length === 1 ? 'y' : 'ies'} in CISA's Known Exploited Vulnerabilities catalogue ${scope}${ransom ? `, ${ransom} known to be used in ransomware` : ''}, newest first:`,
          ...mine.slice(0, limit).map((v, i) => `${i + 1}. ${v.title}${v.ransomware ? ' (used in ransomware)' : ''} · added ${v.at ? v.at.slice(0, 10) : ''}\n   ${signalLink(v.id)}`),
          'Catalogue: https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
        ].join('\n')
      return { text, data: { days, vendor: vendor ?? null, count: mine.length, ransomware: ransom, vulnerabilities: mine.slice(0, limit).map(v => ({ ...v, url: signalLink(v.id) })) } }
    },
  },
  {
    name: 'travel_advice',
    title: 'Travel advice for a country',
    description: 'What governments advise travellers about a country: the US State Department\'s level (1 exercise normal precautions, 2 increased caution, 3 reconsider travel, 4 do not travel) and since when, and the newest US and UK (Foreign Office) notices WorldPulse reported for it in the last year, with their links. Without a country: the countries at level 4 and level 3. Official advice, not WorldPulse\'s own judgement.',
    inputSchema: {
      type: 'object',
      properties: { country: { type: 'string', description: 'A two-letter country code, e.g. VE' } },
      additionalProperties: false,
    },
    async run(args, asker) {
      const country = strArg(args, 'country', { pattern: /^[A-Za-z]{2}$/, hint: 'must be a two-letter country code such as VE' })?.toUpperCase().replace(/^UK$/, 'GB')
      const { status, body } = await ask(asker, `/api/v1/public/travel-advice${country ? `?country=${country}` : ''}`)
      if (status !== 200) throw new Error(`travel advice answered ${status}`)
      type Level = { country: string; level: number; since: string | null }
      type Notice = { id: string; title: string; at: string | null; url: string | null; from: 'us' | 'uk' }
      const d = (body.data ?? {}) as { levels?: Level[]; us?: Level | null; notices?: Notice[] }
      const LEVELS = ['', 'exercise normal precautions', 'exercise increased caution', 'reconsider travel', 'do not travel']
      if (!country) {
        const levels = d.levels ?? []
        const at = (n: number) => levels.filter(l => l.level === n).map(l => countryLabel(l.country, false)).sort()
        const text = levels.length === 0
          ? 'The State Department\'s levels are not available just now.'
          : [
            `US travel advisories (State Department), ${levels.length} countries:`,
            `- Level 4, do not travel (${at(4).length}): ${at(4).join(', ')}`,
            `- Level 3, reconsider travel (${at(3).length}): ${at(3).join(', ')}`,
            `- Level 2: ${at(2).length} countries · Level 1: ${at(1).length}`,
            'One country\'s advice, with the UK\'s notices too: give its code.',
          ].join('\n')
        return { text, data: { countries: levels.length, level4: levels.filter(l => l.level === 4).map(l => l.country), level3: levels.filter(l => l.level === 3).map(l => l.country) } }
      }
      const us = d.us ?? null
      const notices = d.notices ?? []
      const text = [
        `${countryLabel(country, false)}: ${us ? `the US State Department says level ${us.level}, ${LEVELS[us.level]}${us.since ? ` (since ${us.since})` : ''}.` : 'no US State Department level on record.'}`,
        notices.length
          ? ['Newest official notices WorldPulse reported (last 12 months):', ...notices.slice(0, 6).map((n, i) => `${i + 1}. ${n.from === 'uk' ? 'UK Foreign Office' : 'US State Department'}: ${n.title} (${n.at ? n.at.slice(0, 10) : ''})${n.url ? `\n   ${n.url}` : ''}`)].join('\n')
          : 'No US or UK travel notice reported for it in the last 12 months.',
        'Official advice, which changes: check the government\'s own page before travelling.',
      ].join('\n')
      return { text, data: { country, us, notices } }
    },
  },
  {
    name: 'first_reporters',
    title: 'The outlets that report first',
    description: 'The news outlets that most often reported a story first, in the last days (7 by default, up to 14), among the stories at least 5 outlets went on to report (2 to 50): each outlet with how many stories it was first on, its kind and its country, from WorldPulse\'s outlet directory. First in WorldPulse\'s reading of feeds and GDELT\'s articles, not proof of a scoop.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 14, default: 7, description: 'How many days back (1 to 14, default 7)' },
        min_outlets: { type: 'integer', minimum: 2, maximum: 50, default: 5, description: 'Only stories at least this many outlets reported (2 to 50, default 5)' },
        limit: { type: 'integer', minimum: 1, maximum: 30, default: 15, description: 'How many outlets (1 to 30, default 15)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const days = intArg(args, 'days', 7, 1, 14)
      const min = intArg(args, 'min_outlets', 5, 2, 50)
      const limit = intArg(args, 'limit', 15, 1, 30)
      const { status, body } = await ask(asker, `/api/v1/public/first-reporters?days=${days}&min_outlets=${min}`)
      if (status !== 200) throw new Error(`first reporters answered ${status}`)
      type Row = { site: string; name: string | null; country: string | null; kind: string | null; firsts: number }
      const d = (body.data ?? {}) as { stories?: number; outlets?: Row[] }
      // each outlet once by name: bbc.co.uk and bbc.com are the BBC
      const byName = new Map<string, Row & { sites: string[] }>()
      for (const r of d.outlets ?? []) {
        const key = r.name ?? r.site
        const had = byName.get(key)
        byName.set(key, had ? { ...had, firsts: had.firsts + r.firsts, sites: [...had.sites, r.site] } : { ...r, sites: [r.site] })
      }
      const rows = [...byName.values()].sort((a, b) => b.firsts - a.firsts).slice(0, limit)
      const stories = Number(d.stories ?? 0)
      const kind = (k: string | null) => (k ? String(OUTLET_KIND_LABELS[k as keyof typeof OUTLET_KIND_LABELS] ?? k).toLowerCase() : 'not in the directory')
      const text = rows.length === 0
        ? `No story in the last ${days} days reached ${min} outlets.`
        : [
          `The outlets first on a story, of the ${stories.toLocaleString('en-US')} stories of the last ${days} days that ${min} or more outlets reported (WorldPulse):`,
          ...rows.map((r, i) => `${i + 1}. ${r.name ?? r.site}: first on ${r.firsts} (${stories ? Math.round(100 * r.firsts / stories) : 0}%) · ${kind(r.kind)}${r.country ? `, ${countryLabel(r.country, false)}` : ''}`),
          'First in WorldPulse\'s reading (feeds every few minutes, GDELT\'s index), not proof of a scoop. A story\'s own order: story_timeline.',
        ].join('\n')
      return { text, data: { days, minOutlets: min, stories, outlets: rows.map(r => ({ name: r.name ?? r.site, sites: r.sites, kind: r.kind, country: r.country, firsts: r.firsts })) } }
    },
  },
  {
    name: 'verification_speed',
    title: 'How fast stories get verified',
    description: 'How long the stories that turned verified in the last hours (24 by default, up to 72) took to find a second, separate outlet after their first report: how many, the median time, how many within an hour and within a day, and the fastest and the slowest with their links. Verified means a second outlet reported the same event, not that every detail is right.',
    inputSchema: {
      type: 'object',
      properties: {
        hours: { type: 'integer', minimum: 1, maximum: 72, default: 24, description: 'How many hours back (1 to 72, default 24)' },
        limit: { type: 'integer', minimum: 1, maximum: 10, default: 5, description: 'How many of the fastest and slowest (1 to 10, default 5)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const hours = intArg(args, 'hours', 24, 1, 72)
      const limit = intArg(args, 'limit', 5, 1, 10)
      const { status, body } = await ask(asker, `/api/v1/public/verification-speed?hours=${hours}`)
      if (status !== 200) throw new Error(`verification speed answered ${status}`)
      type Story = { storyId: string; reportId: string; title: string; minutes: number }
      const d = (body.data ?? {}) as { verified?: number; medianMinutes?: number | null; withinHour?: number; withinDay?: number; fastest?: Story[]; slowest?: Story[] }
      const n = Number(d.verified ?? 0)
      const span = (m: number) => m < 60 ? `${m} min` : m < 2_880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1_440)} days`
      const pct = (x: number | undefined) => (n ? `${Math.round(100 * Number(x ?? 0) / n)}%` : '0%')
      const text = n === 0
        ? `No story turned verified in the last ${hours} hours.`
        : [
          `${n.toLocaleString('en-US')} stories turned verified in the last ${hours} hours (WorldPulse). Half found a second outlet within ${span(Number(d.medianMinutes ?? 0))} of their first report; ${pct(d.withinHour)} within an hour, ${pct(d.withinDay)} within a day.`,
          'Fastest:',
          ...(d.fastest ?? []).slice(0, limit).map((s, i) => `${i + 1}. ${s.title} · ${span(s.minutes)}\n   ${signalLink(s.reportId)}`),
          'Slowest:',
          ...(d.slowest ?? []).slice(0, limit).map((s, i) => `${i + 1}. ${s.title} · ${span(s.minutes)}\n   ${signalLink(s.reportId)}`),
        ].join('\n')
      return { text, data: { hours, verified: n, medianMinutes: d.medianMinutes ?? null, withinHour: d.withinHour ?? 0, withinDay: d.withinDay ?? 0, fastest: (d.fastest ?? []).slice(0, limit), slowest: (d.slowest ?? []).slice(0, limit) } }
    },
  },
  {
    name: 'topics_today',
    title: 'The topics of the news now',
    description: 'The topics of the news reports WorldPulse read in the last hours (24 by default, up to 72), the most first: conflict, politics, disaster, health, economy, elections, sports and the rest, each with its reports, how many are verified, and the change from the hours before. Machine feeds (aircraft, quakes, fires) are left out. For one topic\'s newest reports, use latest with its category.',
    inputSchema: {
      type: 'object',
      properties: { hours: { type: 'integer', minimum: 1, maximum: 72, default: 24, description: 'How many hours back (1 to 72, default 24)' } },
      additionalProperties: false,
    },
    async run(args, asker) {
      const hours = intArg(args, 'hours', 24, 1, 72)
      const { status, body } = await ask(asker, `/api/v1/public/topics?hours=${hours}`)
      if (status !== 200) throw new Error(`topics answered ${status}`)
      type Row = { topic: string; reports: number; verified: number; before: number }
      const rows = (((body.data ?? {}) as { topics?: Row[] }).topics ?? []).filter(r => r && r.reports > 0)
      const total = rows.reduce((s, r) => s + r.reports, 0)
      const label = (t: string) => (t === 'geopolitics' ? 'Politics' : t === 'other' ? 'Other' : cap(t))
      const change = (r: Row) => (r.before ? ` (${r.reports >= r.before ? '+' : ''}${Math.round(100 * (r.reports - r.before) / r.before)}% on the ${hours} hours before)` : '')
      const text = rows.length === 0
        ? `No news report in the last ${hours} hours.`
        : [
          `The topics of the last ${hours} hours' ${total.toLocaleString('en-US')} news reports (WorldPulse), the most first:`,
          ...rows.map((r, i) => `${i + 1}. ${label(r.topic)}: ${r.reports.toLocaleString('en-US')} (${Math.round(100 * r.reports / total)}%), ${r.verified.toLocaleString('en-US')} verified${change(r)}`),
        ].join('\n')
      return { text, data: { hours, reports: total, topics: rows.map(r => ({ topic: r.topic, label: label(r.topic), reports: r.reports, verified: r.verified, before: r.before })) } }
    },
  },
  {
    name: 'outlet_reports',
    title: 'One outlet\'s newest reports',
    description: 'A news outlet\'s newest reports in WorldPulse, by its website (e.g. bbc.co.uk, its subdomains too), from the last days (7 by default, up to 14): how many, and the newest, each with its status (verified or not yet), topic, place and link, and what the outlet directory knows of it. For what a website is, use outlet; to check a site, site_check.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', maxLength: 200, description: 'The outlet\'s website, e.g. lemonde.fr' },
        days: { type: 'integer', minimum: 1, maximum: 14, default: 7, description: 'How many days back (1 to 14, default 7)' },
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'How many reports (1 to 20, default 10)' },
      },
      required: ['site'],
      additionalProperties: false,
    },
    async run(args, asker) {
      const site = siteOf(strArg(args, 'site', { required: true, max: 200 })!)
      const days = intArg(args, 'days', 7, 1, 14)
      const limit = intArg(args, 'limit', 10, 1, 20)
      const { status, body } = await ask(asker, `/api/v1/public/outlet-reports?site=${encodeURIComponent(site)}&days=${days}`)
      if (status === 400) throw new ToolError('site must be a website, e.g. bbc.co.uk')
      if (status !== 200) throw new Error(`outlet reports answered ${status}`)
      type Report = { id: string; title: string; status: string; topic: string | null; country: string | null; at: string | null }
      const d = (body.data ?? {}) as { site?: string; total?: number; reports?: Report[] }
      const reports = (d.reports ?? []).slice(0, limit)
      const e = outletOf(d.site ?? site)
      const who = e ? `${e.name} (${String(OUTLET_KIND_LABELS[e.kind]).toLowerCase()}, ${countryLabel(e.country, false)}${e.state ? ', state media' : ''})` : `${d.site ?? site} (not in WorldPulse's outlet directory)`
      const text = reports.length === 0
        ? `No report from ${who} in the last ${days} days.`
        : [
          `${who}: ${Number(d.total ?? reports.length).toLocaleString('en-US')} report${d.total === 1 ? '' : 's'} in the last ${days} days, newest first:`,
          ...reports.map((r, i) => `${i + 1}. ${r.title}\n   ${[r.status === 'verified' ? 'Verified' : 'Not verified yet', r.topic === 'geopolitics' ? 'Politics' : cap(r.topic), r.country ? countryLabel(r.country, false) : '', agoLabel(r.at)].filter(Boolean).join(' · ')}\n   ${signalLink(r.id)}`),
        ].join('\n')
      return { text, data: { site: d.site ?? site, outlet: e ? { name: e.name, kind: e.kind, country: e.country, stateMedia: Boolean(e.state) } : null, days, total: Number(d.total ?? 0), reports: reports.map(r => ({ ...r, url: signalLink(r.id) })) } }
    },
  },
  {
    name: 'region_top_stories',
    title: 'A region\'s top stories',
    description: 'The top stories of a region of the world in the last hours (24 by default, up to 72): Africa, the Americas, Asia (the Caucasus too), Europe (Russia too), the Middle East (Egypt, Iran and Turkey to Yemen) or Oceania, ranked by how many independent outlets report them, how serious and how recent, each event once, with its outlets and link. Stories are a region\'s when one of their reports is placed in one of its countries.',
    inputSchema: {
      type: 'object',
      properties: {
        region: { type: 'string', enum: [...REGION_IDS], description: 'africa, americas, asia, europe, middle-east or oceania' },
        hours: { type: 'integer', minimum: 1, maximum: 72, default: 24, description: 'How many hours back (1 to 72, default 24)' },
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 8, description: 'How many stories (1 to 20, default 8)' },
      },
      required: ['region'],
      additionalProperties: false,
    },
    async run(args, asker) {
      const given = strArg(args, 'region', { required: true, max: 20 })!.toLowerCase().replace(/[\s_]+/g, '-').replace(/^the-/, '')
      const region = (given === 'middleeast' || given === 'mideast' ? 'middle-east' : given) as RegionId
      if (!REGION_IDS.includes(region)) throw new ToolError(`region must be one of ${REGION_IDS.join(', ')}`)
      const hours = intArg(args, 'hours', 24, 1, 72)
      const limit = intArg(args, 'limit', 8, 1, 20)
      const { status, body } = await ask(asker, `/api/v1/stories?hours=${hours}&limit=${limit}&region=${region}`)
      if (status !== 200) throw new Error(`stories answered ${status}`)
      const stories = (((body.data ?? {}) as { stories?: ListedStory[] }).stories ?? []).filter(s => s && typeof s.title === 'string')
      const label = REGIONS[region].label
      const text = stories.length === 0
        ? `No story of ${label} at least two outlets reported in the last ${hours} hours.`
        : [`The top stories of ${label} in the last ${hours} hours (WorldPulse):`, ...stories.map(storyLine)].join('\n')
      return { text, data: { region, label, hours, stories: stories.map(storyOut) } }
    },
  },
  {
    name: 'rising_stories',
    title: 'New stories spreading fast',
    description: 'The stories that began in the last hours (6 by default, up to 24) and are already reported by the most outlets: news that is breaking out now, each with how long ago its first report came, how many outlets carry it already, whether it is verified, and its link. For the biggest stories whatever their age, use top_stories.',
    inputSchema: {
      type: 'object',
      properties: {
        hours: { type: 'integer', minimum: 1, maximum: 24, default: 6, description: 'Began in the last hours (1 to 24, default 6)' },
        limit: { type: 'integer', minimum: 1, maximum: 15, default: 8, description: 'How many stories (1 to 15, default 8)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const hours = intArg(args, 'hours', 6, 1, 24)
      const limit = intArg(args, 'limit', 8, 1, 15)
      const { status, body } = await ask(asker, `/api/v1/stories?hours=${hours}&limit=20`)
      if (status !== 200) throw new Error(`stories answered ${status}`)
      const since = Date.now() - hours * 3_600_000
      const stories = (((body.data ?? {}) as { stories?: ListedStory[] }).stories ?? [])
        .filter(s => s && typeof s.title === 'string' && s.firstSeenAt && Date.parse(s.firstSeenAt) >= since)
        .sort((a, b) => b.outletCount - a.outletCount)
        .slice(0, limit)
      const text = stories.length === 0
        ? `No story that began in the last ${hours} hours has reached two outlets yet.`
        : [
          `Stories that began in the last ${hours} hours, the most outlets first (WorldPulse):`,
          ...stories.map((s, i) => `${i + 1}. ${s.title}\n   First report ${agoLabel(s.firstSeenAt)} · ${s.outletCount} outlets already${s.verifiedAt ? ' · verified' : ' · not verified yet'}${s.place ? ` · ${s.place}` : ''}\n   ${signalLink(s.leadId)} (story id ${s.id})`),
        ].join('\n')
      return { text, data: { hours, stories: stories.map(storyOut) } }
    },
  },
  {
    name: 'thin_coverage',
    title: 'The places WorldPulse reads few newsrooms in',
    description: 'The countries and territories where WorldPulse reads the feeds of the fewest newsrooms based there (3 or fewer by default), by region: their own stories rest on few voices, so outlets from abroad, GDELT\'s articles and the second-outlet search carry more of their news. From WorldPulse\'s outlet directory; a place\'s newsrooms: who_covers.',
    inputSchema: {
      type: 'object',
      properties: {
        at_most: { type: 'integer', minimum: 0, maximum: 5, default: 3, description: 'Newsrooms read there, at most (0 to 5, default 3)' },
        region: { type: 'string', enum: [...REGION_IDS], description: 'Only one region: africa, americas, asia, europe, middle-east or oceania' },
      },
      additionalProperties: false,
    },
    async run(args) {
      const most = intArg(args, 'at_most', 3, 0, 5)
      const only = strArg(args, 'region', { max: 20 })?.toLowerCase() as RegionId | undefined
      if (only && !REGION_IDS.includes(only)) throw new ToolError(`region must be one of ${REGION_IDS.join(', ')}`)
      const regions = (only ? [only] : REGION_IDS).map(id => {
        const places = regionCountries(id).map(code => ({ code, name: countryLabel(code, false), newsrooms: newsroomsIn(code) }))
          .filter(p => p.newsrooms <= most)
          .sort((a, b) => a.newsrooms - b.newsrooms || a.name.localeCompare(b.name))
        return { id, label: REGIONS[id].label, places }
      })
      const count = new Set(regions.flatMap(r => r.places.map(p => p.code))).size
      const text = [
        `${count} places where WorldPulse reads the feeds of ${most === 0 ? 'no newsroom' : `${most} or fewer newsrooms`} based there${only ? `, in ${REGIONS[only].label}` : ''}:`,
        ...regions.filter(r => r.places.length).map(r => `- ${cap(r.label.replace(/^the /, ''))}: ${r.places.map(p => `${p.name} (${p.newsrooms})`).join(', ')}`),
        'Their news also comes from outlets abroad and GDELT\'s articles. One place\'s newsrooms: who_covers.',
      ].join('\n')
      return { text, data: { atMost: most, places: count, regions: regions.map(r => ({ id: r.id, label: r.label, places: r.places })) } }
    },
  },
  // ── Nov 10, 2026, night: round 3 of 6, the government and science feeds and three news watches ──
  feedTool({
    name: 'sanctions_actions',
    title: 'New sanctions actions',
    description: 'New sanctions actions of the US Treasury (its Office of Foreign Assets Control, OFAC) and the European Union: people, companies, ships and countries added, removed or changed, newest first, in the last days (7 by default, up to 30), one country\'s when asked, each with its date, a line of what was decided and its links (the government\'s own notice among them).',
    feed: 'sanctions', source: 'OFAC and the EU', none: 'No US Treasury or EU sanctions action',
  }),
  feedTool({
    name: 'us_weather_alerts',
    title: 'US severe weather alerts',
    description: 'Severe weather alerts of the US National Weather Service (tornado, hurricane, flood, winter storm, extreme heat and other warnings), newest first, in the last days (7 by default, up to 30), each with its area, date, a line of the warning and its links. For the United States only; elsewhere, use hazards or disaster_news.',
    feed: 'us-weather', source: 'the US National Weather Service', none: 'No severe weather alert from the US National Weather Service',
  }),
  feedTool({
    name: 'carrier_groups',
    title: 'Where the US Navy\'s carriers are',
    description: 'Where the US Navy\'s aircraft carriers were last reported, from the carrier tracker WorldPulse reads: each carrier once, its latest report (deployment, port arrival, exercise) with its area and date, in the last days (7 by default, up to 30). Reported positions, often days old, not live tracks.',
    feed: 'carriers', source: 'the carrier tracker', none: 'No carrier report', onePer: title => title.split(':')[0]!.trim(),
  }),
  watchTool({
    name: 'cyber_attacks',
    title: 'Cyber attacks in the news',
    description: 'Cyber attacks in the news, by country: the last days\' news reports (7 by default, up to 14) whose headline names hackers, ransomware, a data breach, DDoS, malware, phishing or spyware, in English, French, Spanish, Portuguese, German, Russian or Arabic, the countries with the most first, each with its newest verified headline. For the software flaws attackers use, exploited_vulnerabilities.',
    watch: 'cyber', what: 'cyber attacks',
  }),
  watchTool({
    name: 'elections_watch',
    title: 'Elections in the news',
    description: 'Where elections are in the news: the countries with the most election reports in the last days (7 by default, up to 14), each with how many are verified and its newest verified headline: votes, campaigns, results, disputes and electoral reforms, as WorldPulse\'s topic reader files them.',
    watch: 'elections', what: 'elections',
  }),
  watchTool({
    name: 'disaster_news',
    title: 'Disasters in the news',
    description: 'Disasters in the news, by country: the last days\' news reports (7 by default, up to 14) WorldPulse files as disasters (floods, fires, storms, crashes, collapses, shipwrecks), the countries with the most first, each with its newest verified headline. For hazards measured by sensors (quakes, volcanoes, tsunamis), use hazards.',
    watch: 'disasters', what: 'disasters',
  }),
  {
    name: 'state_media_stories',
    title: 'Top stories carried by state media',
    description: 'How much of each top story\'s coverage comes from state media (outlets a government runs, from WorldPulse\'s outlet directory): of the last hours\' top stories (24 by default, up to 72), each with its outlets in its last two days, how many are state media and which, the most state-carried first. A story carried mostly by state media, and little by independent outlets, is one to read with care.',
    inputSchema: {
      type: 'object',
      properties: {
        hours: { type: 'integer', minimum: 1, maximum: 72, default: 24, description: 'How many hours back (1 to 72, default 24)' },
        limit: { type: 'integer', minimum: 1, maximum: 10, default: 10, description: 'How many top stories to look at (1 to 10, default 10)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const hours = intArg(args, 'hours', 24, 1, 72)
      const limit = intArg(args, 'limit', 10, 1, 10)
      const { status, body } = await ask(asker, `/api/v1/stories?hours=${hours}&limit=${limit}`)
      if (status !== 200) throw new Error(`stories answered ${status}`)
      const stories = (((body.data ?? {}) as { stories?: ListedStory[] }).stories ?? []).filter(s => s && UUID.test(String(s.leadId)))
      type Info = { site: string; name: string | null; country: string | null; stateMedia: boolean }
      const looked = await Promise.all(stories.map(async s => {
        const one = await ask(asker, `/api/v1/stories/${s.leadId}`)
        const d = (one.status === 200 ? one.body.data ?? {} : {}) as { outletNames?: string[]; outletInfo?: Info[] }
        const info: Info[] = d.outletInfo ?? siteInfo(d.outletNames ?? [])
        const byName = new Map<string, Info>()
        for (const o of info) if (!byName.has(o.name ?? o.site)) byName.set(o.name ?? o.site, o)
        const state = [...byName.entries()].filter(([, o]) => o.stateMedia).map(([name, o]) => `${name}${o.country ? ` (${countryLabel(o.country, false)})` : ''}`)
        return { story: s, outlets: byName.size, state }
      }))
      const order = looked.filter(x => x.outlets > 0).sort((a, b) => b.state.length / b.outlets - a.state.length / a.outlets || b.state.length - a.state.length)
      const pct = (x: (typeof order)[number]) => Math.round(100 * x.state.length / x.outlets)
      const text = order.length === 0
        ? `No top story in the last ${hours} hours.`
        : [
          `State media in the last ${hours} hours' top ${order.length} stories (WorldPulse's outlet directory), the most state-carried first:`,
          ...order.map((x, i) => `${i + 1}. ${x.story.title}\n   ${x.state.length} of ${x.outlets} outlets are state media (${pct(x)}%)${x.state.length ? `: ${x.state.slice(0, 5).join(', ')}${x.state.length > 5 ? `, and ${x.state.length - 5} more` : ''}` : ''}${pct(x) > 50 ? ' · mostly state media: read with care' : ''}\n   ${signalLink(x.story.leadId)}`),
          'One story by kind of outlet: outlet_mix.',
        ].join('\n')
      return { text, data: { hours, stories: order.map(x => ({ id: x.story.id, title: x.story.title, url: signalLink(x.story.leadId), outlets: x.outlets, stateMedia: x.state, stateShare: pct(x) / 100 })) } }
    },
  },
  {
    name: 'country_topics',
    title: 'What a country\'s news is about',
    description: 'The topics of one country\'s news reports in the last hours (24 by default, up to 72), the most first: politics, conflict, economy, disaster, health, sports and the rest, each with its reports, how many are verified and the change from the hours before. Reports placed in the country, from its own press and outlets abroad. The world\'s topics: topics_today.',
    inputSchema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: 'A two-letter country code, e.g. NG' },
        hours: { type: 'integer', minimum: 1, maximum: 72, default: 24, description: 'How many hours back (1 to 72, default 24)' },
      },
      required: ['country'],
      additionalProperties: false,
    },
    async run(args, asker) {
      const country = strArg(args, 'country', { required: true, pattern: /^[A-Za-z]{2}$/, hint: 'must be a two-letter country code such as NG' })!.toUpperCase().replace(/^UK$/, 'GB')
      if (countryLabel(country, false) === country) throw new ToolError(`${country} is not a country code WorldPulse knows`)
      const hours = intArg(args, 'hours', 24, 1, 72)
      const { status, body } = await ask(asker, `/api/v1/public/topics?hours=${hours}&country=${country}`)
      if (status !== 200) throw new Error(`topics answered ${status}`)
      type Row = { topic: string; reports: number; verified: number; before: number }
      const rows = (((body.data ?? {}) as { topics?: Row[] }).topics ?? []).filter(r => r && r.reports > 0)
      const total = rows.reduce((s, r) => s + r.reports, 0)
      const label = (t: string) => (t === 'geopolitics' ? 'Politics' : t === 'other' ? 'Other' : cap(t))
      const text = rows.length === 0
        ? `No news report placed in ${countryLabel(country, true)} in the last ${hours} hours.`
        : [
          `What ${countryLabel(country, true)}'s news is about: the last ${hours} hours' ${total.toLocaleString('en-US')} reports placed there (WorldPulse), the most first:`,
          ...rows.map((r, i) => `${i + 1}. ${label(r.topic)}: ${r.reports} (${Math.round(100 * r.reports / total)}%), ${r.verified} verified${r.before ? ` (${r.reports >= r.before ? '+' : ''}${Math.round(100 * (r.reports - r.before) / r.before)}% on the ${hours} hours before)` : ''}`),
          `Its stories: country. Page: ${SITE}/countries/${country.toLowerCase()}`,
        ].join('\n')
      return { text, data: { country, hours, reports: total, topics: rows.map(r => ({ ...r, label: label(r.topic) })) } }
    },
  },
  {
    name: 'busiest_outlets',
    title: 'The outlets with the most reports now',
    description: 'The news outlets (websites) WorldPulse read the most reports from in the last hours (24 by default, up to 72), the most first, each with its reports, how many turned verified, its kind and country and whether a government runs it (state media), from WorldPulse\'s outlet directory. A busy outlet publishes much, which is not the same as being first (first_reporters) or reliable (site_check).',
    inputSchema: {
      type: 'object',
      properties: {
        hours: { type: 'integer', minimum: 1, maximum: 72, default: 24, description: 'How many hours back (1 to 72, default 24)' },
        limit: { type: 'integer', minimum: 1, maximum: 30, default: 15, description: 'How many outlets (1 to 30, default 15)' },
      },
      additionalProperties: false,
    },
    async run(args, asker) {
      const hours = intArg(args, 'hours', 24, 1, 72)
      const limit = intArg(args, 'limit', 15, 1, 30)
      const { status, body } = await ask(asker, `/api/v1/public/busiest-outlets?hours=${hours}`)
      if (status !== 200) throw new Error(`busiest outlets answered ${status}`)
      type Row = { site: string; name: string | null; country: string | null; kind: string | null; stateMedia: boolean; reports: number; verified: number }
      const d = (body.data ?? {}) as { reports?: number; outlets?: Row[] }
      // each outlet once by name: bbc.co.uk and bbc.com are the BBC
      const byName = new Map<string, Row & { sites: string[] }>()
      for (const r of d.outlets ?? []) {
        const key = r.name ?? r.site
        const had = byName.get(key)
        byName.set(key, had ? { ...had, reports: had.reports + r.reports, verified: had.verified + r.verified, sites: [...had.sites, r.site] } : { ...r, sites: [r.site] })
      }
      const rows = [...byName.values()].sort((a, b) => b.reports - a.reports).slice(0, limit)
      const total = Number(d.reports ?? 0)
      const kind = (k: string | null) => (k ? String(OUTLET_KIND_LABELS[k as keyof typeof OUTLET_KIND_LABELS] ?? k).toLowerCase() : 'not in the directory')
      const text = rows.length === 0
        ? `No news report in the last ${hours} hours.`
        : [
          `The outlets WorldPulse read the most from in the last ${hours} hours (${total.toLocaleString('en-US')} news reports in all), the most first:`,
          ...rows.map((r, i) => `${i + 1}. ${r.name ?? r.site}: ${r.reports.toLocaleString('en-US')} reports, ${r.verified.toLocaleString('en-US')} verified · ${kind(r.kind)}${r.country ? `, ${countryLabel(r.country, false)}` : ''}${r.stateMedia ? ', state media' : ''}`),
        ].join('\n')
      return { text, data: { hours, reports: total, outlets: rows.map(r => ({ name: r.name ?? r.site, sites: r.sites, kind: r.kind, country: r.country, stateMedia: r.stateMedia, reports: r.reports, verified: r.verified })) } }
    },
  },
  {
    name: 'local_only_stories',
    title: 'Stories only a country\'s own press reports',
    description: 'A country\'s stories that only its own newsrooms are reporting, with no outlet from abroad yet, in the last hours (24 by default, up to 72): what the world may be missing there, each with its outlets and link. The opposite of local_press, which finds stories the world reports and the local press doesn\'t. Needs at least two of its outlets, so a lone report is in unconfirmed instead.',
    inputSchema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: 'A two-letter country code, e.g. PE' },
        hours: { type: 'integer', minimum: 1, maximum: 72, default: 24, description: 'How many hours back (1 to 72, default 24)' },
        limit: { type: 'integer', minimum: 1, maximum: 15, default: 8, description: 'How many stories (1 to 15, default 8)' },
      },
      required: ['country'],
      additionalProperties: false,
    },
    async run(args, asker) {
      const country = strArg(args, 'country', { required: true, pattern: /^[A-Za-z]{2}$/, hint: 'must be a two-letter country code such as PE' })!.toUpperCase().replace(/^UK$/, 'GB')
      if (countryLabel(country, false) === country) throw new ToolError(`${country} is not a country code WorldPulse knows`)
      const hours = intArg(args, 'hours', 24, 1, 72)
      const limit = intArg(args, 'limit', 8, 1, 15)
      const { status, body } = await ask(asker, `/api/v1/stories?hours=${hours}&limit=20&country=${country}`)
      if (status !== 200) throw new Error(`stories answered ${status}`)
      const stories = (((body.data ?? {}) as { stories?: ListedStory[] }).stories ?? [])
        .filter(s => s && typeof s.title === 'string' && s.country === country && (s.countries ?? 0) <= 1 && (s.localOutlets ?? 0) >= 2 && (s.localOutlets ?? 0) >= s.outletCount)
        .slice(0, limit)
      const text = stories.length === 0
        ? `No story of ${countryLabel(country, true)} in the last ${hours} hours that only its own press reports (at least two of its outlets, none from abroad).`
        : [
          `Stories of ${countryLabel(country, true)} only its own press is reporting, the last ${hours} hours (WorldPulse):`,
          ...stories.map((s, i) => `${i + 1}. ${s.title}\n   ${s.outletCount} outlets, all based there${s.localNames?.length ? `: ${s.localNames.join(', ')}` : ''}${s.verifiedAt ? ' · verified' : ''}${s.place ? ` · ${s.place}` : ''}\n   ${signalLink(s.leadId)} (story id ${s.id})`),
          'What outlets abroad haven\'t picked up yet: a lead, not proof they missed it.',
        ].join('\n')
      return { text, data: { country, hours, stories: stories.map(storyOut) } }
    },
  },
]

/**
 * Ready-made asks (MCP prompts, Nov 8, 2026): assistants that show prompts offer them as one-click starters.
 * Each is a message to the assistant naming the tools to use; the arguments are checked like a tool's.
 */
interface Prompt {
  name: string
  title: string
  description: string
  arguments: Array<{ name: string; description: string; required: boolean }>
  text: (args: Record<string, string>) => string
}

export const PROMPTS: Prompt[] = [
  {
    name: 'morning_brief',
    title: 'Morning brief',
    description: 'The world this morning: WorldPulse\'s Daily Briefing and the stories the most outlets carry, with their counts and links',
    arguments: [],
    text: () => 'Brief me on the world with WorldPulse: call daily_brief, then top_stories for the last 24 hours. For each story say how many outlets carry it, how many countries they are from, whether it is verified, and give its world-pulse.io link. Keep it short.',
  },
  {
    name: 'check_this_link',
    title: 'Check this link',
    description: 'How many newsrooms reported the story behind a news link, which ones, and whether their numbers agree',
    arguments: [{ name: 'url', description: 'The article\'s address', required: true }],
    text: a => `Use WorldPulse's check_link on ${a.url}. Tell me how many outlets reported its story, whether it is verified, which outlets they are and where they are from (outlet). If the story gives numbers such as the dead or injured, use story_numbers and say whether its outlets agree.`,
  },
  {
    name: 'country_deep_dive',
    title: 'Country deep-dive',
    description: 'A country now: its stories, the newsrooms based there, and whether it is under-reported',
    arguments: [{ name: 'country', description: 'A two-letter country code, e.g. SD for Sudan', required: true }],
    text: a => `Use WorldPulse's country tool for ${a.country}, then open its top story with story and story_numbers. Tell me what is happening there, how many outlets report it and from where, and whether the country is among the under-reported crises. Give the world-pulse.io links.`,
  },
]

/** A prompt's arguments, checked: a known name, each required one given, and short and plain */
function promptArgs(p: Prompt, raw: unknown): Record<string, string> | string {
  const given = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const a of p.arguments) {
    const v = given[a.name]
    if (v === undefined || v === null || v === '') {
      if (a.required) return `${a.name} is required`
      continue
    }
    if (typeof v !== 'string' || v.length > 2048 || /[\u0000-\u001f]/.test(v)) return `${a.name} must be one line of text`
    if (a.name === 'country' && !/^[A-Za-z]{2}$/.test(v.trim())) return 'country must be a two-letter country code such as SD'
    out[a.name] = v.trim()
  }
  return out
}

interface RpcMessage { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }

const rpcResult = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result })
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

/** One JSON-RPC message: its answer, or null for a notification */
export async function handleMessage(m: unknown, asker: Asker): Promise<Record<string, unknown> | null> {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return rpcError(null, -32600, 'Invalid Request')
  const msg = m as RpcMessage
  const isRequest = 'id' in msg && msg.id !== undefined && msg.id !== null
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return isRequest ? rpcError(msg.id, -32600, 'Invalid Request') : null
  if (!isRequest) return null   // notifications (notifications/initialized, cancelled…) need no answer
  const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Record<string, unknown>

  switch (msg.method) {
    case 'initialize': {
      const asked = params.protocolVersion
      const version = PROTOCOL_VERSIONS.find(v => v === asked) ?? PROTOCOL_VERSIONS[0]
      return rpcResult(msg.id, { protocolVersion: version, capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS })
    }
    case 'ping':
      return rpcResult(msg.id, {})
    case 'tools/list':
      return rpcResult(msg.id, {
        tools: TOOLS.map(t => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, readOnlyHint: true, openWorldHint: false } })),
      })
    case 'prompts/list':
      return rpcResult(msg.id, { prompts: PROMPTS.map(p => ({ name: p.name, title: p.title, description: p.description, arguments: p.arguments })) })
    case 'prompts/get': {
      const prompt = PROMPTS.find(p => p.name === params.name)
      if (!prompt) return rpcError(msg.id, -32602, `Unknown prompt: ${String(params.name ?? '')}`)
      const args = promptArgs(prompt, params.arguments)
      if (typeof args === 'string') return rpcError(msg.id, -32602, args)
      return rpcResult(msg.id, { description: prompt.description, messages: [{ role: 'user', content: { type: 'text', text: prompt.text(args) } }] })
    }
    case 'tools/call': {
      const tool = TOOLS.find(t => t.name === params.name)
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${String(params.name ?? '')}`)
      asker.countTool?.(tool.name)
      const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>
      try {
        const { text, data } = await tool.run(args, asker)
        return rpcResult(msg.id, { content: [{ type: 'text', text }], structuredContent: data, isError: false })
      } catch (err) {
        const message = err instanceof ToolError ? err.message : 'WorldPulse could not answer just now; try again in a minute'
        if (!(err instanceof ToolError)) asker.app.log.warn({ err, tool: tool.name }, 'MCP tool failed')
        return rpcResult(msg.id, { content: [{ type: 'text', text: message }], isError: true })
      }
    }
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`)
  }
}

/**
 * How the interactive docs (/api/docs, lib/api-docs.ts) list this route:
 * public, like the other open routes (plan V3i). The body schema only
 * describes the message and gives "Try it out" an example: it sets no type
 * or rule, so it accepts every body the handler took before. The tools are
 * named from TOOLS, so a new tool is listed without anyone editing this.
 */
const TOOL_NAMES = TOOLS.map(t => t.name)
const POST_DOCS = {
  tags: ['mcp'],
  summary: 'MCP server for AI assistants (JSON-RPC 2.0)',
  description: [
    'WorldPulse for AI assistants such as Claude: the Model Context Protocol over HTTP. Read-only and open: no sign-in or key.',
    'Each POST carries one JSON-RPC 2.0 message or a batch of up to 20 (64 KB at most) and gets JSON back; a notification gets 202 with no body. There are no sessions and no event stream (GET and DELETE answer 405).',
    `Its tools: ${TOOL_NAMES.slice(0, -1).join(', ')} and ${TOOL_NAMES[TOOL_NAMES.length - 1]}. Each asks the API's own public routes, and those calls count against your limits on those routes too.`,
    `How to connect an assistant: ${SITE}/developers#mcp`,
  ].join('\n\n'),
  body: {
    description: 'One JSON-RPC 2.0 message (initialize, tools/list, tools/call, prompts/list, prompts/get, ping), or an array of up to 20',
    examples: [{ jsonrpc: '2.0', id: 1, method: 'tools/list' }],
  },
}

export const registerMcpRoutes: FastifyPluginAsync = async (app) => {
  app.post('/', {
    schema: POST_DOCS,
    bodyLimit: 64 * 1024,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = req.body as unknown
    const batch = Array.isArray(body)
    const messages = batch ? (body as unknown[]) : [body]
    if (messages.length === 0 || messages.length > 20) return reply.code(400).send(rpcError(null, -32600, 'Invalid Request'))
    // tool calls count as use from outside when the POST itself does (not the website's, not WorldPulse's own checks)
    const outside = isOutsideUse(req, 200) && !isOwnCheck(req.headers['user-agent'])
    const asker: Asker = { app, client: rateLimitKey(req), countTool: outside ? tool => { void countMcpTool(redis, tool) } : undefined }
    const answers: Array<Record<string, unknown>> = []
    for (const m of messages) {
      const a = await handleMessage(m, asker)
      if (a) answers.push(a)
    }
    if (answers.length === 0) return reply.code(202).send()
    return reply.header('content-type', 'application/json; charset=utf-8').send(batch ? answers : answers[0])
  })

  // No event stream and no sessions: one POST, one answer
  for (const method of ['GET', 'DELETE'] as const) {
    app.route({
      method, url: '/', schema: { hide: true }, config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      handler: async (_req, reply) => reply.code(405).header('allow', 'POST').send(rpcError(null, -32000, 'Use POST with JSON-RPC messages')),
    })
  }
}
