/**
 * One error body (plan V3f): every 4xx or 5xx answer is
 * { success: false, code, error, statusCode }, whoever sent it, keeping what
 * else the route said; JSON-RPC (MCP) answers and non-JSON answers as sent.
 * Through a Fastify app with the API's own error handler and hook.
 */
import { describe, it, expect } from 'vitest'
import Fastify, { type FastifyError } from 'fastify'
import { errorBody, errorCode, errorPayload, registerErrorBody } from '../error-body'
import { errorReply } from '../error-reply'
import { sendError } from '../errors'

describe('the error code', () => {
  it("an endpoint's own word, or the status's", () => {
    expect(errorCode(409, 'SOURCE_EXISTS')).toBe('SOURCE_EXISTS')
    expect(errorCode(400, 'FST_ERR_VALIDATION')).toBe('VALIDATION_ERROR')
    expect(errorCode(415, 'FST_ERR_CTP_INVALID_MEDIA_TYPE')).toBe('BAD_REQUEST')
    expect(errorCode(500, '42703')).toBe('INTERNAL_ERROR')
    expect(errorCode(404)).toBe('NOT_FOUND')
    expect(errorCode(401, 'not a word')).toBe('UNAUTHORIZED')
    expect(errorCode(429)).toBe('RATE_LIMITED')
    expect(errorCode(503)).toBe('SERVICE_UNAVAILABLE')
    expect(errorCode(418)).toBe('BAD_REQUEST')
  })
})

describe('the body', () => {
  it('fills in what a route left out, and keeps what it said', () => {
    expect(errorBody(404, { error: 'Entity not found' })).toEqual({ success: false, code: 'NOT_FOUND', error: 'Entity not found', statusCode: 404 })
    expect(errorBody(400, { success: false, error: 'Unknown topic', topics: ['a', 'b'] }))
      .toEqual({ success: false, code: 'BAD_REQUEST', error: 'Unknown topic', topics: ['a', 'b'], statusCode: 400 })
    // a status's name gives way to the words
    expect(errorBody(400, { statusCode: 400, error: 'Bad Request', message: 'body/reason must be one of spam, abuse' }))
      .toMatchObject({ code: 'BAD_REQUEST', error: 'body/reason must be one of spam, abuse', message: 'body/reason must be one of spam, abuse' })
    // nothing in words: the status's name
    expect(errorBody(403, {})).toEqual({ success: false, code: 'FORBIDDEN', error: 'Forbidden', statusCode: 403 })
  })

  it('leaves alone what is not a JSON object, a JSON-RPC answer, or not an error', () => {
    const rpc = JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } })
    expect(errorPayload(400, 'application/json', rpc)).toBe(rpc)
    expect(errorPayload(400, 'application/xml', '<error/>')).toBe('<error/>')
    expect(errorPayload(400, 'application/json', '[1,2]')).toBe('[1,2]')
    expect(errorPayload(400, 'application/json', 'not json')).toBe('not json')
    expect(errorPayload(200, 'application/json', '{"ok":true}')).toBe('{"ok":true}')
  })
})

describe('through the API', () => {
  async function app() {
    const a = Fastify()
    a.setErrorHandler((err: FastifyError, _req, reply) => {
      const { status, body } = errorReply(err)
      return reply.status(status).send(body)
    })
    registerErrorBody(a)
    a.get('/old', async (_req, reply) => reply.code(404).send({ error: 'Entity not found' }))
    a.get('/helper', async (_req, reply) => sendError(reply, 409, 'CONFLICT', 'Already reported'))
    a.get('/own-code', async (_req, reply) => reply.code(409).send({ success: false, code: 'SOURCE_EXISTS', error: 'That source is already listed' }))
    a.get('/limit', { schema: { querystring: { type: 'object', properties: { limit: { type: 'integer', maximum: 100 } } } } }, async () => ({ ok: true }))
    a.get('/broken', async () => { throw Object.assign(new Error('column "source_id" does not exist'), { code: '42703' }) })
    a.post('/mcp', async (_req, reply) => reply.code(400).send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }))
    a.get('/feed', async (_req, reply) => reply.code(400).type('application/rss+xml').send('<rss/>'))
    a.get('/fine', async () => ({ success: true, data: [] }))
    return a
  }

  it('every error, one shape', async () => {
    const a = await app()
    const get = async (url: string, method: 'GET' | 'POST' = 'GET') => {
      const res = await a.inject({ method, url })
      return { status: res.statusCode, body: res.headers['content-type']?.toString().includes('json') ? res.json() : res.body }
    }
    expect(await get('/old')).toEqual({ status: 404, body: { success: false, code: 'NOT_FOUND', error: 'Entity not found', statusCode: 404 } })
    expect(await get('/helper')).toEqual({ status: 409, body: { success: false, code: 'CONFLICT', error: 'Already reported', statusCode: 409 } })
    expect((await get('/own-code')).body).toMatchObject({ code: 'SOURCE_EXISTS', error: 'That source is already listed', statusCode: 409 })
    expect(await get('/limit?limit=500')).toMatchObject({ status: 400, body: { success: false, code: 'VALIDATION_ERROR', statusCode: 400 } })
    expect((await get('/limit?limit=500')).body.error).toMatch(/limit/)
    const broken = await get('/broken')
    expect(broken).toEqual({ status: 500, body: { success: false, code: 'INTERNAL_ERROR', error: 'Something went wrong on our side.', message: 'Something went wrong on our side.', statusCode: 500 } })
    expect(JSON.stringify(broken.body)).not.toContain('source_id')
    // an address the API doesn't have
    expect(await get('/nowhere')).toMatchObject({ status: 404, body: { success: false, code: 'NOT_FOUND', statusCode: 404 } })
    // as sent
    expect((await get('/mcp', 'POST')).body).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } })
    expect(await get('/feed')).toEqual({ status: 400, body: '<rss/>' })
    expect(await get('/fine')).toEqual({ status: 200, body: { success: true, data: [] } })
    await a.close()
  })
})
