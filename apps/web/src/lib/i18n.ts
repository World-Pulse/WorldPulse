/**
 * Lightweight i18n shim — replaces next-intl's useTranslations/useLocale hooks.
 *
 * next-intl's Turbopack plugin doesn't inject the request config at build time,
 * causing "Couldn't find next-intl config file" on every SSR render. Since the
 * app is English-only, we bypass the plugin entirely and read from en.json directly.
 *
 * Drop-in replacement: swap `import { useTranslations } from 'next-intl'`
 * with                 `import { useTranslations } from '@/lib/i18n'`
 */
import messages from '../../messages/en.json'

type Messages = typeof messages

/** Resolve a dot-separated namespace path, e.g. "sources.suggest" */
function getNamespace(ns: string): Record<string, string> {
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
 * Supports dot-separated namespaces: useTranslations('sources.suggest')
 */
export function useTranslations(namespace: string) {
  const ns = getNamespace(namespace)
  return (key: string): string => ns[key] ?? key
}

/** Always returns 'en' — no dynamic locale switching. */
export function useLocale(): string {
  return 'en'
}

// Re-export namespace type for callers that need it
export type { Messages }
