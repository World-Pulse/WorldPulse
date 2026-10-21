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

const SITE = (process.env.SITE_URL || 'https://world-pulse.io').replace(/\/+$/, '')

/** Protocol versions this server speaks, newest first */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const

const SERVER_INFO = { name: 'worldpulse', title: 'WorldPulse', version: '1.0.0' }

const INSTRUCTIONS = [
  'WorldPulse groups news reports of one event into one story and counts the outlets (websites) that report it. A story\'s count covers its last two days; a story that has run longer also gives how many outlets have reported it since it began.',
  'A story is "verified" when two or more outlets report it and its reliability score reaches 65%; verified means more than one outlet says so, not proven true (https://world-pulse.io/how-we-count).',
  'Cite stories with their world-pulse.io links. Start with top_stories; open one with story; find reports on a subject with search_reports; a week at a glance with week; how many outlets reported an article someone shared with check_link.',
].join(' ')

interface ToolResult { text: string; data: Record<string, unknown> }

/** The API, and the rate-limit key of the client asking */
export interface Asker { app: FastifyInstance; client: string }

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

const signalLink = (id: unknown) => `${SITE}/signals/${String(id)}`

interface ListedStory {
  id: string; leadId: string; title: string; place: string | null; category: string | null; severity: string
  outletCount: number; outletCountAll?: number; outlets?: string[]; verifiedAt: string | null; updatedAt?: string; firstSeenAt?: string
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
    + sinceNote(s.outletCount, s.outletCountAll, s.firstSeenAt)
  const where = [s.place, s.category, s.severity].filter(Boolean).join(', ')
  const names = s.outlets?.length ? ` · ${s.outlets.slice(0, 5).join(', ')}${s.outlets.length > 5 ? ', …' : ''}` : ''
  return `${i + 1}. ${s.title}\n   ${proof}${where ? ` · ${where}` : ''}${names}\n   ${signalLink(s.leadId)} (story id ${s.id})`
}

const storyOut = (s: ListedStory) => ({
  id: s.id, title: s.title, url: signalLink(s.leadId), leadReportId: s.leadId, place: s.place, category: s.category,
  severity: s.severity, outlets: s.outletCount, outletsAll: s.outletCountAll ?? s.outletCount, outletNames: s.outlets ?? [], verified: Boolean(s.verifiedAt),
  verifiedAt: s.verifiedAt, firstSeenAt: s.firstSeenAt ?? null, updatedAt: s.updatedAt ?? null,
})

export const TOOLS: Tool[] = [
  {
    name: 'top_stories',
    title: 'Top stories now',
    description: 'The stories the most independent outlets are reporting in the last hours, ranked by outlets, severity and how recent, each event once. Each story says how many outlets (websites) carry it, whether it is verified, where, and links to its page. Give country (a two-letter code such as NG or FR) for one country\'s stories.',
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
    description: 'One story: every outlet (website) that reported it, when it turned verified, and its reports in order (the first ones and the latest ones for a big story), each with its outlet, link and time. Takes a story id or a report id, as top_stories, week and search_reports give them.',
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
        signals?: Array<{ id: string; title: string; status: string; outlet: string; url: string | null; createdAt: string | null; locationName: string | null }>
      }
      const reports = d.signals ?? []
      const first = reports[0]
      const lines = reports.map(r => `- ${r.createdAt ? r.createdAt.slice(0, 16).replace('T', ' ') + ' UTC' : ''} · ${r.outlet || 'unknown outlet'} · ${r.title}${r.url ? `\n  ${r.url}` : ''}`)
      const text = [
        first?.title ?? 'Story',
        `${d.verifiedAt ? `Verified ${d.verifiedAt.slice(0, 16).replace('T', ' ')} UTC` : 'Not verified yet'} · ${d.outlets ?? 0} outlets in its last two days${sinceNote(d.outlets ?? 0, d.outletsAll, d.firstReportAt)} · ${d.size ?? reports.length} reports`,
        ...(d.outletNames?.length ? [`Outlets: ${d.outletNames.join(', ')}`] : []),
        `Page: ${signalLink(first?.id ?? id)}`,
        '',
        'Reports:',
        ...lines,
      ].join('\n')
      return {
        text,
        data: {
          storyId: d.storyId ?? id, url: signalLink(first?.id ?? id), verifiedAt: d.verifiedAt ?? null, outlets: d.outlets ?? 0,
          outletNames: d.outletNames ?? [], reports: d.size ?? reports.length,
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
        ...(d.match === 'similar' ? [`WorldPulse has not collected this article; its headline${d.page?.title ? ` ("${d.page.title}")` : ''} tells the same event as this story:`] : []),
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
]

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
      return rpcResult(msg.id, { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS })
    }
    case 'ping':
      return rpcResult(msg.id, {})
    case 'tools/list':
      return rpcResult(msg.id, {
        tools: TOOLS.map(t => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, readOnlyHint: true, openWorldHint: false } })),
      })
    case 'tools/call': {
      const tool = TOOLS.find(t => t.name === params.name)
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${String(params.name ?? '')}`)
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
    description: 'One JSON-RPC 2.0 message (initialize, tools/list, tools/call, ping), or an array of up to 20',
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
    const asker: Asker = { app, client: rateLimitKey(req) }
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
