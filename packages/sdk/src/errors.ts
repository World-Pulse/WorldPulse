// ─── WorldPulse SDK errors ───────────────────────────────────────

/** The base of every error a request throws */
export class WorldPulseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'WorldPulseError'
  }
}

/**
 * The API answered with a status other than 2xx. Its error answer comes in
 * one of two shapes: { success: false, code, error } from most routes
 * (apps/api/src/lib/errors.ts), or { statusCode, code?, error, message } from
 * the API's error handler (lib/error-reply.ts: rate limits, validation by
 * schema, 5xx). `code` and the message are read from either.
 */
export class ApiError extends WorldPulseError {
  /** The HTTP status */
  readonly status: number
  /** The API's error code when it sends one (VALIDATION_ERROR, NOT_FOUND, RATE_LIMITED, …), else null */
  readonly code: string | null
  /** The error answer as it came: its JSON, or its text when it isn't JSON */
  readonly body: unknown
  /** The address asked */
  readonly url: string

  constructor(status: number, body: unknown, url: string) {
    const { code, message } = readErrorBody(body)
    const head = `WorldPulse API ${status}${code ? ` ${code}` : ''}`
    super(message ? `${head}: ${message}` : head)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.body = body
    this.url = url
  }
}

/** 429: too many requests. Wait `retryAfter` seconds (when the API says) before asking again */
export class RateLimitError extends ApiError {
  /** Seconds to wait, from the answer's Retry-After header; null when it has none */
  readonly retryAfter: number | null

  constructor(body: unknown, url: string, retryAfter: number | null) {
    super(429, body, url)
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
  }
}

/** The request didn't reach the API, or its answer didn't arrive (fetch failed) */
export class NetworkError extends WorldPulseError {
  readonly url: string

  constructor(url: string, cause: unknown) {
    super(`Could not reach ${url}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    this.name = 'NetworkError'
    this.url = url
  }
}

/** No answer within the `timeout` option */
export class TimeoutError extends WorldPulseError {
  readonly url: string
  /** Milliseconds waited */
  readonly timeout: number

  constructor(url: string, timeout: number) {
    super(`No answer from ${url} within ${timeout} ms`)
    this.name = 'TimeoutError'
    this.url = url
    this.timeout = timeout
  }
}

function readErrorBody(body: unknown): { code: string | null; message: string | null } {
  if (!body || typeof body !== 'object') return { code: null, message: null }
  const b = body as Record<string, unknown>
  // { statusCode, error: 'Bad Request', message } carries its words in message;
  // { success: false, code, error } in error
  const message = typeof b.message === 'string' ? b.message : typeof b.error === 'string' ? b.error : null
  return { code: typeof b.code === 'string' ? b.code : null, message }
}
