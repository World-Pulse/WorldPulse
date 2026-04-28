/**
 * Production-grade exponential backoff retry helper.
 *
 * Features:
 *  - Full jitter to avoid thundering-herd on mass feed failure
 *  - shouldRetry predicate to skip non-transient errors (4xx, auth, etc.)
 *  - AbortSignal support so in-flight retries cancel on shutdown
 *  - Typed RetryExhaustedError carries attempt count for observability
 *
 * Default schedule: 3 retries, base delays of 1 s / 5 s / 30 s with ±50% jitter.
 */

/** Base delays (ms) before jitter is applied. */
const BASE_DELAYS_MS: readonly number[] = [1_000, 5_000, 30_000]

/** Jitter factor: delays are randomised in [delay * (1 - JITTER), delay * (1 + JITTER)]. */
const JITTER = 0.5

function jitter(ms: number): number {
  return Math.round(ms * (1 - JITTER + Math.random() * JITTER * 2))
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Retry aborted', 'AbortError'))
      return
    }

    const timer = setTimeout(resolve, ms)

    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Retry aborted', 'AbortError'))
    }, { once: true })
  })
}

export class RetryExhaustedError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly cause: unknown,
  ) {
    super(`Retry exhausted after ${attempts} attempt(s): ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'RetryExhaustedError'
  }
}

export interface RetryOptions {
  /** Base delay schedule in ms (jitter applied on top). Default: [1000, 5000, 30000] */
  delays?: readonly number[]
  /**
   * Return false to NOT retry this error (e.g. 404, auth failure).
   * Default: always retry.
   */
  shouldRetry?: (err: unknown, attempt: number) => boolean
  /** AbortSignal — cancels pending sleep on abort. */
  signal?: AbortSignal
}

/** Returns true for HTTP 4xx errors that are non-transient (don't retry). */
export function isNonTransientHttpError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  // rss-parser and fetch both surface status codes in the message or as a property
  const msg = err.message.toLowerCase()
  if (msg.includes('status code 4') || msg.includes('http 4')) return true
  // Check for statusCode property (some HTTP libs set this)
  const anyErr = err as unknown as Record<string, unknown>
  const code = anyErr['statusCode'] ?? anyErr['status']
  if (typeof code === 'number' && code >= 400 && code < 500) return true
  return false
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions | readonly number[] = BASE_DELAYS_MS,
): Promise<T> {
  // Accept legacy array form for backwards compatibility
  let delays: readonly number[]
  let shouldRetry: ((err: unknown, attempt: number) => boolean) | undefined
  let signal: AbortSignal | undefined

  if (Array.isArray(options)) {
    delays = options as readonly number[]
  } else {
    const opts = options as RetryOptions
    delays = opts.delays ?? BASE_DELAYS_MS
    shouldRetry = opts.shouldRetry
    signal = opts.signal
  }

  let lastError: unknown
  const totalAttempts = delays.length + 1

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('Retry aborted', 'AbortError')
    }

    try {
      return await fn()
    } catch (err) {
      lastError = err

      // Don't retry non-transient errors
      if (shouldRetry ? !shouldRetry(err, attempt + 1) : isNonTransientHttpError(err)) {
        throw err
      }

      const delayMs = delays[attempt]
      if (delayMs !== undefined) {
        await sleep(jitter(delayMs), signal)
      }
    }
  }

  throw new RetryExhaustedError(totalAttempts, lastError)
}
