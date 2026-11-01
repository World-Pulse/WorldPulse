/**
 * Push alerts in the browser (lib/push-client.ts, Oct 31, 2026): which
 * browsers can take them, what a press asks the server for, and the files
 * the browser needs (the service worker's handlers, the manifest's icons,
 * which were missing).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { pushSupport, keyBytes, sameKey, nextWant, pushErrorText, PushError, PUSH_OFF } from '@/lib/push-client'

const pushWin = { PushManager: class {}, Notification: class {}, matchMedia: () => ({ matches: false }) }
const standaloneWin = { ...pushWin, matchMedia: (q: string) => ({ matches: q.includes('standalone') }) }
const nav = (ua: string, extra: Record<string, unknown> = {}) => ({ userAgent: ua, serviceWorker: {}, ...extra })

describe('which browsers can take alerts', () => {
  it('Chrome, Edge, Firefox and Safari on a computer, and Android', () => {
    expect(pushSupport(nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0 Safari/537.36 Edg/141.0'), pushWin)).toBe('ok')
    expect(pushSupport(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/26.0 Safari/605.1.15', { platform: 'MacIntel', maxTouchPoints: 0 }), pushWin)).toBe('ok')
    expect(pushSupport(nav('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/141.0 Mobile Safari/537.36'), pushWin)).toBe('ok')
  })

  it('an iPhone or iPad only from the Home Screen', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1'
    expect(pushSupport(nav(iphone), pushWin)).toBe('ios-home-screen')
    expect(pushSupport(nav(iphone, { standalone: true }), pushWin)).toBe('ok')
    expect(pushSupport(nav(iphone), standaloneWin)).toBe('ok')
    // iPadOS asks for the desktop site as a Mac with a touch screen
    expect(pushSupport(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/26.0 Safari/605.1.15', { platform: 'MacIntel', maxTouchPoints: 5 }), pushWin)).toBe('ios-home-screen')
  })

  it("not a browser without push, or before it's known", () => {
    expect(pushSupport(nav('Mozilla/5.0 Old'), { matchMedia: () => ({ matches: false }) })).toBe('unsupported')
    expect(pushSupport(undefined, undefined)).toBe('unsupported')
  })
})

describe('what a press asks for', () => {
  const on = (breaking: boolean, countries: string[]) => ({ subscribed: true, breaking, countries })

  it('the breaking-news switch keeps the countries a browser follows', () => {
    expect(nextWant(PUSH_OFF, { breaking: true })).toEqual({ breaking: true, countries: [] })
    expect(nextWant(on(true, ['IR']), { breaking: true })).toEqual({ breaking: false, countries: ['IR'] })
    expect(nextWant(on(false, ['IR']), { breaking: true })).toEqual({ breaking: true, countries: ['IR'] })
  })

  it("a country's button adds or takes away that country, and leaves breaking news as it was", () => {
    expect(nextWant(PUSH_OFF, { country: 'IR' })).toEqual({ breaking: false, countries: ['IR'] })
    expect(nextWant(on(true, []), { country: 'IR' })).toEqual({ breaking: true, countries: ['IR'] })
    expect(nextWant(on(true, ['IR', 'QA']), { country: 'IR' })).toEqual({ breaking: true, countries: ['QA'] })
    expect(nextWant(on(false, ['IR']), { country: 'IR' })).toEqual({ breaking: false, countries: [] })
  })

  it('reads the server key and says what went wrong in plain words', () => {
    expect(Array.from(keyBytes('AQID_w'))).toEqual([1, 2, 3, 255])
    expect(sameKey(new Uint8Array([1, 2, 3, 255]).buffer, keyBytes('AQID_w'))).toBe(true)
    expect(sameKey(null, keyBytes('AQID_w'))).toBe(false)
    expect(pushErrorText(new PushError('denied'))).toContain('blocked')
    expect(pushErrorText(new Error('x'))).toContain('try again')
  })
})

describe('the files the browser needs', () => {
  const pub = path.resolve(__dirname, '../../public')

  it('the service worker shows each push and opens its story', () => {
    const sw = readFileSync(path.join(pub, 'sw.js'), 'utf8')
    expect(sw).toContain("addEventListener('push'")
    expect(sw).toContain('showNotification')
    expect(sw).toContain("addEventListener('notificationclick'")
  })

  it("the manifest's icons and the notification badge exist", () => {
    const manifest = JSON.parse(readFileSync(path.join(pub, 'manifest.json'), 'utf8')) as { display: string; icons: Array<{ src: string }> }
    expect(manifest.display).toBe('standalone')
    for (const icon of manifest.icons) expect(existsSync(path.join(pub, icon.src)), icon.src).toBe(true)
    expect(existsSync(path.join(pub, 'icons/badge-72.png'))).toBe(true)
    expect(existsSync(path.resolve(__dirname, '../app/apple-icon.png'))).toBe(true)
  })
})
