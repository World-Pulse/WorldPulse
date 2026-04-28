// ─── WorldPulse SDK — Streaming (v1.1) ───────────────────────────
//
// Two streaming primitives:
//
//  1. SignalLiveStream  — WebSocket-based, event-emitter-style
//     const stream = wp.stream.live({ channels: ['conflict', 'breaking'] })
//     stream.on('signal', (s) => console.log(s))
//     await stream.connect()
//     stream.close()
//
//  2. wp.stream.poll()  — polling-based AsyncIterableIterator<Signal>
//     for await (const signal of wp.stream.poll({ category: 'conflict' })) {
//       console.log(signal)
//     }
//

import type {
  Signal,
  LiveStreamOptions,
  LiveStreamEventMap,
  PollStreamOptions,
  WsMessage,
  WsConnectedData,
  WsSignalData,
  WsChannel,
  ListSignalsParams,
} from './types'
import { StreamError, StreamConnectionError } from './errors'

const DEFAULT_WS_BASE_URL = 'wss://api.world-pulse.io'
const DEFAULT_MAX_RECONNECTS = 5
const DEFAULT_RECONNECT_DELAY = 2_000
const DEFAULT_POLL_INTERVAL = 5_000
const DEFAULT_POLL_LIMIT = 20

// ─── Tiny Event Emitter ───────────────────────────────────────────

type Listener<T> = T extends void ? () => void : (data: T) => void

class EventEmitter<EventMap extends Record<string, unknown>> {
  private readonly _listeners = new Map<string, Set<Listener<unknown>>>()

  on<K extends keyof EventMap & string>(
    event: K,
    listener: Listener<EventMap[K]>,
  ): this {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set())
    }
    this._listeners.get(event)!.add(listener as Listener<unknown>)
    return this
  }

  off<K extends keyof EventMap & string>(
    event: K,
    listener: Listener<EventMap[K]>,
  ): this {
    this._listeners.get(event)?.delete(listener as Listener<unknown>)
    return this
  }

  once<K extends keyof EventMap & string>(
    event: K,
    listener: Listener<EventMap[K]>,
  ): this {
    const wrapper = ((data: EventMap[K]) => {
      this.off(event, wrapper as Listener<EventMap[K]>)
      ;(listener as (d: EventMap[K]) => void)(data)
    }) as Listener<EventMap[K]>
    return this.on(event, wrapper)
  }

  protected emit<K extends keyof EventMap & string>(
    event: K,
    ...[data]: EventMap[K] extends void ? [] : [data: EventMap[K]]
  ): void {
    const listeners = this._listeners.get(event)
    if (!listeners) return
    for (const fn of listeners) {
      ;(fn as (d?: unknown) => void)(data)
    }
  }

  removeAllListeners(event?: keyof EventMap & string): this {
    if (event) {
      this._listeners.delete(event)
    } else {
      this._listeners.clear()
    }
    return this
  }
}

// ─── SignalLiveStream ─────────────────────────────────────────────

/**
 * WebSocket-based live stream for real-time signal events.
 *
 * @example
 * ```ts
 * const stream = wp.stream.live({ channels: ['conflict', 'breaking'] })
 * stream.on('signal', (s) => console.log('new signal:', s.title))
 * stream.on('error', (err) => console.error(err))
 * await stream.connect()
 *
 * // later…
 * stream.close()
 * ```
 */
export class SignalLiveStream extends EventEmitter<LiveStreamEventMap> {
  private ws: WebSocket | null = null
  private _closed = false
  private _reconnects = 0
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null

  private readonly wsUrl: string
  private readonly channels: WsChannel[]
  private readonly maxReconnects: number
  private readonly reconnectDelay: number
  private readonly WsCtor: typeof globalThis.WebSocket

  /** Whether the stream is currently open */
  get isOpen(): boolean {
    return this.ws?.readyState === 1 // OPEN
  }

  /** Whether close() has been called */
  get isClosed(): boolean {
    return this._closed
  }

  constructor(
    wsBaseUrl: string,
    options: LiveStreamOptions,
    WsCtor: typeof globalThis.WebSocket,
  ) {
    super()

    const base = wsBaseUrl.replace(/\/+$/, '')
    const token = options.token ? `?token=${encodeURIComponent(options.token)}` : ''
    this.wsUrl = `${base}/ws${token}`

    this.channels = options.channels ?? ['breaking', 'critical']
    this.maxReconnects = options.maxReconnects ?? DEFAULT_MAX_RECONNECTS
    this.reconnectDelay = options.reconnectDelay ?? DEFAULT_RECONNECT_DELAY
    this.WsCtor = WsCtor
  }

  /**
   * Open the WebSocket connection.
   * Resolves once the `connected` event fires (first `ping` from server).
   */
  connect(): Promise<WsConnectedData> {
    return new Promise((resolve, reject) => {
      if (this._closed) {
        reject(new StreamError('Stream has been closed'))
        return
      }

      this._doConnect(resolve, reject)
    })
  }

  private _doConnect(
    resolveFirst?: (data: WsConnectedData) => void,
    rejectFirst?: (err: Error) => void,
  ): void {
    if (this._closed) return

    let settled = false

    const ws = new this.WsCtor(this.wsUrl)
    this.ws = ws

    ws.onopen = () => {
      // Subscribe to requested channels
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          payload: { channels: this.channels },
        }),
      )
    }

    ws.onmessage = (ev: MessageEvent) => {
      let msg: WsMessage
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) as WsMessage
      } catch {
        return // ignore malformed frames
      }

      if (msg.event === 'ping') {
        const connData = msg.data as WsConnectedData
        // Reset reconnect counter on successful connection
        this._reconnects = 0

        if (!settled) {
          settled = true
          resolveFirst?.(connData)
        }

        this.emit('connected', connData)
        return
      }

      if (msg.event === 'signal_new' || msg.event === 'signal_update') {
        const raw = msg.data as WsSignalData
        const signal: Signal = {
          id: raw.id,
          title: raw.title,
          category: raw.category as Signal['category'],
          severity: raw.severity,
          reliability_score: raw.reliability_score ?? null,
          location_name: raw.location_name ?? null,
          published_at: raw.published_at,
          source_url: raw.source_url ?? null,
        }
        this.emit('signal', signal)
        return
      }

      if (msg.event === 'error') {
        const err = new StreamError(
          (msg.data as { message?: string })?.message ?? 'Stream error from server',
        )
        if (!settled) {
          settled = true
          rejectFirst?.(err)
        }
        this.emit('error', err)
        return
      }
    }

    ws.onerror = (_ev: Event) => {
      const err = new StreamError(`WebSocket error on ${this.wsUrl}`)
      if (!settled) {
        settled = true
        rejectFirst?.(err)
      }
      this.emit('error', err)
    }

    ws.onclose = (_ev: CloseEvent) => {
      if (this._closed) {
        this.emit('close')
        return
      }

      // Attempt reconnect
      if (this._reconnects < this.maxReconnects) {
        this._reconnects++
        const delay = this.reconnectDelay * this._reconnects
        this._reconnectTimer = setTimeout(() => {
          this._doConnect()
        }, delay)
      } else {
        const err = new StreamConnectionError(this.wsUrl, this._reconnects + 1)
        if (!settled) {
          settled = true
          rejectFirst?.(err)
        }
        this.emit('error', err)
        this.emit('close')
      }
    }
  }

  /**
   * Send a raw subscribe message to add channels after connecting.
   */
  subscribe(channels: WsChannel[]): void {
    if (!this.isOpen) {
      throw new StreamError('Cannot subscribe: stream is not open')
    }
    this.ws!.send(
      JSON.stringify({ type: 'subscribe', payload: { channels } }),
    )
  }

  /**
   * Send a raw unsubscribe message to remove channels.
   */
  unsubscribe(channels: WsChannel[]): void {
    if (!this.isOpen) {
      throw new StreamError('Cannot unsubscribe: stream is not open')
    }
    this.ws!.send(
      JSON.stringify({ type: 'unsubscribe', payload: { channels } }),
    )
  }

  /**
   * Close the WebSocket connection permanently.
   * Fires the `close` event once complete.
   */
  close(): void {
    this._closed = true
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
    if (this.ws) {
      this.ws.onclose = null // prevent auto-reconnect
      this.ws.close(1000, 'Client closed')
      this.ws = null
    }
    this.emit('close')
  }
}

// ─── Poll Stream ─────────────────────────────────────────────────

/**
 * Poll-based async-iterator stream. Repeatedly fetches the signals endpoint
 * and yields newly published signals, deduplicating by signal ID.
 *
 * Works in any environment without WebSocket support and with SSE not available.
 *
 * @example
 * ```ts
 * const ac = new AbortController()
 * for await (const signal of wp.stream.poll({ category: 'conflict', intervalMs: 10_000 })) {
 *   console.log(signal.title)
 *   if (someCondition) ac.abort()
 * }
 * ```
 */
export async function* createPollStream(
  fetcher: (path: string, params?: Record<string, unknown>) => Promise<unknown>,
  options: PollStreamOptions = {},
): AsyncGenerator<Signal, void, unknown> {
  const {
    category,
    severity,
    country_code,
    limit = DEFAULT_POLL_LIMIT,
    intervalMs = DEFAULT_POLL_INTERVAL,
    signal: abortSignal,
  } = options

  // Seed the cursor at "now" so we only emit signals that arrive AFTER startup
  let cursor = options.since ?? new Date().toISOString()
  const seen = new Set<string>()

  while (!abortSignal?.aborted) {
    try {
      const params: Record<string, unknown> = {
        since: cursor,
        limit,
        sort: 'newest',
      }
      if (category)     params['category']     = category
      if (severity)     params['severity']     = severity
      if (country_code) params['country_code'] = country_code

      type PaginatedSignals = { data: Signal[]; total?: number }
      const response = await fetcher('/signals', params) as PaginatedSignals

      const fresh: Signal[] = []
      for (const s of response?.data ?? []) {
        if (!seen.has(s.id)) {
          seen.add(s.id)
          fresh.push(s)
          // Advance cursor to the most-recent published_at we've seen
          if (!cursor || s.published_at > cursor) {
            cursor = s.published_at
          }
        }
      }

      // Yield in chronological order (oldest first)
      for (const s of fresh.reverse()) {
        if (abortSignal?.aborted) return
        yield s
      }

      // Keep seen set from growing unboundedly (cap at 10× limit)
      if (seen.size > limit * 10) {
        const arr = [...seen]
        arr.splice(0, arr.length - limit * 5)
        seen.clear()
        for (const id of arr) seen.add(id)
      }
    } catch (err) {
      // Surface non-abort errors as StreamError but continue polling
      if (abortSignal?.aborted) return
      if (err instanceof Error && err.name !== 'AbortError') {
        // Let caller handle via try/catch around the iterator
        throw new StreamError(`Poll stream error: ${err.message}`, err)
      }
      return
    }

    // Wait for next poll tick
    await sleep(intervalMs, abortSignal)
    if (abortSignal?.aborted) return
  }
}

// ─── Stream Methods (method group exposed as wp.stream) ───────────

export class StreamMethods {
  constructor(
    private readonly wsBaseUrl: string,
    private readonly WsCtor: typeof globalThis.WebSocket,
    private readonly fetcher: (path: string, params?: Record<string, unknown>) => Promise<unknown>,
  ) {}

  /**
   * Open a WebSocket-based live stream.
   * Returns a `SignalLiveStream` instance — call `.connect()` then listen
   * for `'signal'` events.
   *
   * @example
   * ```ts
   * const stream = wp.stream.live({ channels: ['conflict', 'breaking'] })
   * stream.on('signal', (s) => console.log(s.title))
   * await stream.connect()
   * ```
   */
  live(options: LiveStreamOptions = {}): SignalLiveStream {
    return new SignalLiveStream(this.wsBaseUrl, options, this.WsCtor)
  }

  /**
   * Polling-based `AsyncGenerator<Signal>` that continuously fetches new
   * signals and yields them as they arrive.
   *
   * Use when WebSocket is unavailable or when a simple pull model is preferred.
   *
   * @example
   * ```ts
   * const ac = new AbortController()
   * for await (const s of wp.stream.poll({ category: 'conflict', intervalMs: 8000 })) {
   *   console.log(s.title)
   * }
   * ```
   */
  poll(options: PollStreamOptions = {}): AsyncGenerator<Signal, void, unknown> {
    return createPollStream(this.fetcher, options)
  }
}

// ─── Internal helpers ─────────────────────────────────────────────

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }

    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}
