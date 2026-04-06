/**
 * Lightweight i18n shim — replaces next-intl's useTranslations/useLocale hooks.
 *
 * next-intl's Turbopack plugin doesn't inject the request config at build time,
 * causing "Couldn't find next-intl config file" on every SSR render. Since the
 * app bypasses the plugin, we read locale from the URL pathname directly.
 *
 * Locale strategy (as-needed):
 *   /en/...  → English (or no prefix → English default)
 *   /fr/...  → Français
 *   /ar/...  → العربية  (RTL)
 *   etc.
 *
 * Drop-in replacement: swap `import { useTranslations } from 'next-intl'`
 * with                 `import { useTranslations } from '@/lib/i18n'`
 */

import messagesEn from '../../messages/en.json'
import messagesFr from '../../messages/fr.json'
import messagesEs from '../../messages/es.json'
import messagesDe from '../../messages/de.json'
import messagesPt from '../../messages/pt.json'
import messagesAr from '../../messages/ar.json'
import messagesZh from '../../messages/zh.json'
import messagesJa from '../../messages/ja.json'
import messagesHi from '../../messages/hi.json'
import messagesRu from '../../messages/ru.json'

type Messages = typeof messagesEn

/** All supported locale codes — must match routing.ts and message files */
export const SUPPORTED_LOCALES = ['en', 'fr', 'es', 'de', 'pt', 'ar', 'zh', 'ja', 'hi', 'ru'] as const
export type SupportedLocale = typeof SUPPORTED_LOCALES[number]

/** RTL locales — used to set document direction */
export const RTL_LOCALES: SupportedLocale[] = ['ar']

/** Static map of all locale messages (bundled at build time, no async needed) */
const ALL_MESSAGES: Record<SupportedLocale, Messages> = {
  en: messagesEn,
  fr: messagesFr,
  es: messagesEs,
  de: messagesDe,
  pt: messagesPt,
  ar: messagesAr as unknown as Messages,
  zh: messagesZh as unknown as Messages,
  ja: messagesJa as unknown as Messages,
  hi: messagesHi as unknown as Messages,
  ru: messagesRu as unknown as Messages,
}

/**
 * Read the active locale from the URL pathname.
 *
 * Strategy (mirrors LanguageSwitcher.switchLocale):
 *   - SSR / no window → 'en' (safe default)
 *   - pathname starts with /xx/ or equals /xx where xx is a supported locale → return xx
 *   - otherwise → 'en' (English default, no URL prefix)
 */
export function useLocale(): SupportedLocale {
  if (typeof window === 'undefined') return 'en'

  const segments = window.location.pathname.split('/').filter(Boolean)
  const candidate = segments[0] as SupportedLocale

  if (candidate && (SUPPORTED_LOCALES as readonly string[]).includes(candidate)) {
    return candidate
  }

  return 'en'
}

/** Resolve a dot-separated namespace path, e.g. "sources.suggest" */
function getNamespace(ns: string, messages: Messages): Record<string, string> {
  const parts = ns.split('.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = messages
  for (const part of parts) {
    current = current?.[part]
  }
  return (current as Record<string, string>) ?? {}
}

/**
 * Returns a translator function for the given namespace.
 * Picks messages for the locale detected from the current URL.
 * Falls back to English if the key is missing in the current locale.
 *
 * Supports dot-separated namespaces: useTranslations('sources.suggest')
 */
export function useTranslations(namespace: string) {
  const locale = useLocale()
  const msgs = ALL_MESSAGES[locale] ?? messagesEn
  const ns = getNamespace(namespace, msgs)
  const nsEn = getNamespace(namespace, messagesEn)
  return (key: string): string => ns[key] ?? nsEn[key] ?? key
}

/**
 * Returns true if the current locale is RTL.
 * Safe to call during SSR (returns false).
 */
export function useIsRTL(): boolean {
  return (RTL_LOCALES as SupportedLocale[]).includes(useLocale())
}

// Re-export namespace type for callers that need it
export type { Messages }
