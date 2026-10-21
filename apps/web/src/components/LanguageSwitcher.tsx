'use client'

/**
 * The language menu (plan L5, Oct 21, 2026; off from Oct 20, when it sent
 * readers to /fr, /de, /ar…, which don't exist). A choice is saved as the
 * wp_lang cookie and the page is rendered again on the server, in place: the
 * menu and the left sidebar come back in that language, the reader stays on
 * the same page. The languages with every phrase translated (lib/locale.ts).
 */

import { useState, useRef, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n'
import { localeCookie, type MenuLocale } from '@/lib/locale'

export const LANGUAGES: ReadonlyArray<{ code: MenuLocale; label: string; flag: string }> = [
  { code: 'en', label: 'English',    flag: '🇺🇸' },
  { code: 'es', label: 'Español',    flag: '🇪🇸' },
  { code: 'fr', label: 'Français',   flag: '🇫🇷' },
  { code: 'pt', label: 'Português',  flag: '🇧🇷' },
]

type LocaleCode = MenuLocale

/** `up`: the list opens above the button (the phone menu's drawer, near the bottom of the screen) */
export function LanguageSwitcher({ up = false }: { up?: boolean } = {}) {
  const locale = useLocale() as LocaleCode
  const router = useRouter()
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

    // The server reads the cookie: render this page again in that language
    document.cookie = localeCookie(nextLocale, window.location.protocol === 'https:')
    startTransition(() => {
      router.refresh()
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
          className={`absolute right-0 ${up ? 'bottom-full mb-2' : 'top-full mt-2'} w-44 bg-wp-surface border border-[rgba(255,255,255,0.1)] rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] overflow-hidden z-[2000]`}
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
