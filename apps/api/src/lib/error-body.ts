/**
 * One error body (plan V3f, Oct 21, 2026). Every answer with a 4xx or 5xx
 * status is the same JSON:
 *
 *   { "success": false, "code": "NOT_FOUND", "error": "Signal not found", "statusCode": 404 }
 *
 * - code: one word for the kind of error: lib/errors.ts's list
 *   (BAD_REQUEST, VALIDATION_ERROR, UNAUTHORIZED, FORBIDDEN, NOT_FOUND,
 *   CONFLICT, RATE_LIMITED, INTERNAL_ERROR, UPSTREAM_ERROR,
 *   SERVICE_UNAVAILABLE) or an endpoint's own (SOURCE_EXISTS, …);
 * - error: what went wrong, in words.
 *
 * Until now there were four shapes: lib/errors.ts's { success, code, error },
 * the error handler's { statusCode, error: "Bad Request", message }, and
 * routes' { error } and { success: false, error }. Routes keep sending what
 * they send; the API's onSend hook fills in the rest, so nothing a route
 * adds is lost (a list of topics, when to retry), and `message` stays where
 * an error had one. JSON-RPC answers (the MCP server's) are left as they are:
 * their errors have a shape of their own.
 */

import { STATUS_CODES } from 'node:http'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ErrorCode } from './errors'

const CODE_FOR_STATUS: Partial<Record<number, ErrorCode>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  502: 'UPSTREAM_ERROR',
  503: 'SERVICE_UNAVAILABLE',
}

/** The error's code: its own when it has a word for it, else the status's */
export function errorCode(status: number, code?: unknown): string {
  if (code === 'FST_ERR_VALIDATION') return 'VALIDATION_ERROR'
  // an endpoint's own word (SOURCE_EXISTS); not Fastify's internals (FST_ERR_…) or a database's (42703)
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,47}$/.test(code) && !code.startsWith('FST_')) return code
  return CODE_FOR_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST')
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)

/** An error's body in the one shape, keeping whatever else it says */
export function errorBody(status: number, body: Record<string, unknown>): Record<string, unknown> {
  const statusText = STATUS_CODES[status] ?? 'Error'
  const nested = body.error && typeof body.error === 'object' ? (body.error as Record<string, unknown>) : null
  // the words: the error's own, before a status's name ("Bad Request")
  const words = [text(body.error), text(body.message), text(nested?.message)]
  const error = words.find(w => w !== null && w !== statusText) ?? words.find(w => w !== null) ?? statusText
  return {
    ...body,
    success: false,
    code: errorCode(status, body.code ?? nested?.code),
    error,
    statusCode: status,
  }
}

/** A sent error, in the one shape; anything that isn't a JSON object is left as it is */
export function errorPayload(status: number, contentType: unknown, payload: unknown): unknown {
  if (status < 400 || typeof payload !== 'string') return payload
  if (typeof contentType !== 'string' || !contentType.toLowerCase().includes('json')) return payload
  let body: unknown
  try { body = JSON.parse(payload) } catch { return payload }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return payload
  if ('jsonrpc' in body) return payload
  return JSON.stringify(errorBody(status, body as Record<string, unknown>))
}

/** Every error the API answers, in the one shape (index.ts) */
export function registerErrorBody(app: FastifyInstance): void {
  app.addHook('onSend', async (_req: FastifyRequest, reply: FastifyReply, payload: unknown) =>
    errorPayload(reply.statusCode, reply.getHeader('content-type'), payload))
}
