'use client'

import { useEffect } from 'react'
import { useLocale, useIsRTL } from '@/lib/i18n'

export function LocaleAttributes() {
  const locale = useLocale()
  const isRTL = useIsRTL()

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr'
  }, [locale, isRTL])

  return null
}

export default LocaleAttributes
