'use client'

/**
 * Lightweight i18n shim — replaces next-intl's useTranslations/useLocale hooks.
 *
 * next-intl's Turbopack plugin doesn't inject the request config at build time,
 * causing "Couldn't find next-intl config file" on every SSR render, so the app
 * bypasses it.
 *
 * The language (plan L5, Oct 21, 2026): the reader's choice in the language
 * menu, a cookie the root layout reads on the server and hands down through
 * LocaleProvider (lib/locale.ts says why). The server renders the chosen
 * language and the browser renders the same, so nothing flickers. It was read
 * from the address (/fr/…), and those pages don't exist.
 *
 * Drop-in replacement: swap `import { useTranslations } from 'next-intl'`
 * with                 `import { useTranslations } from '@/lib/i18n'`
 */

import { createContext, useContext } from 'react'
import { SUPPORTED_LOCALES, RTL_LOCALES, type SupportedLocale } from './locale'

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

// All supported locale codes and the right-to-left ones: lib/locale.ts (server-safe)
export { SUPPORTED_LOCALES, RTL_LOCALES }
export type { SupportedLocale }

/** Static map of all locale messages (bundled at build time, no async needed) */
const ALL_MESSAGES: Record<SupportedLocale, Messages> = {
  en: messagesEn,
  // The other languages lack some English keys; the translator falls back to English for those
  fr: messagesFr as unknown as Messages,
  es: messagesEs as unknown as Messages,
  de: messagesDe as unknown as Messages,
  pt: messagesPt as unknown as Messages,
  ar: messagesAr as unknown as Messages,
  zh: messagesZh as unknown as Messages,
  ja: messagesJa as unknown as Messages,
  hi: messagesHi as unknown as Messages,
  ru: messagesRu as unknown as Messages,
}

/** The reader's language, set by the root layout (components/locale/LocaleProvider.tsx) */
export const LocaleContext = createContext<SupportedLocale | null>(null)

/** The active language: the provider's, or English outside one (tests, embeds) */
export function useLocale(): SupportedLocale {
  const locale = useContext(LocaleContext)
  return locale && (SUPPORTED_LOCALES as readonly string[]).includes(locale) ? locale : 'en'
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
 * Picks messages for the reader's language (useLocale).
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

/** Returns true if the current locale is RTL */
export function useIsRTL(): boolean {
  return (RTL_LOCALES as SupportedLocale[]).includes(useLocale())
}

// Re-export namespace type for callers that need it
export type { Messages }
