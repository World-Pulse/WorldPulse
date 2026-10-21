/**
 * What the API answers when a request fails (index.ts setErrorHandler).
 * An unexpected error (a 5xx) answers without its internals: a database
 * error used to come back word for word ("select … from "signals" … - column
 * "source_id" does not exist", Oct 11, 2026). Errors with a 4xx status
 * (validation, not found, rate limits) keep their message.
 *
 * The body is the API's one error body (lib/error-body.ts, plan V3f):
 * { success: false, code, error, statusCode }, with `message` as before.
 */

import { errorCode } from './error-body'

export interface ErrorLike {
  statusCode?: number
  code?: string
  message: string
}

export function errorReply(err: ErrorLike): {
  status: number
  /** True when the error is ours (log it, report it) */
  internal: boolean
  body: { success: false; statusCode: number; code: string; error: string; message: string }
} {
  const status = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500
  if (status >= 500) {
    const words = 'Something went wrong on our side.'
    return {
      status,
      internal: true,
      body: { success: false, statusCode: status, code: errorCode(status), error: words, message: words },
    }
  }
  const words = err.message || 'The request could not be answered.'
  return {
    status,
    internal: false,
    body: { success: false, statusCode: status, code: errorCode(status, err.code), error: words, message: words },
  }
}
