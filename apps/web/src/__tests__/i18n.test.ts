/**
 * The translator (lib/i18n.ts): the reader's language comes from the root
 * layout through LocaleProvider (plan L5, Oct 21, 2026; it was read from the
 * address, /fr/…, and those pages don't exist). Rendered on the server, as
 * the page is. Until Oct 21 this file read window.location and never ran in
 * the tests' Node environment ("window is not defined").
 */
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useLocale, useTranslations, useIsRTL, SUPPORTED_LOCALES, RTL_LOCALES, type SupportedLocale } from '../lib/i18n'
import { LocaleProvider } from '../components/locale/LocaleProvider'

/** A hook's value when rendered on the server, inside the provider for `locale` (none for null) */
function inLocale<T>(locale: SupportedLocale | null, hook: () => T): T {
  let out: { value: T } | null = null
  function Probe() { out = { value: hook() }; return null }
  renderToStaticMarkup(locale === null ? createElement(Probe) : createElement(LocaleProvider, { locale, children: createElement(Probe) }))
  if (!out) throw new Error('not rendered')
  return (out as { value: T }).value
}

describe('useLocale()', () => {
  it("is the provider's language", () => {
    expect(inLocale('fr', useLocale)).toBe('fr')
    expect(inLocale('es', useLocale)).toBe('es')
    expect(inLocale('pt', useLocale)).toBe('pt')
  })

  it('is English outside a provider (tests, a page rendered on its own)', () => {
    expect(inLocale(null, useLocale)).toBe('en')
  })

  it('is English for a value that is not a language', () => {
    expect(inLocale('xx' as SupportedLocale, useLocale)).toBe('en')
  })
})

describe('useTranslations()', () => {
  it('English by default', () => {
    expect(inLocale(null, () => useTranslations('nav')('liveFeed'))).toBe('Live Feed')
  })

  it("the reader's language", () => {
    expect(inLocale('fr', () => useTranslations('nav')('liveFeed'))).toBe('Fil en direct')
    expect(inLocale('es', () => useTranslations('nav')('worldMap'))).toBe('Mapa mundial')
    expect(inLocale('pt', () => useTranslations('nav')('liveFeed'))).toBe('Feed ao vivo')
    expect(inLocale('fr', () => useTranslations('nav')('language'))).toBe('Langue')
  })

  it('English for a phrase a language lacks, the name only when English lacks it too', () => {
    // German has no "language" phrase (the menu doesn't offer German)
    expect(inLocale('de', () => useTranslations('nav')('language'))).toBe('Language')
    expect(inLocale('fr', () => useTranslations('nav')('definitelyMissingKey'))).toBe('definitelyMissingKey')
  })

  it('dot-separated namespaces', () => {
    expect(typeof inLocale(null, () => useTranslations('sources.suggest')('title'))).toBe('string')
  })
})

describe('useIsRTL()', () => {
  it('right to left for Arabic only', () => {
    expect(inLocale('ar', useIsRTL)).toBe(true)
    expect(inLocale('fr', useIsRTL)).toBe(false)
    expect(inLocale(null, useIsRTL)).toBe(false)
  })
})

describe('the languages', () => {
  it('all 10 in messages/', () => {
    expect([...SUPPORTED_LOCALES].sort()).toEqual(['ar', 'de', 'en', 'es', 'fr', 'hi', 'ja', 'pt', 'ru', 'zh'])
    expect(RTL_LOCALES).toEqual(['ar'])
  })
})
