/**
 * The language menu, back (plan L5, Oct 21, 2026): a reader's choice is the
 * wp_lang cookie, read by the root layout on the server, for the languages
 * with every phrase translated. Off from Oct 20 because it sent readers to
 * /fr, /de, /ar…, which don't exist.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/' }))

import { MENU_LOCALES, SUPPORTED_LOCALES, LOCALE_COOKIE, localeFromCookie, localeCookie, localeDir } from '@/lib/locale'
import { LanguageSwitcher, LANGUAGES } from '@/components/LanguageSwitcher'
import { LocaleProvider } from '@/components/locale/LocaleProvider'

const messages = (lang: string) => JSON.parse(readFileSync(join(__dirname, '..', '..', 'messages', `${lang}.json`), 'utf8'))
const keys = (o: Record<string, unknown>, at = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v as Record<string, unknown>, `${at}${k}.`) : [`${at}${k}`]))

describe('the cookie', () => {
  it('names one of the menu languages, else English', () => {
    expect(localeFromCookie('fr')).toBe('fr')
    expect(localeFromCookie(' ES ')).toBe('es')
    expect(localeFromCookie('pt')).toBe('pt')
    expect(localeFromCookie('de')).toBe('en') // in messages/, but missing phrases: not offered
    expect(localeFromCookie('ar')).toBe('en')
    expect(localeFromCookie('xx')).toBe('en')
    expect(localeFromCookie('')).toBe('en')
    expect(localeFromCookie(undefined)).toBe('en')
    expect(localeFromCookie(null)).toBe('en')
  })

  it('lasts a year, for the whole site, Secure on https', () => {
    expect(LOCALE_COOKIE).toBe('wp_lang')
    expect(localeCookie('es', true)).toBe('wp_lang=es; Path=/; Max-Age=31536000; SameSite=Lax; Secure')
    expect(localeCookie('fr', false)).toBe('wp_lang=fr; Path=/; Max-Age=31536000; SameSite=Lax')
  })

  it('direction', () => {
    expect(localeDir('ar')).toBe('rtl')
    expect(localeDir('fr')).toBe('ltr')
  })
})

describe('the menu', () => {
  it('offers English, Spanish, French and Portuguese', () => {
    expect(LANGUAGES.map(l => l.code)).toEqual([...MENU_LOCALES])
    for (const l of MENU_LOCALES) expect(SUPPORTED_LOCALES).toContain(l)
  })

  it('each language it offers has every English phrase', () => {
    const en = keys(messages('en'))
    for (const lang of MENU_LOCALES) {
      const have = new Set(keys(messages(lang)))
      expect(en.filter(k => !have.has(k)), lang).toEqual([])
    }
  })

  it("shows the reader's language, rendered on the server", () => {
    expect(renderToStaticMarkup(<LocaleProvider locale="fr"><LanguageSwitcher /></LocaleProvider>)).toContain('>FR<')
    expect(renderToStaticMarkup(<LanguageSwitcher />)).toContain('>EN<')
  })
})

describe('the root layout', () => {
  const layout = readFileSync(join(__dirname, '..', 'app', 'layout.tsx'), 'utf8')

  it('reads the cookie on the server and hands the language down', () => {
    expect(layout).toMatch(/localeFromCookie\(\(await cookies\(\)\)\.get\(LOCALE_COOKIE\)\?\.value\)/)
    expect(layout).toMatch(/<LocaleProvider locale=\{locale\}>/)
  })

  it('keeps the page English: the stories are (the translated menus carry their own lang)', () => {
    expect(layout).toMatch(/<html lang="en" dir="ltr"/)
    const nav = readFileSync(join(__dirname, '..', 'components', 'nav', 'TopNav.tsx'), 'utf8')
    const side = readFileSync(join(__dirname, '..', 'components', 'sidebar', 'LeftSidebar.tsx'), 'utf8')
    expect(nav).toMatch(/lang=\{locale\}/)
    expect(side).toMatch(/lang=\{locale\}/)
  })
})
