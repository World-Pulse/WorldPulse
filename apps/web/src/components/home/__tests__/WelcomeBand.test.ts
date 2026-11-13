/**
 * The home page's welcome band (Nov 12, 2026): who sees it.
 */
import { describe, it, expect } from 'vitest'
import { shouldWelcome, WELCOME_KEY, WELCOME_SCRIPT } from '@/lib/welcome'

const store = (o: Record<string, string>) => (k: string) => (k in o ? o[k] : null)

describe('shouldWelcome', () => {
  it('greets a browser that has stored nothing', () => {
    expect(shouldWelcome(store({}))).toBe(true)
    expect(shouldWelcome(store({ wp_theme: 'dark' }))).toBe(true)
  })
  it('does not greet a reader who has seen it, closed the old pop-up, or is signed in', () => {
    expect(shouldWelcome(store({ [WELCOME_KEY]: '2026-11-13T12:00:00Z' }))).toBe(false)
    expect(shouldWelcome(store({ wp_onboarded_v2: '1' }))).toBe(false)
    expect(shouldWelcome(store({ wp_access_token: 'x' }))).toBe(false)
  })
  it('does not greet when the browser will not let it remember', () => {
    expect(shouldWelcome(() => { throw new Error('denied') })).toBe(false)
  })
  it('ships a script that marks the page for the same three cases, and when storage is refused', () => {
    const run = (get: (k: string) => string | null) => {
      const attrs: Record<string, string> = {}
      const doc = { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v } } }
      new Function('document', 'localStorage', WELCOME_SCRIPT)(doc, { getItem: get })
      return attrs
    }
    expect(run(store({}))).toEqual({})
    expect(run(store({ [WELCOME_KEY]: 'x' }))).toEqual({ 'data-welcomed': '1' })
    expect(run(store({ wp_onboarded_v2: '1' }))).toEqual({ 'data-welcomed': '1' })
    expect(run(store({ wp_access_token: 't' }))).toEqual({ 'data-welcomed': '1' })
    expect(run(() => { throw new Error('denied') })).toEqual({ 'data-welcomed': '1' })
  })
})
