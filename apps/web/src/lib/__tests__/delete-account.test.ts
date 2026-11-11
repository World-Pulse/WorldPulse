import { describe, it, expect, vi } from 'vitest'
import { deleteMyAccount, DELETE_HELP } from '../delete-account'

const answer = (status: number) => vi.fn(async () => new Response(status === 204 ? null : '{}', { status })) as unknown as typeof fetch

describe('deleting the signed-in account (Nov 11, 2026)', () => {
  it('is done only when the server says so', async () => {
    expect(await deleteMyAccount('https://api.example.com', 't', answer(204))).toBe(true)
    expect(await deleteMyAccount('https://api.example.com', 't', answer(200))).toBe(true)
    // the server had no delete route: a 404 was taken for done, and the reader signed out with the account still there
    expect(await deleteMyAccount('https://api.example.com', 't', answer(404))).toBe(false)
    expect(await deleteMyAccount('https://api.example.com', 't', answer(500))).toBe(false)
    expect(await deleteMyAccount('https://api.example.com', 't', vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch)).toBe(false)
  })

  it('asks the server with the sign-in, and says how else to have it deleted', async () => {
    const fetcher = answer(204)
    await deleteMyAccount('https://api.example.com', 'tok', fetcher)
    expect(fetcher).toHaveBeenCalledWith('https://api.example.com/api/v1/users/me', { method: 'DELETE', headers: { Authorization: 'Bearer tok' } })
    expect(DELETE_HELP).toMatch(/support@world-pulse\.io/)
  })
})
