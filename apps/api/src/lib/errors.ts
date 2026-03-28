/**
 * errors.ts — Centralized API error response helper
 *
 * Enforces a single canonical error shape across all WorldPulse API routes:
 *   { success: false, code: ErrorCode, error: string }
 *
 * Usage:
 *   import { sendError } from '../lib/errors'
 *   return sendError(reply, 400, 'VALIDATION_ERROR', 'bbox must be 4 numbers')
 */

import type { FastifyReply } from 'fastify'

// ─── Error Code Enum ─────────────────────────────────────────────────────────

/** Standard error codes used across the WorldPulse API */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE'

// ─── Canonical Error Response Shape ─────────────────────────────────────────

/** Canonical API error response shape — all error replies must match this */
export interface ApiError {
  success: false
  code:    ErrorCode
  error:   string
}

// ─── sendError Helper ────────────────────────────────────────────────────────

/**
 * Send a standardized JSON error response.
 *
 * @param reply   - Fastify reply object
 * @param status  - HTTP status code (400, 401, 403, 404, 409, 429, 500, 503, …)
 * @param code    - Machine-readable error code (one of ErrorCode)
 * @param message - Human-readable error description
 *
 * @example
 *   return sendError(reply, 404, 'NOT_FOUND', 'Signal not found')
 *   return sendError(reply, 400, 'VALIDATION_ERROR', 'bbox must be 4 finite numbers')
 *   return sendError(reply, 401, 'UNAUTHORIZED', 'Authentication required')
 */
export function sendError(
  reply:   FastifyReply,
  status:  number,
  code:    ErrorCode,
  message: string,
): ReturnType<FastifyReply['send']> {
  const body: ApiError = { success: false, code, error: message }
  return reply.code(status).send(body)
}

// ─── Convenience Shorthands ───────────────────────────────────────────────────

/** 400 Bad Request */
export const badRequest = (reply: FastifyReply, message: string) =>
  sendError(reply, 400, 'BAD_REQUEST', message)

/** 400 Validation Error (malformed input) */
export const validationError = (reply: FastifyReply, message: string) =>
  sendError(reply, 400, 'VALIDATION_ERROR', message)

/** 401 Unauthorized */
export const unauthorized = (reply: FastifyReply, message = 'Authentication required') =>
  sendError(reply, 401, 'UNAUTHORIZED', message)

/** 403 Forbidden */
export const forbidden = (reply: FastifyReply, message = 'Forbidden') =>
  sendError(reply, 403, 'FORBIDDEN', message)

/** 404 Not Found */
export const notFound = (reply: FastifyReply, message = 'Not found') =>
  sendError(reply, 404, 'NOT_FOUND', message)

/** 409 Conflict */
export const conflict = (reply: FastifyReply, message: string) =>
  sendError(reply, 409, 'CONFLICT', message)

/** 429 Rate Limited */
export const rateLimited = (reply: FastifyReply, message = 'Too many requests') =>
  sendError(reply, 429, 'RATE_LIMITED', message)

/** 500 Internal Error */
export const internalError = (reply: FastifyReply, message = 'Internal server error') =>
  sendError(reply, 500, 'INTERNAL_ERROR', message)

/** 503 Service Unavailable */
export const serviceUnavailable = (reply: FastifyReply, message = 'Service temporarily unavailable') =>
  sendError(reply, 503, 'SERVICE_UNAVAILABLE', message)
