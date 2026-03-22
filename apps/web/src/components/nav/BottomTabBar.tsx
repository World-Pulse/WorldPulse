'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/',         icon: '⚡', label: 'Feed'    },
  { href: '/map',      icon: '🌍', label: 'Map'     },
  { href: '/search',   icon: '🔍', label: 'Search'  },
  { href: '/alerts',   icon: '🔔', label: 'Alerts'  },
  { href: '/settings', icon: '⚙️', label: 'More'    },
] as const

export function BottomTabBar() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Mobile tab navigation"
      className="fixed bottom-0 left-0 right-0 glass border-t border-[rgba(255,255,255,0.07)] flex md:hidden z-[900]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map(tab => {
        const active = tab.href === '/'
          ? pathname === '/'
          : pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center justify-center gap-[2px] py-2 min-h-[52px] text-[9px] font-mono tracking-[0.5px] uppercase transition-colors
              ${active ? 'text-wp-amber' : 'text-wp-text3 hover:text-wp-text2'}`}
          >
            <span className="text-[20px] leading-none" aria-hidden="true">{tab.icon}</span>
            <span>{tab.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
