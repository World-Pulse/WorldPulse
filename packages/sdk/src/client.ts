// ─── WorldPulse SDK Client ───────────────────────────────────────
import type {
  WorldPulseConfig,
  Signal,
  SignalDetail,
  Category,
  Source,
  IntelligenceDomain,
  CountryActivity,
  ThreatAssessment,
  PlatformStats,
  PaginatedResponse,
  ListResponse,
  DataResponse,
  ListSignalsParams,
  ListSourcesParams,
  ListCountriesParams,
  ListBreakingParams,
  ApiErrorResponse,
} from './types'
import {
  ApiError,
  TimeoutError,
  RateLimitError,
  NetworkError,
} from './errors'
import { StreamMethods } from './stream'

const DEFAULT_BASE_URL = 'https://api.world-pulse.io/api/v1/public'
const DEFAULT_WS_BASE_URL = 'wss://api.world-pulse.io'
const DEFAULT_TIMEOUT = 10_000
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_RETRY_DELAY = 1_000
const SDK_VERSION = '1.1.0'

/**
 * WorldPulse API client.
 *
 * @example
 * ```ts
 * import { WorldPulse } from '@worldpulse/sdk'
 *
 * const wp = new WorldPulse()
 * const { data } = await wp.signals.list({ category: 'conflict', limit: 10 })
 * console.log(data)
 * ```
 */
export class WorldPulse {
  private readonly baseUrl: string
  private readonly timeout: number
  private readonly maxRetries: number
  private readonly retryDelay: number
  private readonly headers: Record<string, string>
  private readonly _fetch: typeof globalThis.fetch

  /** Signal endpoints */
  public readonly signals: SignalMethods
  /** Category taxonomy endpoints */
  public readonly categories: CategoryMethods
  /** Source registry endpoints */
  public readonly sources: SourceMethods
  /** Intelligence domain directory */
  public readonly intelligence: IntelligenceMethods
  /** Country signal activity */
  public readonly countries: CountryMethods
  /** Threat assessment endpoints */
  public readonly threats: ThreatMethods
  /** Platform statistics */
  public readonly stats: StatsMethods
  /** Breaking news alerts */
  public readonly breaking: BreakingMethods
  /**
   * Real-time streaming — WebSocket live stream + polling async iterator.
   *
   * @example
   * ```ts
   * // WebSocket live stream
   * const stream = wp.stream.live({ channels: ['conflict', 'breaking'] })
   * stream.on('signal', (s) => console.log(s.title))
   * await stream.connect()
   *
   * // Polling async iterator
   * for await (const s of wp.stream.poll({ category: 'conflict' })) {
   *   console.log(s.title)
   * }
   * ```
   */
  public readonly stream: StreamMethods

  constructor(config: WorldPulseConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    const wsBaseUrl = (config.wsBaseUrl ?? DEFAULT_WS_BASE_URL).replace(/\/+$/, '')
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES
    this.retryDelay = config.retryDelay ?? DEFAULT_RETRY_DELAY
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis)
    this.headers = {
      'Accept': 'application/json',
      'User-Agent': `worldpulse-sdk/${SDK_VERSION}`,
      ...(config.headers ?? {}),
    }

    // Bind method groups
    this.signals = new SignalMethods(this)
    this.categories = new CategoryMethods(this)
    this.sources = new SourceMethods(this)
    this.intelligence = new IntelligenceMethods(this)
    this.countries = new CountryMethods(this)
    this.threats = new ThreatMethods(this)
    this.stats = new StatsMethods(this)
    this.breaking = new BreakingMethods(this)

    // Streaming — resolve WebSocket constructor
    const WsCtor: typeof globalThis.WebSocket =
      config.WebSocket ??
      (typeof globalThis.WebSocket !== 'undefined' ? globalThis.WebSocket : _noWebSocket)

    this.stream = new StreamMethods(
      wsBaseUrl,
      WsCtor,
      (path, params) => this.get(path, params),
    )
  }

  // ─── Internal HTTP Layer ─────────────────────────────────────

  /** Build a full URL with query parameters */
  buildUrl(path: string, params?: Record<string, unknown>): string {
    const url = new URL(`${this.baseUrl}${path}`)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value))
        }
      }
    }
    return url.toString()
  }

  /** Execute an HTTP GET with timeout, retries, and error handling */
  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const url = this.buildUrl(path, params)
    let lastError: unknown = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), this.timeout)

        let response: Response
        try {
          response = await this._fetch(url, {
            method: 'GET',
            headers: this.headers,
            signal: controller.signal,
          })
        } finally {
          clearTimeout(timeoutId)
        }

        // Rate limited — retry with backoff
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After')
          if (attempt < this.maxRetries) {
            const delay = retryAfter
              ? parseInt(retryAfter, 10) * 1000
              : this.retryDelay * Math.pow(2, attempt)
            await sleep(delay)
            lastError = new RateLimitError(
              'Rate limited by WorldPulse API',
              retryAfter,
            )
            continue
          }
          throw new RateLimitError(
            'Rate limited by WorldPulse API — retries exhausted',
            retryAfter,
          )
        }

        // Server error — retry with backoff
        if (response.status >= 500 && attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt)
          await sleep(delay)
          lastError = new ApiError(
            `Server error ${response.status}`,
            'SERVER_ERROR',
            response.status,
          )
          continue
        }

        // Parse body
        const body: unknown = await response.json().catch(() => null)

        // Client/server error with no retry
        if (!response.ok) {
          const apiErr = body as ApiErrorResponse | null
          throw new ApiError(
            apiErr?.error ?? `HTTP ${response.status}`,
            apiErr?.code ?? 'API_ERROR',
            response.status,
            body,
          )
        }

        return body as T
      } catch (err) {
        // Already a WorldPulse error — rethrow
        if (err instanceof ApiError || err instanceof RateLimitError) {
          throw err
        }

        // Timeout
        if (err instanceof DOMException && err.name === 'AbortError') {
          if (attempt < this.maxRetries) {
            await sleep(this.retryDelay * Math.pow(2, attempt))
            lastError = new TimeoutError(url, this.timeout)
            continue
          }
          throw new TimeoutError(url, this.timeout)
        }

        // Network error
        if (attempt < this.maxRetries) {
          await sleep(this.retryDelay * Math.pow(2, attempt))
          lastError = err
          continue
        }

        throw new NetworkError(url, err)
      }
    }

    // Should never reach here, but satisfy TypeScript
    throw lastError ?? new Error('Unknown error')
  }
}

// ─── Method Groups ───────────────────────────────────────────────

class SignalMethods {
  constructor(private client: WorldPulse) {}

  /** List verified signals with optional filters and pagination */
  async list(params?: ListSignalsParams): Promise<PaginatedResponse<Signal>> {
    return this.client.get<PaginatedResponse<Signal>>('/signals', params as Record<string, unknown>)
  }

  /** Get a single signal by ID with full detail */
  async get(id: string): Promise<DataResponse<SignalDetail>> {
    return this.client.get<DataResponse<SignalDetail>>(`/signals/${encodeURIComponent(id)}`)
  }
}

class CategoryMethods {
  constructor(private client: WorldPulse) {}

  /** List all 16 signal categories with live counts */
  async list(): Promise<ListResponse<Category>> {
    return this.client.get<ListResponse<Category>>('/categories')
  }
}

class SourceMethods {
  constructor(private client: WorldPulse) {}

  /** Browse curated sources with optional filters */
  async list(params?: ListSourcesParams): Promise<PaginatedResponse<Source>> {
    return this.client.get<PaginatedResponse<Source>>('/sources', params as Record<string, unknown>)
  }
}

class IntelligenceMethods {
  constructor(private client: WorldPulse) {}

  /** List all 12 intelligence domains */
  async list(): Promise<ListResponse<IntelligenceDomain>> {
    return this.client.get<ListResponse<IntelligenceDomain>>('/intelligence')
  }
}

class CountryMethods {
  constructor(private client: WorldPulse) {}

  /** List countries ranked by signal activity */
  async list(params?: ListCountriesParams): Promise<ListResponse<CountryActivity>> {
    return this.client.get<ListResponse<CountryActivity>>('/countries', params as Record<string, unknown>)
  }
}

class ThreatMethods {
  constructor(private client: WorldPulse) {}

  /** Get category-level threat assessments with trend analysis */
  async list(): Promise<ListResponse<ThreatAssessment>> {
    return this.client.get<ListResponse<ThreatAssessment>>('/threats')
  }
}

class StatsMethods {
  constructor(private client: WorldPulse) {}

  /** Get platform-wide statistics */
  async get(): Promise<DataResponse<PlatformStats>> {
    return this.client.get<DataResponse<PlatformStats>>('/stats')
  }
}

class BreakingMethods {
  constructor(private client: WorldPulse) {}

  /** Get critical+high signals from the last 24 hours */
  async list(params?: ListBreakingParams): Promise<ListResponse<Signal>> {
    return this.client.get<ListResponse<Signal>>('/breaking', params as Record<string, unknown>)
  }
}

// ─── Utilities ───────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Placeholder WebSocket constructor used when no WebSocket is available.
 * Throws a clear error so the developer knows they need to inject one.
 */
function _noWebSocket(..._args: ConstructorParameters<typeof WebSocket>): never {
  throw new Error(
    'WorldPulse SDK: WebSocket is not available in this environment. ' +
    'Pass a WebSocket implementation via `config.WebSocket`. ' +
    'In Node.js you can use the `ws` package:\n' +
    '  import WS from "ws"\n' +
    '  const wp = new WorldPulse({ WebSocket: WS as unknown as typeof globalThis.WebSocket })',
  )
}
_noWebSocket.prototype = {}
_noWebSocket.CONNECTING = 0
_noWebSocket.OPEN = 1
_noWebSocket.CLOSING = 2
_noWebSocket.CLOSED = 3
