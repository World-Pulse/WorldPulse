import { describe, it, expect } from 'vitest'
import { safeNext, authHref, afterSignIn } from '../auth-next'

describe('safeNext', () => {
  it('keeps paths on this site, with their query', () => {
    expect(safeNext('/pricing')).toBe('/pricing')
    expect(safeNext('/signals/abc-123?utm_source=x')).toBe('/signals/abc-123?utm_source=x')
    expect(safeNext(' /map ')).toBe('/map')
  })

  it('refuses other sites and odd addresses', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', '/\t/evil.example',
      '/x\ny', 'javascript:alert(1)', 'pricing', '', '/' + 'a'.repeat(600)]) {
      expect(safeNext(bad)).toBeNull()
    }
    expect(safeNext(null)).toBeNull()
    expect(safeNext(undefined)).toBeNull()
  })

  it('refuses the sign-in and onboarding pages, so nothing loops', () => {
    expect(safeNext('/auth/login')).toBeNull()
    expect(safeNext('/auth/register?next=/x')).toBeNull()
    expect(safeNext('/onboarding')).toBeNull()
    expect(safeNext('/authors')).toBe('/authors')
  })
})

describe('authHref', () => {
  it('carries the page to come back to', () => {
    expect(authHref('login', '/signals/abc')).toBe('/auth/login?next=%2Fsignals%2Fabc')
    expect(authHref('register', '/pricing')).toBe('/auth/register?next=%2Fpricing')
  })

  it('is the plain page for home, unsafe or missing paths', () => {
    expect(authHref('login', '/')).toBe('/auth/login')
    expect(authHref('login', '//evil.example')).toBe('/auth/login')
    expect(authHref('register')).toBe('/auth/register')
  })
})

describe('afterSignIn', () => {
  it('returns to the page, or home', () => {
    expect(afterSignIn(true, '/pricing')).toBe('/pricing')
    expect(afterSignIn(true, null)).toBe('/')
    expect(afterSignIn(true, '//evil.example')).toBe('/')
  })

  it('sends new accounts through onboarding first, keeping the page', () => {
    expect(afterSignIn(false, '/signals/abc')).toBe('/onboarding?next=%2Fsignals%2Fabc')
    expect(afterSignIn(false, null)).toBe('/onboarding')
  })
})
