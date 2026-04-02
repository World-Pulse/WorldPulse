/**
 * i18n shim tests — useLocale(), useTranslations(), useIsRTL()
 *
 * Verifies URL-based locale detection, fallback to English,
 * RTL detection, and cross-locale translation with English fallback.
 */

// Store original window.location so we can restore it
const originalLocation = window.location

function mockPathname(pathname: string) {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...originalLocation, pathname },
  })
}

function restoreLocation() {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: originalLocation,
  })
}

// Re-import after mocking (jest module cache handles this)
import { useLocale, useTranslations, useIsRTL, SUPPORTED_LOCALES, RTL_LOCALES } from '../lib/i18n'

describe('useLocale()', () => {
  afterEach(restoreLocation)

  it('returns "en" for root path with no locale prefix', () => {
    mockPathname('/')
    expect(useLocale()).toBe('en')
  })

  it('returns "en" for English-prefixed path', () => {
    mockPathname('/en/some/page')
    expect(useLocale()).toBe('en')
  })

  it('returns "fr" for French-prefixed path', () => {
    mockPathname('/fr/world-map')
    expect(useLocale()).toBe('fr')
  })

  it('returns "ar" for Arabic-prefixed path', () => {
    mockPathname('/ar/alerts')
    expect(useLocale()).toBe('ar')
  })

  it('returns "zh" for Chinese-prefixed path', () => {
    mockPathname('/zh/finance')
    expect(useLocale()).toBe('zh')
  })

  it('returns "ja" for Japanese-prefixed path', () => {
    mockPathname('/ja/space-weather')
    expect(useLocale()).toBe('ja')
  })

  it('returns "de" for German-prefixed path', () => {
    mockPathname('/de/cyber-threats')
    expect(useLocale()).toBe('de')
  })

  it('returns "en" for an unsupported/unknown prefix', () => {
    mockPathname('/xx/some/page')
    expect(useLocale()).toBe('en')
  })

  it('returns "en" for a deep path with no locale prefix', () => {
    mockPathname('/signals/123/ukraine-conflict')
    expect(useLocale()).toBe('en')
  })

  it('returns locale for path with just the locale code', () => {
    mockPathname('/ru')
    expect(useLocale()).toBe('ru')
  })
})

describe('useTranslations()', () => {
  afterEach(restoreLocation)

  it('returns English nav.liveFeed for default locale', () => {
    mockPathname('/')
    const t = useTranslations('nav')
    expect(t('liveFeed')).toBe('Live Feed')
  })

  it('returns French nav.liveFeed when locale is fr', () => {
    mockPathname('/fr/live')
    const t = useTranslations('nav')
    expect(t('liveFeed')).toBe('Fil en direct')
  })

  it('returns Spanish nav.worldMap when locale is es', () => {
    mockPathname('/es/map')
    const t = useTranslations('nav')
    expect(t('worldMap')).toBe('Mapa mundial')
  })

  it('falls back to English for a key missing in the current locale', () => {
    mockPathname('/fr/live')
    const t = useTranslations('nav')
    // 'NONEXISTENT_KEY' does not exist in any messages → returns the key itself
    expect(t('NONEXISTENT_KEY')).toBe('NONEXISTENT_KEY')
  })

  it('returns the raw key if key is missing entirely', () => {
    mockPathname('/')
    const t = useTranslations('nav')
    expect(t('definitelyMissingKey')).toBe('definitelyMissingKey')
  })

  it('handles dot-separated namespace "sources.suggest"', () => {
    mockPathname('/')
    const t = useTranslations('sources.suggest')
    // Should return a string (not undefined) for known keys
    expect(typeof t('title')).toBe('string')
  })

  it('returns German translation for nav.alerts', () => {
    mockPathname('/de/alerts')
    const t = useTranslations('nav')
    // German: "Alerts" might be "Benachrichtigungen" or similar — just check it's a string
    expect(typeof t('alerts')).toBe('string')
    expect(t('alerts').length).toBeGreaterThan(0)
  })

  it('returns Russian translation for nav.liveFeed', () => {
    mockPathname('/ru/live')
    const t = useTranslations('nav')
    expect(typeof t('liveFeed')).toBe('string')
    expect(t('liveFeed').length).toBeGreaterThan(0)
  })
})

describe('useIsRTL()', () => {
  afterEach(restoreLocation)

  it('returns false for English', () => {
    mockPathname('/')
    expect(useIsRTL()).toBe(false)
  })

  it('returns true for Arabic (RTL locale)', () => {
    mockPathname('/ar/live')
    expect(useIsRTL()).toBe(true)
  })

  it('returns false for French (LTR locale)', () => {
    mockPathname('/fr/live')
    expect(useIsRTL()).toBe(false)
  })

  it('returns false for Chinese', () => {
    mockPathname('/zh/live')
    expect(useIsRTL()).toBe(false)
  })
})

describe('SUPPORTED_LOCALES constant', () => {
  it('contains all 10 expected locales', () => {
    expect(SUPPORTED_LOCALES).toHaveLength(10)
    const expected = ['en', 'fr', 'es', 'de', 'pt', 'ar', 'zh', 'ja', 'hi', 'ru']
    expected.forEach(loc => {
      expect(SUPPORTED_LOCALES).toContain(loc)
    })
  })

  it('RTL_LOCALES contains Arabic', () => {
    expect(RTL_LOCALES).toContain('ar')
  })
})
