/**
 * Which language the site's menus are in (plan L5, Oct 21, 2026).
 *
 * A reader picks it in the language menu; the choice is a cookie, wp_lang,
 * that the root layout reads on the server, so the page comes in the chosen
 * language from its first byte: nothing flickers from English to French
 * after it loads. The menu sent readers to /fr, /de, /ar… until Oct 20, and
 * those pages don't exist.
 *
 * The menu offers the languages with every phrase translated: Spanish,
 * French and Portuguese (a test keeps them complete). The others in
 * messages/ are missing phrases, so a cookie naming one shows English.
 *
 * Only the top menu and the left sidebar are translated; the stories are in
 * English. So the page's own language stays English (<html lang="en">) and
 * the translated parts carry the reader's language (lang="fr" on the menu),
 * so a screen reader reads each part in its own language.
 *
 * Server-safe: no React here (the root layout, a server component, uses it).
 */

/** All the languages in messages/ */
export const SUPPORTED_LOCALES = ['en', 'fr', 'es', 'de', 'pt', 'ar', 'zh', 'ja', 'hi', 'ru'] as const
export type SupportedLocale = typeof SUPPORTED_LOCALES[number]

/** Right-to-left languages */
export const RTL_LOCALES: SupportedLocale[] = ['ar']

/** The languages the menu offers: every phrase translated */
export const MENU_LOCALES = ['en', 'es', 'fr', 'pt'] as const
export type MenuLocale = typeof MENU_LOCALES[number]

export const LOCALE_COOKIE = 'wp_lang'
/** A year: the choice stays until the reader picks another */
export const LOCALE_COOKIE_MAX_AGE = 365 * 24 * 3600

/** The menu language a cookie names, or English */
export function localeFromCookie(value: string | null | undefined): MenuLocale {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return (MENU_LOCALES as readonly string[]).includes(v) ? (v as MenuLocale) : 'en'
}

/** The cookie the language menu sets (document.cookie); Secure on https */
export function localeCookie(locale: MenuLocale, secure: boolean): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure ? '; Secure' : ''}`
}

/** Text direction for a language */
export function localeDir(locale: string): 'rtl' | 'ltr' {
  return (RTL_LOCALES as readonly string[]).includes(locale) ? 'rtl' : 'ltr'
}
