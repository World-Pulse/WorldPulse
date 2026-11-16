/**
 * H-0056 part 2: a daily cap on files and bytes per account for POST /api/v1/uploads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const h = vi.hoisted(() => ({ store: new Map<string, number>(), down: false }))

vi.mock('../db/redis', () => ({
  redis: {
    get: async (k: string) => { if (h.down) throw new Error('down'); return h.store.has(k) ? String(h.store.get(k)) : null },
    incr: async (k: string) => { if (h.down) throw new Error('down'); const v = (h.store.get(k) || 0) + 1; h.store.set(k, v); return v },
    incrby: async (k: string, n: number) => { const v = (h.store.get(k) || 0) + n; h.store.set(k, v); return v },
    expire: async () => 1,
  },
}))
vi.mock('../middleware/auth', () => ({
  authenticate: async (req: { user?: unknown }) => { req.user = { id: 'user-1' } },
}))
vi.mock('sharp', () => ({
  default: () => ({ resize() { return this }, webp() { return this }, toFile: async () => ({}) }),
}))

import { registerUploadRoutes } from '../routes/uploads'
import { UPLOAD_FILES_PER_DAY, UPLOAD_BYTES_PER_DAY, uploadFilesKey, uploadBytesKey } from '../lib/upload-quota'

function body(): { payload: string; headers: Record<string, string> } {
  const b = '----t'
  const payload = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\nxxxx\r\n--${b}--\r\n`
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${b}` } }
}

async function post() {
  const app = Fastify()
  await app.register(registerUploadRoutes, { prefix: '/api/v1/uploads' })
  const r = await app.inject({ method: 'POST', url: '/api/v1/uploads/', ...body() })
  await app.close()
  return r
}

describe('upload daily cap', () => {
  beforeEach(() => { h.store.clear(); h.down = false })

  it('accepts an upload and counts the file and its bytes', async () => {
    const r = await post()
    expect(r.statusCode).toBe(201)
    expect(h.store.get(uploadFilesKey('user-1'))).toBe(1)
    expect(h.store.get(uploadBytesKey('user-1'))).toBe(4)
  })

  it('refuses with 429 once the file cap is reached', async () => {
    h.store.set(uploadFilesKey('user-1'), UPLOAD_FILES_PER_DAY)
    const r = await post()
    expect(r.statusCode).toBe(429)
    expect(h.store.get(uploadFilesKey('user-1'))).toBe(UPLOAD_FILES_PER_DAY)
  })

  it('refuses with 429 once the byte cap is reached', async () => {
    h.store.set(uploadBytesKey('user-1'), UPLOAD_BYTES_PER_DAY)
    expect((await post()).statusCode).toBe(429)
  })

  it('counts each account on its own', async () => {
    h.store.set(uploadFilesKey('someone-else'), UPLOAD_FILES_PER_DAY)
    expect((await post()).statusCode).toBe(201)
  })

  it('still accepts uploads if Redis is down', async () => {
    h.down = true
    expect((await post()).statusCode).toBe(201)
  })
})
