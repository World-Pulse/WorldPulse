/**
 * The map's day, asked again when it doesn't come (Nov 21, 2026).
 *
 * The replay (and the morning video, /map?play=24h) needs GET /api/v1/signals/map/timeline once. On Nov 20 and 21 at
 * 5:30 AM it didn't come back in time, the replay never started and the video wasn't made. A failed answer (a network
 * error, or a status other than 2xx) is now asked again after WAITS_MS[0], then WAITS_MS[1]; the last error is thrown.
 * A 4xx other than 429 is the request's own fault and isn't asked again.
 */

export const WAITS_MS = [2_000, 6_000] as const

export async function fetchJsonWithRetry<T = unknown>(
  url: string,
  opts: { waits?: readonly number[]; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const waits = opts.waits ?? WAITS_MS
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  let lastError: Error = new Error('not asked')
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    if (attempt > 0) await sleep(waits[attempt - 1]!)
    try {
      const res = await doFetch(url)
      if (res.ok) return (await res.json()) as T
      lastError = new Error(`Timeline API returned ${res.status}`)
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw lastError
}
