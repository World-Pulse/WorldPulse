'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { CommandPalette } from '@/components/search/CommandPalette'
import { ToastProvider } from '@/components/Toast'

// ─── Theme ───────────────────────────────────────────────────────────────────

type Theme = 'dark' | 'light'

interface ThemeContextValue {
  theme:  Theme
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'dark', toggle: () => {} })

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark')

  // Apply persisted theme on first mount (SSR-safe)
  useEffect(() => {
    const saved = localStorage.getItem('wp_theme') as Theme | null
    if (saved === 'light') {
      setTheme('light')
      document.documentElement.classList.add('light')
    }
  }, [])

  const toggle = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem('wp_theme', next)
      document.documentElement.classList.toggle('light', next === 'light')
      return next
    })
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

// ─── Root Providers ──────────────────────────────────────────────────────────

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime:            30_000,
        gcTime:               5 * 60_000,
        refetchOnWindowFocus: false,
        retry:                1,
      },
    },
  }))

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          {children}
          <CommandPalette />
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
