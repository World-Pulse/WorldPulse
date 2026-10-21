'use client'

/**
 * Hands the reader's language down to the translated parts of the page (plan
 * L5): the root layout reads the language cookie on the server and wraps the
 * page in this, so the server and the browser render the same language.
 */

import type { ReactNode } from 'react'
import { LocaleContext } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/locale'

export function LocaleProvider({ locale, children }: { locale: SupportedLocale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
}
