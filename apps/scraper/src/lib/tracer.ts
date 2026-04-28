/**
 * Lightweight OpenTelemetry-compatible tracer for the WorldPulse scraper pipeline.
 *
 * Emits structured pino log entries with span metadata. The log format is
 * intentionally compatible with the OpenTelemetry log data model so that a
 * log-collector (Grafana Loki, Datadog, OpenSearch) can correlate spans
 * without a full OTel SDK install.
 *
 * To upgrade to the real OTel SDK later:
 *   pnpm add @opentelemetry/api @opentelemetry/sdk-trace-node --filter @worldpulse/scraper
 *   Replace startSpan() with api.trace.getTracer('worldpulse-scraper').startActiveSpan()
 *
 * Field mapping to OTel:
 *   traceId   → trace.id
 *   spanId    → span.id
 *   parentId  → parent.span.id
 *   operation → span.name
 *   status    → span.status (ok | error)
 *   duration_ms → span.duration (milliseconds)
 */

import { randomBytes } from 'crypto'
import { logger } from './logger'

function generateId(bytes: number): string {
  return randomBytes(bytes).toString('hex')
}

export interface Span {
  traceId: string
  spanId:  string
  parentId: string | null
  operation: string
  startMs: number
  attributes: Record<string, string | number | boolean>
  end(status?: 'ok' | 'error', error?: Error): void
}

/** Ambient trace context (simple async-local replacement — sufficient for Node) */
let _currentTraceId: string | null = null
let _currentSpanId:  string | null = null

function makeSpan(operation: string, parentId: string | null, traceId: string): Span {
  const spanId  = generateId(8)
  const startMs = Date.now()
  const attributes: Record<string, string | number | boolean> = {}

  const span: Span = {
    traceId,
    spanId,
    parentId,
    operation,
    startMs,
    attributes,
    end(status: 'ok' | 'error' = 'ok', error?: Error) {
      const duration_ms = Date.now() - startMs
      const logLevel = status === 'error' ? 'error' : 'debug'

      logger[logLevel]({
        'trace.id':      traceId,
        'span.id':       spanId,
        'parent.span.id': parentId ?? undefined,
        'span.name':     operation,
        'span.status':   status,
        'span.duration_ms': duration_ms,
        ...(error ? { err: { message: error.message, stack: error.stack } } : {}),
        ...attributes,
      }, `[trace] ${operation} — ${duration_ms}ms [${status}]`)
    },
  }

  return span
}

/**
 * Start a trace span wrapping an async function.
 *
 * Usage:
 *   const result = await startSpan('scraper.fetch', async (span) => {
 *     span.attributes.sourceId = source.id
 *     return fetch(url)
 *   })
 */
export async function startSpan<T>(
  operation: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  // If we're inside an existing trace, create a child span; otherwise start a new trace
  const traceId  = _currentTraceId ?? generateId(16)
  const parentId = _currentSpanId ?? null

  const span = makeSpan(operation, parentId, traceId)

  // Save previous context (simplified — use AsyncLocalStorage for true nested spans)
  const prevTraceId = _currentTraceId
  const prevSpanId  = _currentSpanId
  _currentTraceId = traceId
  _currentSpanId  = span.spanId

  try {
    const result = await fn(span)
    span.end('ok')
    return result
  } catch (err) {
    span.end('error', err instanceof Error ? err : new Error(String(err)))
    throw err
  } finally {
    // Restore parent context
    _currentTraceId = prevTraceId
    _currentSpanId  = prevSpanId
  }
}

/**
 * Start a root span (always creates a new traceId).
 * Use this at the top of a scrape cycle.
 */
export async function startRootSpan<T>(
  operation: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  _currentTraceId = null
  _currentSpanId  = null
  return startSpan(operation, fn)
}

/** Attach an attribute to the current active span (best-effort). */
export function setAttribute(key: string, value: string | number | boolean): void {
  // No-op if no current span — attributes are set directly on the Span object
  // via the fn(span) callback pattern
  logger.debug({ 'span.attr': { [key]: value } }, 'setAttribute (no active span handle)')
}
