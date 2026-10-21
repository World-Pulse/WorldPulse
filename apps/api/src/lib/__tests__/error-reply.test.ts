import { describe, it, expect } from 'vitest'
import { errorReply } from '../error-reply'

describe('errorReply', () => {
  it('answers an unexpected error without its internals', () => {
    const db = Object.assign(new Error('select "id" from "signals" - column "source_id" does not exist'), { code: '42703' })
    const r = errorReply(db)
    expect(r.status).toBe(500)
    expect(r.internal).toBe(true)
    expect(r.body).toEqual({
      success: false, statusCode: 500, code: 'INTERNAL_ERROR',
      error: 'Something went wrong on our side.', message: 'Something went wrong on our side.',
    })
    expect(JSON.stringify(r.body)).not.toContain('source_id')
    expect(JSON.stringify(r.body)).not.toContain('42703')
  })

  it('keeps the message of a 4xx error, in the one error body (plan V3f)', () => {
    const bad = Object.assign(new Error('querystring/limit must be <= 100'), { statusCode: 400, code: 'FST_ERR_VALIDATION' })
    expect(errorReply(bad)).toEqual({
      status: 400, internal: false,
      body: { success: false, statusCode: 400, code: 'VALIDATION_ERROR', error: 'querystring/limit must be <= 100', message: 'querystring/limit must be <= 100' },
    })
    const limited = errorReply(Object.assign(new Error('Too many requests. Slow down.'), { statusCode: 429, code: 'RATE_LIMITED' }))
    expect(limited.body).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED', error: 'Too many requests. Slow down.' })
    // Fastify's own codes become the status's word
    expect(errorReply(Object.assign(new Error('Unsupported Media Type: text/csv'), { statusCode: 415, code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE' })).body.code).toBe('BAD_REQUEST')
  })
})
