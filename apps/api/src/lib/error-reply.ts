/**
 * What the API answers when a request fails (index.ts setErrorHandler).
 * An unexpected error (a 5xx) answers without its internals: a database
 * error used to come back word for word ("select … from "signals" … - column
 * "source_id" does not exist", Oct 11, 2026). Errors with a 4xx status
 * (validation, not found, rate limits) keep their message.
 */

import { STATUS_CODES } from 'node:http'

export interface ErrorLike {
  statusCode?: number
  code?: string
  message: string
}

export function errorReply(err: ErrorLike): {
  status: number
  /** True when the error is ours (log it, report it) */
  internal: boolean
  body: { statusCode: number; error: string; message: string; code?: string }
} {
  const status = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500
  if (status >= 500) {
    return {
      status,
      internal: true,
      body: { statusCode: status, error: STATUS_CODES[status] ?? 'Internal Server Error', message: 'Something went wrong on our side.' },
    }
  }
  return {
    status,
    internal: false,
    body: { statusCode: status, ...(err.code ? { code: err.code } : {}), error: STATUS_CODES[status] ?? 'Error', message: err.message },
  }
}
