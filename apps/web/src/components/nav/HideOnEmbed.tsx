'use client'

import { usePathname } from 'next/navigation'

/**
 * Leaves the site's header, tab bar and command palette out of the embed
 * widget (/embed), which other sites show in a small frame (plan G5, Oct 11,
 * 2026). The widget used to carry the whole site header and tab bar, and
 * each view also asked the API for the header's counts.
 */
export function HideOnEmbed({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  if (pathname === '/embed' || pathname?.startsWith('/embed/')) return null
  return <>{children}</>
}
