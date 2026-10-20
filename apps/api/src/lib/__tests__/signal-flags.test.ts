/** Readers' flags (lib/signal-flags.ts, H-0020, Oct 20, 2026) */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ wheres: [] as Array<Record<string, unknown>>, nullUser: 0, found: null as unknown, rows: [] as Array<Record<string, unknown>>, updates: [] as Array<Record<string, unknown>> }))

vi.mock('../../db/postgres', () => {
  function builder() {
    const b: Record<string, unknown> = {}
    b.where = (w: Record<string, unknown> | string, v?: unknown) => { h.wheres.push(typeof w === 'string' ? { [w]: v } : w); return b }
    b.whereNull = () => { h.nullUser++; return b }
    b.whereNotNull = () => b
    b.whereRaw = () => b
    b.select = () => b
    b.limit = () => Promise.resolve(h.rows)
    b.first = () => Promise.resolve(h.found)
    b.update = (data: Record<string, unknown>) => { h.updates.push(data); return Promise.resolve(1) }
    return b
  }
  return { db: vi.fn(() => builder()) }
})
vi.mock('../logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }))

import { visitorHash, alreadyFlagged, hashStoredFlagAddresses } from '../signal-flags'

describe('visitorHash', () => {
  it('is 64 hex characters, the same for the same address, and not the address', () => {
    const a = visitorHash('203.0.113.7')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(visitorHash(' 203.0.113.7 ')).toBe(a)
    expect(visitorHash('203.0.113.8')).not.toBe(a)
    expect(a).not.toContain(Buffer.from('203.0.113.7').toString('base64').slice(0, 12))
  })
})

describe('alreadyFlagged', () => {
  beforeEach(() => { h.wheres.length = 0; h.nullUser = 0; h.found = null })

  it('checks a signed-in reader by account', async () => {
    h.found = { id: 'f1' }
    expect(await alreadyFlagged('s1', 'u1', visitorHash('1.2.3.4'))).toBe(true)
    expect(h.wheres[0]).toEqual({ signal_id: 's1', user_id: 'u1' })
  })

  it('checks an anonymous visitor by hashed address, among anonymous flags (the hole H-0020 found)', async () => {
    h.found = { id: 'f2' }
    const ip = visitorHash('1.2.3.4')
    expect(await alreadyFlagged('s1', null, ip)).toBe(true)
    expect(h.wheres[0]).toEqual({ signal_id: 's1', ip_hash: ip })
    expect(h.nullUser).toBe(1)
  })

  it('lets a first flag through', async () => {
    expect(await alreadyFlagged('s1', null, visitorHash('1.2.3.4'))).toBe(false)
    expect(await alreadyFlagged('s1', null, null)).toBe(false)
  })
})

describe('hashStoredFlagAddresses', () => {
  beforeEach(() => { h.updates.length = 0 })

  it('turns stored base64 addresses into the keyed hash of the address', async () => {
    h.rows = [{ id: 'f1', ip_hash: Buffer.from('198.51.100.4').toString('base64').slice(0, 32) }]
    expect(await hashStoredFlagAddresses()).toBe(1)
    expect(h.updates[0]).toEqual({ ip_hash: visitorHash('198.51.100.4') })
  })

  it('leaves rows already hashed alone', async () => {
    h.rows = [{ id: 'f2', ip_hash: visitorHash('198.51.100.4') }]
    expect(await hashStoredFlagAddresses()).toBe(0)
    expect(h.updates).toEqual([])
  })
})
