import { describe, it, expect } from 'vitest'
import { errorReply } from '../error-reply'

describe('errorReply', () => {
  it('answers an unexpected error without its internals', () => {
    const db = Object.assign(new Error('select "id" from "signals" - column "source_id" does not exist'), { code: '42703' })
    const r = errorReply(db)
    expect(r.status).toBe(500)
    expect(r.internal).toBe(true)
    expect(r.body).toEqual({ statusCode: 500, error: 'Internal Server Error', message: 'Something went wrong on our side.' })
    expect(JSON.stringify(r.body)).not.toContain('source_id')
  })

  it('keeps the message of a 4xx error', () => {
    const bad = Object.assign(new Error('querystring/limit must be <= 100'), { statusCode: 400, code: 'FST_ERR_VALIDATION' })
    expect(errorReply(bad)).toEqual({
      status: 400, internal: false,
      body: { statusCode: 400, code: 'FST_ERR_VALIDATION', error: 'Bad Request', message: 'querystring/limit must be <= 100' },
    })
    expect(errorReply(Object.assign(new Error('Rate limit exceeded'), { statusCode: 429 })).body.error).toBe('Too Many Requests')
  })
})
