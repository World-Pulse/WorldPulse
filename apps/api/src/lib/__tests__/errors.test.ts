/**
 * errors.test.ts — Unit tests for the centralized error response helper
 */

import { describe, it, expect, vi } from 'vitest'
import {
  sendError,
  badRequest,
  validationError,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  rateLimited,
  internalError,
  serviceUnavailable,
  type ApiError,
  type ErrorCode,
} from '../errors'
import type { FastifyReply } from 'fastify'

// ─── Mock FastifyReply ────────────────────────────────────────────────────────

function makeMockReply() {
  const sentBody: Record<string, unknown>[] = []
  let statusCode = 200

  const reply = {
    code(n: number) {
      statusCode = n
      return reply
    },
    send(body: unknown) {
      sentBody.push(body as Record<string, unknown>)
      return reply
    },
    get _statusCode() { return statusCode },
    get _body() { return sentBody[0] },
  }

  return reply as unknown as FastifyReply & { _statusCode: number; _body: Record<string, unknown> }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('sendError', () => {
  it('sets the correct HTTP status code', () => {
    const reply = makeMockReply()
    sendError(reply, 404, 'NOT_FOUND', 'Signal not found')
    expect((reply as unknown as { _statusCode: number })._statusCode).toBe(404)
  })

  it('sends the canonical ApiError shape', () => {
    const reply = makeMockReply()
    sendError(reply, 400, 'VALIDATION_ERROR', 'bbox must be 4 numbers')
    const body = (reply as unknown as { _body: ApiError })._body
    expect(body).toEqual({
      success: false,
      code:    'VALIDATION_ERROR',
      error:   'bbox must be 4 numbers',
    })
    expect(body.success).toBe(false)
  })

  it('works for all defined ErrorCode values', () => {
    const codes: ErrorCode[] = [
      'BAD_REQUEST', 'VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN',
      'NOT_FOUND', 'CONFLICT', 'RATE_LIMITED', 'INTERNAL_ERROR', 'SERVICE_UNAVAILABLE',
    ]
    for (const code of codes) {
      const reply = makeMockReply()
      sendError(reply, 400, code, 'test')
      const body = (reply as unknown as { _body: ApiError })._body
      expect(body.code).toBe(code)
      expect(body.success).toBe(false)
    }
  })

  it('preserves the error message exactly', () => {
    const reply = makeMockReply()
    const msg = 'Custom error with special chars: <>&"'
    sendError(reply, 500, 'INTERNAL_ERROR', msg)
    const body = (reply as unknown as { _body: ApiError })._body
    expect(body.error).toBe(msg)
  })
})

describe('convenience shorthands', () => {
  it('badRequest sends 400 + BAD_REQUEST', () => {
    const reply = makeMockReply()
    badRequest(reply, 'missing field')
    expect((reply as unknown as { _statusCode: number })._statusCode).toBe(400)
    expect((reply as unknown as { _body: ApiError })._body.code).toBe('BAD_REQUEST')
  })

  it('validationError sends 400 + VALIDATION_ERROR', () => {
    const reply = makeMockReply()
    validationError(reply, 'invalid bbox')
    expect((reply as unknown as { _statusCode: number })._statusCode).toBe(400)
    expect((reply as unknown as { _body: ApiError })._body.code).toBe('VALIDATION_ERROR')
  })

  it('unauthorized sends 401 with default message', () => {
    const reply = makeMockReply()
    unauthorized(reply)
    expect((reply as unknown as { _statusCode: number })._statusCode).toBe(401)
    expect((reply as unknown as { _body: ApiError })._body.error).toBe('Authentication required')
  })

  it('forbidden sends 403', () => {
    const reply = makeMockReply()
    forbidden(reply, 'Admin only')
    expect((reply as unknown as { _statusCode: number })._statusCode).toBe(403)
    expect((reply as unknown as { _body: ApiError })._body.code).toBe('FORBIDDEN')
  })

  it('notFound sends 404 with default message', () => {
    const reply = makeMockReply()
    notFound(reply)
    expect((reply as unknown as { _statusCode: number })._statusCode).toBe(404)
    expect((reply as unknown as { _body: ApiError })._body.error).toBe('Not found')
  })

  it('conflict sends 409', () => {
    const reply = makeMockReply()
    conflict(reply, 'Already flagged')
    expect((reply as unknown as { _statusCode: number })._statusCode).toBe(409)
    expect((reply as unknown as { _body: ApiError })._body.code).toBe('CONFLICT')
  })

  it('rateLimited sends 429', () => {
    const reply = makeMockReply()
    rateLimited(reply)
    expect((reply as unknown as { _statusCode: number })._statusCode).toBe(429)
    expect((reply as unknown as { _body: ApiError })._body.code).toBe('RATE_LIMITED')
  })

  it('internalError sends 500', () => {
    const reply = makeMockReply()
    internalError(reply)
    expect((reply as unknown as { _statusCode: number })._statusCode).toBe(500)
    expect((reply as unknown as { _body: ApiError })._body.code).toBe('INTERNAL_ERROR')
  })

  it('serviceUnavailable sends 503', () => {
    const reply = makeMockReply()
    serviceUnavailable(reply)
    expect((reply as unknown as { _statusCode: number })._statusCode).toBe(503)
    expect((reply as unknown as { _body: ApiError })._body.code).toBe('SERVICE_UNAVAILABLE')
  })
})
