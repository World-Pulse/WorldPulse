/**
 * The AI companies' servers (Devon, Nov 21, 2026, 11:14 PM: "Proceed with all 3", the listing kit's decision 1).
 *
 * When someone uses WorldPulse inside Claude or ChatGPT, the questions come from the company's servers, not from
 * the person's computer, so everyone using that app shared one address's allowance: the AI tools allow 60 requests
 * a minute per address, and a dozen people asking at once would have got "too many requests". Requests from the
 * addresses these companies publish for this now get 600 a minute (a Pro key's budget), each address counted on
 * its own, on the AI tools and on the routes their tools ask (lib/rate-limit-options.ts, lib/api-plan.ts,
 * routes/mcp.ts). Everyone else keeps today's limits, and endpoints that change things keep theirs.
 *
 * - Anthropic: the outbound ranges on platform.claude.com/docs/en/api/ip-addresses (read Nov 21, 2026), which
 *   Claude uses for MCP tool calls to outside servers.
 * - OpenAI: https://openai.com/chatgpt-connectors.json, the addresses ChatGPT's connectors and apps call from.
 *   OpenAI says the list changes, so the API reads it when it starts and every 12 hours; a failed read keeps the
 *   last list it had.
 *
 * The address is the one the rate limiter already counts (lib/client-address.ts: the one nginx or Cloudflare saw),
 * so a client can't claim one of these addresses with a header. IPv4 only: an IPv6 range in OpenAI's list is skipped.
 */

import type { FastifyBaseLogger } from 'fastify'

export const AI_PLATFORM_PER_MINUTE = 600
export const ANTHROPIC_OUTBOUND = ['160.79.104.0/21', '153.61.208.0/20'] as const
export const OPENAI_CONNECTORS_URL = 'https://openai.com/chatgpt-connectors.json'
export const OPENAI_REFRESH_MS = 12 * 3_600_000

export type AiPlatform = 'anthropic' | 'openai'
/** First and last address of a range, as numbers */
type Range = readonly [number, number]

/** An IPv4 address as a number (an IPv4-mapped IPv6 address too), else null */
export function ipv4ToInt(ip: string): number | null {
  const s = ip.trim().replace(/^::ffff:/i, '')
  const parts = s.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const v = Number(p)
    if (v > 255) return null
    n = n * 256 + v
  }
  return n
}

/** "160.79.104.0/21" as its first and last address, else null */
export function parseCidr(cidr: string): Range | null {
  const m = /^([\d.]+)\/(\d{1,2})$/.exec(String(cidr).trim())
  if (!m) return null
  const base = ipv4ToInt(m[1]!)
  const bits = Number(m[2])
  if (base === null || bits > 32) return null
  const size = 2 ** (32 - bits)
  const first = Math.floor(base / size) * size
  return [first, first + size - 1]
}

const ANTHROPIC_RANGES: Range[] = ANTHROPIC_OUTBOUND.map(parseCidr).filter((r): r is Range => r !== null)
let openaiRanges: Range[] = []
let openaiReadAt: string | null = null

/** The IPv4 ranges in OpenAI's list ({creationTime, prefixes: [{ipv4Prefix} | {ipv6Prefix}]}) */
export function openAiRanges(json: unknown): Range[] {
  const list = (json as { prefixes?: unknown } | null)?.prefixes
  if (!Array.isArray(list)) return []
  const out: Range[] = []
  for (const p of list) {
    const cidr = typeof p === 'string' ? p : (p as { ipv4Prefix?: unknown } | null)?.ipv4Prefix
    const r = typeof cidr === 'string' ? parseCidr(cidr) : null
    if (r) out.push(r)
  }
  return out
}

/** Replace OpenAI's ranges (the refresh, and tests) */
export function setOpenAiRanges(ranges: Range[], at: string | null = new Date().toISOString()): void {
  openaiRanges = ranges
  openaiReadAt = at
}

const inRanges = (n: number, ranges: readonly Range[]) => ranges.some(([a, b]) => n >= a && n <= b)

/** Which AI company's published servers an address belongs to, or null */
export function aiPlatformOfIp(ip: string): AiPlatform | null {
  const n = ipv4ToInt(ip)
  if (n === null) return null
  if (inRanges(n, ANTHROPIC_RANGES)) return 'anthropic'
  if (inRanges(n, openaiRanges)) return 'openai'
  return null
}

/** The same for a rate-limit key ("ip:<address>"; a signed-in user's "user:<id>" is nobody's server) */
export function aiPlatformOfKey(key: string): AiPlatform | null {
  return key.startsWith('ip:') ? aiPlatformOfIp(key.slice(3)) : null
}

/** Read OpenAI's list; on any failure keep the last one. Returns how many ranges are held. */
export async function refreshOpenAiRanges(fetchImpl: typeof fetch = fetch): Promise<number> {
  const res = await fetchImpl(OPENAI_CONNECTORS_URL, {
    headers: { 'user-agent': 'WorldPulse/1.0 (+https://world-pulse.io; rate limits for ChatGPT connectors)', accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const ranges = openAiRanges(await res.json())
  // an empty or unreadable list is a failed read, not "OpenAI has no servers"
  if (ranges.length === 0) throw new Error('no IPv4 ranges in the list')
  setOpenAiRanges(ranges)
  return ranges.length
}

/** Read OpenAI's list now and every 12 hours; returns a stop function */
export function startOpenAiRefresh(log: Pick<FastifyBaseLogger, 'info' | 'warn'>, fetchImpl: typeof fetch = fetch): () => void {
  const run = () => {
    refreshOpenAiRanges(fetchImpl)
      .then(n => log.info({ ranges: n }, 'ai platforms: read OpenAI\'s connector addresses'))
      .catch(err => log.warn({ err: String(err), kept: openaiRanges.length }, 'ai platforms: could not read OpenAI\'s connector addresses; kept the last list'))
  }
  run()
  const timer = setInterval(run, OPENAI_REFRESH_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

/** What the allowance covers now (GET /api/v1/public/ai-tools shows it) */
export function aiPlatformStatus(): { perMinute: number; anthropic: { ranges: number }; openai: { ranges: number; readAt: string | null } } {
  return {
    perMinute: AI_PLATFORM_PER_MINUTE,
    anthropic: { ranges: ANTHROPIC_RANGES.length },
    openai: { ranges: openaiRanges.length, readAt: openaiReadAt },
  }
}
