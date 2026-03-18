'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useLocale } from 'next-intl'

const LANGUAGES = [
  { code: 'en', label: 'English',    flag: '🇺🇸', dir: 'ltr' },
  { code: 'ar', label: 'العربية',    flag: '🇸🇦', dir: 'rtl' },
  { code: 'fr', label: 'Français',   flag: '🇫🇷', dir: 'ltr' },
  { code: 'es', label: 'Español',    flag: '🇪🇸', dir: 'ltr' },
  { code: 'pt', label: 'Português',  flag: '🇧🇷', dir: 'ltr' },
  { code: 'de', label: 'Deutsch',    flag: '🇩🇪', dir: 'ltr' },
  { code: 'zh', label: '中文',       flag: '🇨🇳', dir: 'ltr' },
] as const

type LocaleCode = typeof LANGUAGES[number]['code']

export function LanguageSwitcher() {
  const locale = useLocale() as LocaleCode
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const current = LANGUAGES.find(l => l.code === locale) ?? LANGUAGES[0]

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function switchLocale(nextLocale: LocaleCode) {
    setOpen(false)
    if (nextLocale === locale) return

    startTransition(() => {
      // Strip existing locale prefix and navigate to new locale
      const segments = pathname.split('/')
      const currentLocaleIndex = LANGUAGES.map(l => l.code).includes(segments[1] as LocaleCode)
        ? 1
        : -1

      let newPath: string
      if (nextLocale === 'en') {
        // en uses no prefix (as-needed strategy)
        newPath = currentLocaleIndex === 1
          ? '/' + segments.slice(2).join('/')
          : pathname
      } else {
        newPath = currentLocaleIndex === 1
          ? '/' + nextLocale + '/' + segments.slice(2).join('/')
          : '/' + nextLocale + pathname
      }

      // Clean up trailing slash
      newPath = newPath.replace(/\/$/, '') || '/'
      router.push(newPath)
    })
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={isPending}
        className="flex items-center gap-[6px] px-3 py-[6px] rounded-lg border border-[rgba(255,255,255,0.07)] bg-wp-s2 text-wp-text2 hover:border-[rgba(255,255,255,0.15)] hover:text-wp-text transition-all text-[13px] font-medium disabled:opacity-50"
        aria-label="Switch language"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span>{current.flag}</span>
        <span className="font-mono text-[11px]">{current.code.toUpperCase()}</span>
        <span className={`text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-44 bg-wp-surface border border-[rgba(255,255,255,0.1)] rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] overflow-hidden z-[2000]"
          role="listbox"
          aria-label="Select language"
        >
          {LANGUAGES.map(lang => (
            <button
              key={lang.code}
              role="option"
              aria-selected={lang.code === locale}
              onClick={() => switchLocale(lang.code)}
              className={`w-full flex items-center gap-3 px-4 py-[10px] text-[13px] transition-all text-left
                ${lang.code === locale
                  ? 'bg-[rgba(245,166,35,0.1)] text-wp-amber'
                  : 'text-wp-text2 hover:bg-wp-s2 hover:text-wp-text'
                }`}
            >
              <span className="text-[16px]">{lang.flag}</span>
              <span>{lang.label}</span>
              {lang.code === locale && (
                <span className="ml-auto text-wp-amber text-[12px]">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
