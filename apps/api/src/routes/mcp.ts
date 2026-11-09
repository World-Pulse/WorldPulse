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

const SITE = (process.env.SITE_URL || 'https://world-pulse.io').replace(/\/+$/, '')

/** Protocol versions this server speaks, newest first */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const

const SERVER_INFO = { name: 'worldpulse', title: 'WorldPulse', version: '1.3.0' }

const INSTRUCTIONS = [
  'WorldPulse groups news reports of one event into one story and counts the outlets (websites) that report it. A story\'s count covers its last two days; a story that has run longer also gives how many outlets have reported it since it began.',
  'A story is "verified" when two or more outlets report it and its reliability score reaches 65%; verified means more than one outlet says so, not proven true (https://world-pulse.io/how-we-count).',
  'Cite stories with their world-pulse.io links. Start with top_stories; open one with story; find reports on a subject with search_reports; a week at a glance with week; how many outlets reported an article someone shared with check_link; the crises with the fewest outlets for the people displaced with under_reported.',
  'Since Nov 8, 2026 also: story_numbers (each figure in a story, such as the dead, with how many outlets give it), outlet (what a news website is: its country, its kind, state media or not), near (the reports pinned near a place), country (a country right now), daily_brief (the Daily Briefing), entity (a person, organisation or place in the news), trend (how coverage of a country or an entity changed day by day) and check_claim (what the newsrooms report about a claim; it never rules true or false).',
  'And: breaking (the urgent reports of the last few hours), trending (who and what is in the news most), hotspots (where serious reports of several kinds meet), story_by_country (one story country by country: whose newsrooms carry it and how they headline it), shipping (ships, ports, straits and navies, near a chokepoint) and hazards (earthquakes, volcanoes, tsunamis, wildfires).',
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

/** An aircraft's transponder alarm ("Aircraft FDX382 squawking 7500 …"): an automatic reading, often wrong (Nov 8, 2026) */
const SQUAWK = /\bsquawk(?:ing)?\s+7[567]00\b/i

/**
 * Why a breaking alert isn't a news report, or null: the breaking list takes any critical or high report, so it also
 * holds aircraft transponder alarms, satellite and sensor readings (the hazards tool has those) and bylined opinion
 * pieces a word like "tsunami" made a disaster (Nov 8, 2026: 13 of the 20 live alerts)
 */
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

/** "the Strait of Hormuz", "Bab el-Mandeb" */
const theChokepoint = (c: { id: string; name: string }) => (c.id === 'bab-el-mandeb' ? c.name : `the ${c.name}`)

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
    description: 'The urgent reports of the last few hours: the critical and high-severity reports WorldPulse flagged as breaking (each stays up for 6 hours), newest first and each story once, each with its severity, kind, place, how long ago, how many outlets carry its story (verified or not yet) and its link. Left out: aircraft transponder alarms (squawk 7500, 7600, 7700: automatic readings, often wrong), satellite and sensor readings (wildfire detections, earthquakes: the hazards tool has them) and opinion pieces. A breaking report may come from one outlet so far: check its line before relying on it.',
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
      const why = live.map(a => notBreakingNews(a.title))
      const news = live.filter((_, i) => why[i] === null)
        .sort((x, y) => (Date.parse(String(y.timestamp)) || 0) - (Date.parse(String(x.timestamp)) || 0))
      const left = { transponder: why.filter(w => w === 'transponder').length, sensor: why.filter(w => w === 'sensor').length, opinion: why.filter(w => w === 'opinion').length }
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
      const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`
      const parts = [
        left.transponder ? n(left.transponder, 'aircraft transponder alarm', 'aircraft transponder alarms') : '',
        left.sensor ? `${n(left.sensor, 'satellite or sensor reading', 'satellite and sensor readings')} (see hazards)` : '',
        left.opinion ? n(left.opinion, 'opinion piece', 'opinion pieces') : '',
      ].filter(Boolean)
      const skipped = parts.length ? ` (left out: ${parts.join(', ')})` : ''
      const text = alerts.length === 0
        ? `No breaking report right now${skipped}. The stories the most outlets carry: top_stories. ${SITE}`
        : [
          `Breaking: the critical and high-severity reports of the last few hours, newest first${skipped}:`,
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
          leftOut: left,
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
