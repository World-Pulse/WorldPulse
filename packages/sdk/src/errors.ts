// ─── WorldPulse SDK Errors ───────────────────────────────────────

/** Base error class for all WorldPulse SDK errors */
export class WorldPulseError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'WorldPulseError'
  }
}

/** Thrown when the API returns a 4xx/5xx response */
export class ApiError extends WorldPulseError {
  constructor(
    message: string,
    code: string,
    status: number,
    public readonly body?: unknown,
  ) {
    super(message, code, status)
    this.name = 'ApiError'
  }
}

/** Thrown when a request times out */
export class TimeoutError extends WorldPulseError {
  constructor(url: string, timeoutMs: number) {
    super(
      `Request to ${url} timed out after ${timeoutMs}ms`,
      'TIMEOUT',
      undefined,
    )
    this.name = 'TimeoutError'
  }
}

/** Thrown when rate-limited (429) */
export class RateLimitError extends ApiError {
  public readonly retryAfterMs: number | null

  constructor(message: string, retryAfterHeader?: string | null) {
    super(message, 'RATE_LIMITED', 429)
    this.name = 'RateLimitError'
    this.retryAfterMs = retryAfterHeader
      ? parseInt(retryAfterHeader, 10) * 1000
      : null
  }
}

/** Thrown when the network is unreachable */
export class NetworkError extends WorldPulseError {
  constructor(url: string, cause: unknown) {
    super(
      `Network error requesting ${url}`,
      'NETWORK_ERROR',
      undefined,
      cause,
    )
    this.name = 'NetworkError'
  }
}

/** Thrown when a WebSocket / streaming connection fails */
export class StreamError extends WorldPulseError {
  constructor(message: string, cause?: unknown) {
    super(message, 'STREAM_ERROR', undefined, cause)
    this.name = 'StreamError'
  }
}

/** Thrown when the live stream exhausts reconnect attempts */
export class StreamConnectionError extends StreamError {
  public readonly attempts: number

  constructor(url: string, attempts: number, cause?: unknown) {
    super(
      `Failed to connect to stream at ${url} after ${attempts} attempt${attempts === 1 ? '' : 's'}`,
      cause,
    )
    this.name = 'StreamConnectionError'
    this.attempts = attempts
  }
}
