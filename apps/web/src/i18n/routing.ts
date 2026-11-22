import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['en', 'ar', 'fr', 'es', 'pt', 'de', 'zh', 'ja', 'hi', 'ru', 'ko', 'vi', 'id', 'uk', 'tr', 'it'],
  defaultLocale: 'en',
  // 'as-needed': English uses no prefix (/...), all others prefixed (/fr/..., /ar/..., etc.)
  // This matches the LanguageSwitcher.switchLocale URL-manipulation logic.
  localePrefix: 'as-needed',
})
