import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import { TRUSTED_PROXIES } from '../client-address'

// Whose address a request counts against (plan V3e, Oct 20, 2026)

async function ipSeen(headers: Record<string, string>, remoteAddress = '172.18.0.5' /* nginx on the Docker network */) {
  const app = Fastify({ trustProxy: TRUSTED_PROXIES })
  app.get('/ip', async req => ({ ip: req.ip }))
  const res = await app.inject({ method: 'GET', url: '/ip', remoteAddress, headers })
  await app.close()
  return (res.json() as { ip: string }).ip
}

describe('the client address behind nginx', () => {
  it('is the address nginx added, not one the client wrote into X-Forwarded-For', async () => {
    // nginx: X-Forwarded-For = what the client sent + ", " + the address it saw
    expect(await ipSeen({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' })).toBe('203.0.113.9')
    expect(await ipSeen({ 'x-forwarded-for': '10.0.0.1, 8.8.8.8, 203.0.113.9' })).toBe('203.0.113.9')
  })
  it('is the address nginx saw for an ordinary client', async () => {
    expect(await ipSeen({ 'x-forwarded-for': '203.0.113.9' })).toBe('203.0.113.9')
  })
  it("is the caller's own address for calls from inside the server", async () => {
    expect(await ipSeen({}, '172.18.0.7')).toBe('172.18.0.7')
  })
  it('ignores X-Forwarded-For from a connection that is not on the private network', async () => {
    expect(await ipSeen({ 'x-forwarded-for': '1.2.3.4' }, '198.51.100.20')).toBe('198.51.100.20')
  })
})
