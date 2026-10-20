// ─── WorldPulse SDK client ───────────────────────────────────────
// Each method calls one route of apps/api, with the parameters it reads (plan
// V3h, Oct 20, 2026: the SDK called nine paths under /api/v1/public, seven of
// which don't exist, and read other fields than the other two send).
// src/__tests__/api-routes.test.ts checks every path against the API's routes.
import type {
  WorldPulseOptions,
  DataResponse,
  ListSignalsParams,
  SignalList,
  SignalDetail,
  TopStoriesParams,
  StoryList,
  StoryDetail,
  Week,
  SemanticSearchParams,
  SemanticSearchResponse,
  CountryIndexParams,
  CountryIndex,
} from './types'
import { ApiError, NetworkError, RateLimitError, TimeoutError, WorldPulseError } from './errors'

export const DEFAULT_BASE_URL = 'https://api.world-pulse.io'

/** The API's slowest answer (a story list nobody has asked for lately) takes up to a minute to make */
export const DEFAULT_TIMEOUT = 60_000

/** Query parameters; undefined ones aren't sent */
export type Query = Record<string, string | number | undefined>

/** How a method group asks the API (a GET of `path` on the client's base URL) */
export type Requester = <T>(path: string, query?: Query) => Promise<T>

/**
 * A client for WorldPulse's open read routes. None of them needs an account
 * or an API key.
 *
 * @example
 * ```ts
 * const wp = new WorldPulse()
 * const { data, total } = await wp.signals.list({ category: 'conflict', limit: 10 })
 * ```
 */
export class WorldPulse {
  /** Verified signals: GET /api/v1/public/signals, GET /api/v1/signals/:id */
  readonly signals: SignalMethods
  /** The categories a signal can have: GET /api/v1/public/categories */
  readonly categories: CategoryMethods
  /** Stories, one story, a week: GET /api/v1/stories, /api/v1/stories/:id, /api/v1/stories/week */
  readonly stories: StoryMethods
  /** Search by meaning: GET /api/v1/search/semantic */
  readonly search: SearchMethods
  /** Countries by risk score: GET /api/v1/countries */
  readonly countries: CountryMethods

  private readonly baseUrl: string
  private readonly timeout: number
  private readonly headers: Record<string, string>
  private readonly fetchFn: typeof globalThis.fetch

  constructor(options: WorldPulseOptions = {}) {
    if (!options.fetch && typeof globalThis.fetch !== 'function') {
      throw new WorldPulseError('There is no fetch here: pass one as the fetch option (Node.js 18 and later have it built in)')
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT
    // the global fetch is looked up per call and called on globalThis (browsers refuse it on anything else)
    this.fetchFn = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.headers = {
      Accept: 'application/json',
      // As the API reads them (apps/api/src/middleware/auth.ts)
      ...(options.apiKey ? { 'X-API-Key': options.apiKey } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    }

    const request: Requester = (path, query) => this.request(path, query)
    this.signals = new SignalMethods(request)
    this.categories = new CategoryMethods(request)
    this.stories = new StoryMethods(request)
    this.search = new SearchMethods(request)
    this.countries = new CountryMethods(request)
  }

  /** A GET of `path`; the parsed JSON answer, or an error (errors.ts) */
  private async request<T>(path: string, query?: Query): Promise<T> {
    const url = this.url(path, query)
    const controller = new AbortController()
    const timer: ReturnType<typeof setTimeout> | undefined =
      this.timeout > 0 ? setTimeout(() => controller.abort(), this.timeout) : undefined
    const fetchFn = this.fetchFn

    let res: Response
    let text: string
    try {
      res = await fetchFn(url, { method: 'GET', headers: this.headers, signal: controller.signal })
      text = await res.text()
    } catch (err) {
      if (controller.signal.aborted) throw new TimeoutError(url, this.timeout)
      throw new NetworkError(url, err)
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }

    const json = parseJson(text)
    if (!res.ok) {
      const body = json.ok ? json.value : text
      if (res.status === 429) throw new RateLimitError(body, url, retryAfterSeconds(res.headers.get('retry-after')))
      throw new ApiError(res.status, body, url)
    }
    if (!json.ok) throw new WorldPulseError(`WorldPulse API ${res.status}: the answer from ${url} isn't JSON`)
    return json.value as T
  }

  private url(path: string, query?: Query): string {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) params.set(key, String(value))
    }
    const qs = params.toString()
    return `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`
  }
}

// ─── Method groups ───────────────────────────────────────────────

export class SignalMethods {
  constructor(private readonly request: Requester) {}

  /** The latest verified signals, newest first: GET /api/v1/public/signals (60 a minute) */
  async list(params: ListSignalsParams = {}): Promise<SignalList> {
    const { category, severity, limit, offset } = params
    return this.request('/api/v1/public/signals', { category, severity, limit, offset })
  }

  /** One signal in full, whatever its status: GET /api/v1/signals/:id (60 a minute) */
  async get(id: string): Promise<DataResponse<SignalDetail>> {
    return this.request(`/api/v1/signals/${uuid(id, 'signals.get')}`)
  }
}

export class CategoryMethods {
  constructor(private readonly request: Requester) {}

  /** The categories a signal can have, the names signals.list() takes: GET /api/v1/public/categories (60 a minute) */
  async list(): Promise<DataResponse<string[]>> {
    return this.request('/api/v1/public/categories')
  }
}

export class StoryMethods {
  constructor(private readonly request: Requester) {}

  /** The stories most outlets are reporting: GET /api/v1/stories (60 a minute) */
  async top(params: TopStoriesParams = {}): Promise<DataResponse<StoryList>> {
    const { hours, limit, country } = params
    return this.request('/api/v1/stories', { hours, limit, country })
  }

  /** One story's reports, oldest first, by the story's id or any of its reports' ids: GET /api/v1/stories/:id (60 a minute) */
  async get(id: string): Promise<DataResponse<StoryDetail>> {
    return this.request(`/api/v1/stories/${uuid(id, 'stories.get')}`)
  }

  /**
   * A week's top stories, busiest countries and, for the week under way, the
   * people in the most reports of the last 7 days: GET /api/v1/stories/week (30 a minute).
   * `week` is an ISO week such as '2026-W42' (weeks run Monday to Monday, UTC);
   * without it, the week under way
   */
  async week(week?: string): Promise<DataResponse<Week>> {
    return this.request('/api/v1/stories/week', { week })
  }
}

export class SearchMethods {
  constructor(private readonly request: Requester) {}

  /** Signals closest in meaning to `q` (2 to 500 characters): GET /api/v1/search/semantic (20 a minute) */
  async semantic(q: string, params: SemanticSearchParams = {}): Promise<SemanticSearchResponse> {
    const { limit, category } = params
    return this.request('/api/v1/search/semantic', { q, limit, category })
  }
}

export class CountryMethods {
  constructor(private readonly request: Requester) {}

  /** Countries with verified signals in the period, highest risk first: GET /api/v1/countries (60 a minute) */
  async list(params: CountryIndexParams = {}): Promise<CountryIndex> {
    const { window, limit, category } = params
    return this.request('/api/v1/countries', { window, limit, category })
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Signal and story ids are UUIDs. Anything else is refused before asking:
 * the API answers 400 or 404 for it, except a name such as "week" or "count",
 * which would reach another route (GET /api/v1/stories/week) and answer
 * something else entirely.
 */
function uuid(id: string, method: string): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    throw new TypeError(`${method} takes a signal or story id (a UUID), not ${JSON.stringify(id)}`)
  }
  return id
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false }
  }
}

/** Retry-After in seconds: a number of seconds, or a date (RFC 9110); null when missing or unreadable */
function retryAfterSeconds(header: string | null, now: number = Date.now()): number | null {
  if (header === null) return null
  const value = header.trim()
  if (/^\d+$/.test(value)) return Number(value)
  const at = Date.parse(value)
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000))
}
