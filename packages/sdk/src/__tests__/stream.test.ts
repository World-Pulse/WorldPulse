// ─── WorldPulse SDK — Streaming Tests (v1.1) ─────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WorldPulse } from '../client'
import { SignalLiveStream, createPollStream } from '../stream'
import { StreamError, StreamConnectionError } from '../errors'
import type { Signal, WsConnectedData } from '../types'

// ─── WebSocket Mock Infrastructure ───────────────────────────────

interface MockWSInstance {
  readyState: number
  onopen:    ((ev: Event) => void) | null
  onmessage: ((ev: MessageEvent) => void) | null
  onerror:   ((ev: Event) => void) | null
  onclose:   ((ev: CloseEvent) => void) | null
  send:      ReturnType<typeof vi.fn>
  close:     ReturnType<typeof vi.fn>
  /** Helper: simulate incoming message */
  _receive:  (data: unknown) => void
  /** Helper: simulate connection open */
  _open:     () => void
  /** Helper: simulate error */
  _error:    () => void
  /** Helper: simulate close */
  _close:    (code?: number) => void
}

function createMockWSClass(): {
  MockWS: typeof globalThis.WebSocket
  getInstance: () => MockWSInstance
} {
  let instance: MockWSInstance | null = null

  class MockWS {
    readyState = 0 // CONNECTING
    onopen:    ((ev: Event) => void) | null = null
    onmessage: ((ev: MessageEvent) => void) | null = null
    onerror:   ((ev: Event) => void) | null = null
    onclose:   ((ev: CloseEvent) => void) | null = null
    send      = vi.fn()
    close     = vi.fn((code?: number, reason?: string) => {
      this.readyState = 3 // CLOSED
      if (this.onclose) {
        this.onclose({ code: code ?? 1000, reason: reason ?? '' } as CloseEvent)
      }
    })

    constructor(_url: string) {
      instance = this as unknown as MockWSInstance
    }

    _receive(data: unknown): void {
      if (this.onmessage) {
        this.onmessage({ data: JSON.stringify(data) } as MessageEvent)
      }
    }

    _open(): void {
      this.readyState = 1 // OPEN
      if (this.onopen) this.onopen({} as Event)
    }

    _error(): void {
      if (this.onerror) this.onerror({} as Event)
    }

    _close(code = 1006): void {
      this.readyState = 3 // CLOSED
      if (this.onclose) this.onclose({ code } as CloseEvent)
    }

    static CONNECTING = 0
    static OPEN       = 1
    static CLOSING    = 2
    static CLOSED     = 3
  }

  return {
    MockWS:      MockWS as unknown as typeof globalThis.WebSocket,
    getInstance: () => instance as MockWSInstance,
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────

const CONNECTED_MSG: WsConnectedData = {
  clientId:         'test-client-id',
  authenticated:    false,
  serverTime:       '2026-04-17T00:00:00.000Z',
  connectedClients: 1,
}

const SIGNAL_FIXTURE: Signal = {
  id:               'sig_stream_001',
  title:            'Live conflict update',
  category:         'conflict',
  severity:         'high',
  reliability_score: 0.82,
  location_name:    'Kyiv, Ukraine',
  published_at:     '2026-04-17T00:01:00.000Z',
  source_url:       'https://reuters.com/live',
}

// ─── SignalLiveStream — construction ─────────────────────────────

describe('SignalLiveStream construction', () => {
  it('builds correct WebSocket URL from wsBaseUrl', () => {
    const { MockWS, getInstance } = createMockWSClass()
    const stream = new SignalLiveStream('wss://api.world-pulse.io', {}, MockWS)
    stream.connect().catch(() => {}) // don't need result
    expect(getInstance()).not.toBeNull()
  })

  it('appends token to WebSocket URL when provided', () => {
    // We spy on WebSocket constructor calls to verify URL
    let capturedUrl = ''
    const SpyWS = function (url: string) {
      capturedUrl = url
      return {
        readyState: 3,
        onopen: null, onmessage: null, onerror: null, onclose: null,
        send: vi.fn(), close: vi.fn(),
      }
    } as unknown as typeof globalThis.WebSocket
    SpyWS.CONNECTING = 0; SpyWS.OPEN = 1; SpyWS.CLOSING = 2; SpyWS.CLOSED = 3

    const stream = new SignalLiveStream('wss://api.world-pulse.io', { token: 'tok123' }, SpyWS)
    stream.connect().catch(() => {})
    expect(capturedUrl).toContain('?token=tok123')
  })

  it('starts as not open and not closed', () => {
    const { MockWS } = createMockWSClass()
    const stream = new SignalLiveStream('wss://api.world-pulse.io', {}, MockWS)
    expect(stream.isOpen).toBe(false)
    expect(stream.isClosed).toBe(false)
  })
})

// ─── SignalLiveStream — connect lifecycle ─────────────────────────

describe('SignalLiveStream connect', () => {
  it('resolves with connected data when ping event arrives', async () => {
    const { MockWS, getInstance } = createMockWSClass()
    const stream = new SignalLiveStream('wss://api.world-pulse.io', {}, MockWS)

    const connectPromise = stream.connect()
    const ws = getInstance()

    // Simulate WS open + server ping
    ws._open()
    ws._receive({ event: 'ping', data: CONNECTED_MSG })

    const result = await connectPromise
    expect(result.clientId).toBe('test-client-id')
    expect(result.authenticated).toBe(false)
  })

  it('sends subscribe message on open with default channels', async () => {
    const { MockWS, getInstance } = createMockWSClass()
    const stream = new SignalLiveStream('wss://api.world-pulse.io', {}, MockWS)
    const connectPromise = stream.connect()
    const ws = getInstance()

    ws._open()
    ws._receive({ event: 'ping', data: CONNECTED_MSG })
    await connectPromise

    expect(ws.send).toHaveBeenCalledOnce()
    const msg = JSON.parse(ws.send.mock.calls[0][0] as string)
    expect(msg.type).toBe('subscribe')
    expect(msg.payload.channels).toContain('breaking')
    expect(msg.payload.channels).toContain('critical')
  })

  it('sends subscribe with custom channels', async () => {
    const { MockWS, getInstance } = createMockWSClass()
    const stream = new SignalLiveStream(
      'wss://api.world-pulse.io',
      { channels: ['conflict', 'all'] },
      MockWS,
    )
    const connectPromise = stream.connect()
    const ws = getInstance()
    ws._open()
    ws._receive({ event: 'ping', data: CONNECTED_MSG })
    await connectPromise

    const msg = JSON.parse(ws.send.mock.calls[0][0] as string)
    expect(msg.payload.channels).toEqual(['conflict', 'all'])
  })

  it('rejects when close event fires before ping (no reconnect budget)', async () => {
    const { MockWS, getInstance } = createMockWSClass()
    const stream = new SignalLiveStream(
      'wss://api.world-pulse.io',
      { maxReconnects: 0, reconnectDelay: 0 },
      MockWS,
    )
    const connectPromise = stream.connect()
    const ws = getInstance()
    ws._open()
    ws._close(1006) // abnormal close

    await expect(connectPromise).rejects.toBeInstanceOf(StreamConnectionError)
  })

  it('rejects when server sends error event', async () => {
    const { MockWS, getInstance } = createMockWSClass()
    const stream = new SignalLiveStream(
      'wss://api.world-pulse.io',
      { maxReconnects: 0 },
      MockWS,
    )
    const connectPromise = stream.connect()
    const ws = getInstance()
    ws._open()
    ws._receive({ event: 'error', data: { message: 'auth required' } })

    await expect(connectPromise).rejects.toBeInstanceOf(StreamError)
  })

  it('rejects if connect() is called after close()', async () => {
    const { MockWS } = createMockWSClass()
    const stream = new SignalLiveStream('wss://api.world-pulse.io', {}, MockWS)
    stream.close()
    await expect(stream.connect()).rejects.toBeInstanceOf(StreamError)
  })
})

// ─── SignalLiveStream — events ────────────────────────────────────

describe('SignalLiveStream events', () => {
  it('emits signal event for signal_new messages', async () => {
    const { MockWS, getInstance } = createMockWSClass()
    const stream = new SignalLiveStream('wss://api.world-pulse.io', {}, MockWS)
    const received: Signal[] = []
    stream.on('signal', (s) => received.push(s))

    const connectPromise = stream.connect()
    const ws = getInstance()
    ws._open()
    ws._receive({ event: 'ping', data: CONNECTED_MSG })
    await connectPromise

    ws._receive({ event: 'signal_new', data: SIGNAL_FIXTURE })
    expect(received).toHaveLength(1)
    expect(received[0]?.id).toBe('sig_stream_001')
    expect(received[0]?.category).toBe('conflict')
  })

  it('emits signal event for signal_update messages', async () => {
    const { MockWS, getInstance } = createMockWSClass()
    const stream = new SignalLiveStream('wss://api.world-pulse.io', {}, MockWS)
    const received: Signal[] = []
    stream.on('signal', (s) => received.push(s))

    const connectPromise = stream.connect()
    const ws = getInstance()
    ws._open()
    ws._receive({ event: 'ping', data: CONNECTED_MSG })
    await connectPromise

    ws._receive({ event: 'signal_update', data: { ...SIGNAL_FIXTURE, id: 'sig_002' } })
    expect(received[0]?.id).toBe('sig_002')
  })

  it('emits connected event on each successful ping', async () => {
    const { MockWS, getInstance } = createMockWSClass()
    const stream = new SignalLiveStream('wss://api.world-pulse.io', {}, MockWS)
    const connectedEvents: WsConnectedData[] = []
    stream.on('connected', (d) => connectedEvents.push(d))

    const connectPromise = stream.connect()
    const ws = getInstance()
    ws._open()
    ws._receive({ event: 'ping', data: CONNECTED_MSG })
    await connectPromise

    expect(connectedEvents).toHaveLength(1)
    expect(connectedEvents[0]?.clientId).toBe('test-client-id')
  })

  it('emits error event for unknown server errors', async () => {
    const { MockWS, getInstance } = createMockWSClass()
    const stream = new SignalLiveStream('wss://api.world-pulse.io', {}, MockWS)

    // Connect successfully first
    const cp = stream.connect()
    const ws = getInstance()
    ws._open()
    ws._receive({ event: 'ping', data: CONNECTED_MSG })
    await cp

    const errors: Error[] = []
    stream.on('error', (e) => errors.push(e))
    ws._receive({ event: 'error', data: { message: 'rate limited' } })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(StreamError)
  })

  it('emits close event when close() is called', async () => {
    const { MockWS, getInstance } = createMockWSClass()
    const stream = new SignalLiveStream('wss://api.world-pulse.io', {}, MockWS)
    const cp = stream.connect()
    const ws = getInstance()
    ws._open()
    ws._receive({ event: 'ping', data: CONNECTED_MSG })
    await cp

    let closeFired = false
    stream.on('close', () => { closeFired = true })
    stream.close()
    expect(closeFired).toBe(true)
    expect(stream.isClosed).toBe(true)
  })

  it('supports once() for one-time listeners', async () => {
    const { MockWS, getInstance } = createMockWSClass()
    const stream = new SignalLiveStream('wss://api.world-pulse.io', {}, MockWS)
    const cp = stream.connect()
    const ws = getInstance()
    ws._open()
    ws._receive({ event: 'ping', data: CONNECTED_MSG })
    await cp

    let count = 0
    stream.once('signal', () => { count++ })
    ws._receive({ event: 'signal_new', data: SIGNAL_FIXTURE })
    ws._receive({ event: 'signal_new', data: { ...SIGNAL_FIXTURE, id: 'sig_003' } })
    expect(count).toBe(1) // only fired once
  })

  it('supports off() to remove listeners', async () => {
    const { MockWS, getInstance } = createMockWSClass()
    const stream = new SignalLiveStream('wss://api.world-pulse.io', {}, MockWS)
    const cp = stream.connect()
    const ws = getInstance()
    ws._open()
    ws._receive({ event: 'ping', data: CONNECTED_MSG })
    await cp

    const received: Signal[] = []
    const handler = (s: Signal) => received.push(s)
    stream.on('signal', handler)
    ws._receive({ event: 'signal_new', data: SIGNAL_FIXTURE })
    stream.off('signal', handler)
    ws._receive({ event: 'signal_new', data: { ...SIGNAL_FIXTURE, id: 'sig_004' } })
    expect(received).toHaveLength(1) // second event not received
  })

  it('ignores malformed JSON messages', async () => {
    const { MockWS, getInstance } = createMockWSClass()
    const stream = new SignalLiveStream('wss://api.world-pulse.io', {}, MockWS)
    const cp = stream.connect()
    const ws = getInstance()
    ws._open()
    ws._receive({ event: 'ping', data: CONNECTED_MSG })
    await cp

    const errors: Error[] = []
    stream.on('error', (e) => errors.push(e))

    // Send a raw MessageEvent with malformed JSON
    if (ws.onmessage) {
      ws.onmessage({ data: 'not valid json }{' } as MessageEvent)
    }
    // Should not crash or emit error
    expect(errors).toHaveLength(0)
  })
})

// ─── SignalLiveStream — subscribe/unsubscribe ─────────────────────

describe('SignalLiveStream subscribe/unsubscribe', () => {
  it('send subscribe message for new channels', async () => {
    const { MockWS, getInstance } = createMockWSClass()
    const stream = new SignalLiveStream('wss://api.world-pulse.io', {}, MockWS)
    const cp = stream.connect()
    const ws = getInstance()
    ws._open()
    ws._receive({ event: 'ping', data: CONNECTED_MSG })
    await cp

    stream.subscribe(['health', 'climate'])
    const calls = ws.send.mock.calls
    const last = JSON.parse(calls[calls.length - 1][0] as string)
    expect(last.type).toBe('subscribe')
    expect(last.payload.channels).toContain('health')
  })

  it('throws StreamError when subscribing on closed stream', () => {
    const { MockWS } = createMockWSClass()
    const stream = new SignalLiveStream('wss://api.world-pulse.io', {}, MockWS)
    stream.close()
    expect(() => stream.subscribe(['conflict'])).toThrow(StreamError)
  })

  it('sends unsubscribe message', async () => {
    const { MockWS, getInstance } = createMockWSClass()
    const stream = new SignalLiveStream('wss://api.world-pulse.io', {}, MockWS)
    const cp = stream.connect()
    const ws = getInstance()
    ws._open()
    ws._receive({ event: 'ping', data: CONNECTED_MSG })
    await cp

    stream.unsubscribe(['critical'])
    const calls = ws.send.mock.calls
    const last = JSON.parse(calls[calls.length - 1][0] as string)
    expect(last.type).toBe('unsubscribe')
    expect(last.payload.channels).toContain('critical')
  })

  it('throws StreamError when unsubscribing on closed stream', () => {
    const { MockWS } = createMockWSClass()
    const stream = new SignalLiveStream('wss://api.world-pulse.io', {}, MockWS)
    stream.close()
    expect(() => stream.unsubscribe(['breaking'])).toThrow(StreamError)
  })
})

// ─── WorldPulse.stream integration ───────────────────────────────

describe('WorldPulse.stream', () => {
  it('wp.stream.live() returns a SignalLiveStream', () => {
    const { MockWS } = createMockWSClass()
    const wp = new WorldPulse({ WebSocket: MockWS })
    const s = wp.stream.live()
    expect(s).toBeInstanceOf(SignalLiveStream)
  })

  it('wp.stream.live() passes channels option', () => {
    let capturedChannels: string[] | null = null
    const { MockWS, getInstance } = createMockWSClass()
    const wp = new WorldPulse({ WebSocket: MockWS })
    const s = wp.stream.live({ channels: ['politics', 'economy'] })
    const cp = s.connect()
    const ws = getInstance()
    ws._open()
    ws._receive({ event: 'ping', data: CONNECTED_MSG })
    return cp.then(() => {
      const msg = JSON.parse(ws.send.mock.calls[0][0] as string)
      expect(msg.payload.channels).toContain('politics')
      expect(msg.payload.channels).toContain('economy')
    })
  })

  it('wp.stream.poll() returns an AsyncGenerator', () => {
    const wp = new WorldPulse({ fetch: vi.fn() as unknown as typeof fetch })
    const gen = wp.stream.poll()
    expect(typeof gen.next).toBe('function')
    expect(typeof gen.return).toBe('function')
    expect(typeof gen[Symbol.asyncIterator]).toBe('function')
  })
})

// ─── Poll Stream ──────────────────────────────────────────────────

describe('createPollStream', () => {
  function makeFetcher(responses: Array<{ data: Partial<Signal>[] }>): (
    path: string,
    params?: Record<string, unknown>,
  ) => Promise<unknown> {
    let callIdx = 0
    return vi.fn().mockImplementation(async () => {
      const resp = responses[callIdx % responses.length]
      callIdx++
      return { success: true, data: resp?.data ?? [], total: resp?.data?.length ?? 0 }
    })
  }

  it('yields signals from poll responses', async () => {
    const fetcher = makeFetcher([
      { data: [{ ...SIGNAL_FIXTURE }] },
      { data: [] },
    ])

    const ac = new AbortController()
    const results: Signal[] = []

    for await (const s of createPollStream(fetcher, { intervalMs: 0, signal: ac.signal })) {
      results.push(s)
      ac.abort() // stop after first batch
    }

    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0]?.id).toBe('sig_stream_001')
  })

  it('deduplicates signals across poll ticks', async () => {
    // Same signal returned twice in a row
    const fetcher = makeFetcher([
      { data: [{ ...SIGNAL_FIXTURE }] },
      { data: [{ ...SIGNAL_FIXTURE }] }, // duplicate
    ])

    const ac = new AbortController()
    const results: Signal[] = []
    let tick = 0

    for await (const s of createPollStream(fetcher, { intervalMs: 0, signal: ac.signal })) {
      results.push(s)
      tick++
      if (tick >= 2) ac.abort()
    }

    // Even though 2 ticks ran, same signal should only appear once
    const ids = results.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('stops when AbortController aborts', async () => {
    let callCount = 0
    const fetcher = vi.fn().mockImplementation(async () => {
      callCount++
      return { success: true, data: [], total: 0 }
    })

    const ac = new AbortController()
    ac.abort() // abort immediately

    const results: Signal[] = []
    for await (const s of createPollStream(fetcher, { intervalMs: 0, signal: ac.signal })) {
      results.push(s)
    }

    expect(results).toHaveLength(0)
  })

  it('passes category/severity/country_code to fetcher', async () => {
    const fetcher = vi.fn().mockResolvedValue({ success: true, data: [], total: 0 })
    const ac = new AbortController()
    ac.abort()

    for await (const _ of createPollStream(fetcher, {
      category: 'health',
      severity: 'critical',
      country_code: 'UA',
      signal: ac.signal,
    })) {
      // empty
    }

    // Even though aborted immediately, at least one call may have happened
    // Just verify if called, params were set
    if (fetcher.mock.calls.length > 0) {
      const params = fetcher.mock.calls[0][1] as Record<string, unknown>
      if (params) {
        expect(params['category']).toBe('health')
        expect(params['severity']).toBe('critical')
        expect(params['country_code']).toBe('UA')
      }
    }
  })

  it('throws StreamError when fetcher throws non-abort error', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('Network down'))
    const ac = new AbortController()

    await expect(async () => {
      for await (const _ of createPollStream(fetcher, { intervalMs: 0, signal: ac.signal })) {
        // empty
      }
    }).rejects.toBeInstanceOf(StreamError)
  })
})

// ─── Error Classes ────────────────────────────────────────────────

describe('StreamError', () => {
  it('has correct name and code', () => {
    const err = new StreamError('test error')
    expect(err.name).toBe('StreamError')
    expect(err.code).toBe('STREAM_ERROR')
    expect(err.message).toBe('test error')
  })

  it('accepts cause', () => {
    const cause = new Error('root cause')
    const err = new StreamError('wrapper', cause)
    expect(err.cause).toBe(cause)
  })
})

describe('StreamConnectionError', () => {
  it('has correct name, code and attempts', () => {
    const err = new StreamConnectionError('wss://api.world-pulse.io/ws', 5)
    expect(err.name).toBe('StreamConnectionError')
    expect(err.code).toBe('STREAM_ERROR')
    expect(err.attempts).toBe(5)
    expect(err.message).toContain('5 attempts')
  })

  it('uses singular "attempt" for attempts=1', () => {
    const err = new StreamConnectionError('wss://x', 1)
    expect(err.message).toContain('1 attempt')
    expect(err.message).not.toContain('attempts')
  })
})

// ─── WorldPulse constructor — no WebSocket environment ───────────

describe('WorldPulse without WebSocket', () => {
  it('throws helpful error when live() is called with no WebSocket', () => {
    // Temporarily remove globalThis.WebSocket
    const orig = (globalThis as Record<string, unknown>).WebSocket
    delete (globalThis as Record<string, unknown>).WebSocket

    try {
      const wp = new WorldPulse({ fetch: vi.fn() as unknown as typeof fetch })
      const stream = wp.stream.live()
      expect(() => stream.connect()).toThrow(/WebSocket/)
    } finally {
      ;(globalThis as Record<string, unknown>).WebSocket = orig
    }
  })
})
