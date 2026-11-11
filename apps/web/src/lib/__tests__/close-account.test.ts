import { describe, it, expect, vi } from 'vitest'
import { closeMyAccount, CLOSE_HELP, CLOSE_POINTS, CLOSE_AFTER } from '../close-account'
import { signInErrorText, CLOSED_SIGN_IN } from '../sign-in-error'

const answer = (status: number, body: unknown = {}) =>
  vi.fn(async () => new Response(status === 204 ? null : JSON.stringify(body), { status })) as unknown as typeof fetch

describe('closing the signed-in account (Nov 11, 2026: "Don\'t fully delete accounts")', () => {
  it('is done only when the server says so', async () => {
    expect(await closeMyAccount('https://api.example.com', 't', answer(200, { success: true }))).toEqual({ ok: true })
    expect(await closeMyAccount('https://api.example.com', 't', answer(204))).toEqual({ ok: true })
    expect(await closeMyAccount('https://api.example.com', 't', answer(404))).toEqual({ ok: false, message: CLOSE_HELP })
    expect(await closeMyAccount('https://api.example.com', 't', answer(500))).toEqual({ ok: false, message: CLOSE_HELP })
    expect(await closeMyAccount('https://api.example.com', 't', vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch))
      .toEqual({ ok: false, message: CLOSE_HELP })
  })

  it("shows the server's reason when there is one to act on (cancel Pro first)", async () => {
    const pro = "You're on Pro: cancel it first on world-pulse.io/pricing (Manage subscription), then close the account."
    expect(await closeMyAccount('https://api.example.com', 't', answer(409, { success: false, error: pro }))).toEqual({ ok: false, message: pro })
    // a 409 without words, or another error's words, gets the page's own help
    expect(await closeMyAccount('https://api.example.com', 't', answer(409, { success: false }))).toEqual({ ok: false, message: CLOSE_HELP })
    expect(await closeMyAccount('https://api.example.com', 't', answer(500, { error: 'boom' }))).toEqual({ ok: false, message: CLOSE_HELP })
  })

  it('asks the close route with the sign-in, never a delete', async () => {
    const fetcher = answer(200, { success: true })
    await closeMyAccount('https://api.example.com', 'tok', fetcher)
    expect(fetcher).toHaveBeenCalledWith('https://api.example.com/api/v1/users/me/close', { method: 'POST', headers: { Authorization: 'Bearer tok' } })
  })

  it('says what closing does before the reader confirms: nothing deleted, and how to open it again', () => {
    expect(CLOSE_POINTS.join(' ')).toMatch(/signed out/)
    expect(CLOSE_POINTS.join(' ')).toMatch(/API keys, email alerts and WorldPulse emails stop/)
    expect(CLOSE_POINTS.join(' ')).toMatch(/posts and profile stay up/)
    expect(CLOSE_AFTER).toMatch(/^Nothing is deleted\./)
    expect(CLOSE_AFTER).toMatch(/support@world-pulse\.io/)
    expect(CLOSE_HELP).toMatch(/support@world-pulse\.io/)
  })
})

describe("the sign-in page's ?error=", () => {
  it('says a closed account was closed and how to open it again', () => {
    expect(signInErrorText('account_closed')).toBe(CLOSED_SIGN_IN)
    expect(CLOSED_SIGN_IN).toMatch(/support@world-pulse\.io/)
    expect(signInErrorText('account_suspended')).toBe('This account is suspended.')
    expect(signInErrorText('oauth_failed')).toMatch(/GitHub/)
  })

  it('shows nothing for none or one it does not know', () => {
    expect(signInErrorText(null)).toBeNull()
    expect(signInErrorText('')).toBeNull()
    expect(signInErrorText('<script>')).toBeNull()
  })
})
