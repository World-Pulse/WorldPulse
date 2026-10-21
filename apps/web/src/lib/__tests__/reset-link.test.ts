/**
 * The password reset page reads its token from the link's #fragment (plan G13).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tokenFromHash } from '../reset-link'

describe('tokenFromHash', () => {
  it('reads #token=…', () => {
    const t = '3f2b8c1e-5d4a-4c3b-9a8e-7f6d5c4b3a21.1792620000.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'
    expect(tokenFromHash(`#token=${t}`)).toBe(t)
    expect(tokenFromHash(`token=${t}`)).toBe(t)
  })

  it('nothing without one', () => {
    expect(tokenFromHash('')).toBe('')
    expect(tokenFromHash('#other=1')).toBe('')
  })
})

describe('the pages', () => {
  const app = join(__dirname, '..', '..', 'app')
  it('sign-in links to "forgot password", which links back', () => {
    expect(readFileSync(join(app, 'auth', 'login', 'page.tsx'), 'utf8')).toContain('href="/auth/forgot-password"')
    expect(readFileSync(join(app, 'auth', 'forgot-password', 'page.tsx'), 'utf8')).toContain('/api/v1/auth/forgot-password')
  })

  it("the reset page takes the token out of the address bar and doesn't export anything but the page", () => {
    const page = readFileSync(join(app, 'auth', 'reset-password', 'page.tsx'), 'utf8')
    expect(page).toContain("window.history.replaceState(null, '', window.location.pathname)")
    expect(page.match(/^export /gm)).toEqual(['export '])
    expect(existsSync(join(app, 'auth', 'forgot-password', 'page.tsx'))).toBe(true)
  })
})
