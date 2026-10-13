/**
 * Profile addresses answer 404 when no account has the handle (Oct 13, 2026):
 * every address used to be a 200 "page" (lib/profile-exists.ts).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleOf, profileStatus } from '../profile-exists'
import { clearServerFetchCache } from '../server-fetch'

// (the API's answers are kept a few minutes, lib/server-fetch.ts: forget them between cases)
afterEach(() => { vi.unstubAllGlobals(); clearServerFetchCache() })

describe('handleOf', () => {
  it('reads handles as sign-up allows them, with or without @', () => {
    expect(handleOf('devon_g')).toBe('devon_g')
    expect(handleOf('%40Devon_G')).toBe('Devon_G')
    expect(handleOf('not-a-real-page')).toBeNull()
    expect(handleOf('ab')).toBeNull()
    expect(handleOf('wp-login.php')).toBeNull()
  })
})

describe('profileStatus', () => {
  it("is 'missing' for a non-handle without asking the API", async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(await profileStatus('not-a-real-page')).toBe('missing')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('follows the API: 404 missing, 200 exists, anything else unknown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    expect(await profileStatus('nobody_here')).toBe('missing')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    expect(await profileStatus('devon_g')).toBe('exists')
    clearServerFetchCache()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
    expect(await profileStatus('devon_g')).toBe('unknown')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    expect(await profileStatus('devon_g')).toBe('unknown')
  })

  it('asks the API once for a handle seen in the last few minutes', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    expect(await profileStatus('devon_g')).toBe('exists')
    expect(await profileStatus('devon_g')).toBe('exists')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
