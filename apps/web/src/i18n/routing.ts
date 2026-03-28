import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['en', 'ar', 'fr', 'es', 'pt', 'de', 'zh', 'ja', 'hi', 'ru'],
  defaultLocale: 'en',
  localePrefix: 'never',
})
