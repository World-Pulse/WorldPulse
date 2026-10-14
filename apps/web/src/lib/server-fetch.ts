/**
 * GET requests from the website's server to the API, kept in this process for
 * a few seconds (plan D3, Oct 13, 2026).
 *
 * Pages are rendered on demand (the root layout is force-dynamic), which also
 * turns off fetch()'s own cache: the `next: { revalidate }` options on these
 * calls did nothing. So every story page view made three API calls, all from
 * the website server's one address, which shares one rate-limit budget (60 a
 * minute for a story, 200 for everything): a story going round social media
 * would have run it out and its page would have failed. Now a popular page
 * costs one call per few seconds, and a burst of simultaneous views shares a
 * single call.
 *
 * Kept: answers 200-299 and 404 (a missing story stays missing for a few
 * seconds). Not kept: errors and refusals (429, 5xx) and network failures, so
 * a moment's trouble isn't repeated to the next visitor.
 */

interface Kept { at: number; status: number; body: string; type: string }

const kept = new Map<string, Kept>()
const inFlight = new Map<string, Promise<Kept>>()
let keptChars = 0

/** Answers kept at most, and their total size (characters); the oldest go first */
const MAX_KEPT = 1_000
const MAX_KEPT_CHARS = 16_000_000

function forget(url: string): void {
  const old = kept.get(url)
  if (!old) return
  keptChars -= old.body.length
  kept.delete(url)
}

function remember(url: string, entry: Kept): void {
  forget(url)
  if (entry.body.length > MAX_KEPT_CHARS / 8) return // too big to keep
  kept.set(url, entry)
  keptChars += entry.body.length
  while (kept.size > MAX_KEPT || keptChars > MAX_KEPT_CHARS) {
    const oldest = kept.keys().next().value
    if (oldest === undefined) break
    forget(oldest)
  }
}

const keepable = (status: number) => (status >= 200 && status < 300) || status === 404

/** Statuses an answer can't have a body with: new Response('', { status: 204 }) throws */
const NO_BODY = new Set([101, 103, 204, 205, 304])

const asResponse = (k: Kept) =>
  new Response(NO_BODY.has(k.status) ? null : k.body, { status: k.status, headers: { 'content-type': k.type } })

/**
 * fetch(url) for a GET whose answer may be reused for `ttlMs` milliseconds.
 * `timeoutMs` bounds one call to the API (default 10 s).
 */
export async function cachedFetch(url: string, ttlMs: number, timeoutMs = 10_000): Promise<Response> {
  const hit = kept.get(url)
  if (hit && Date.now() - hit.at < ttlMs) return asResponse(hit)

  let pending = inFlight.get(url)
  if (!pending) {
    pending = (async () => {
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
      const entry: Kept = {
        at: Date.now(),
        status: res.status,
        body: await res.text(),
        type: res.headers.get('content-type') ?? 'application/json',
      }
      if (keepable(entry.status)) remember(url, entry)
      return entry
    })()
    inFlight.set(url, pending)
    pending.finally(() => inFlight.delete(url)).catch(() => {})
  }
  return asResponse(await pending)
}

/** (tests) forget everything kept */
export function clearServerFetchCache(): void {
  kept.clear()
  inFlight.clear()
  keptChars = 0
}
