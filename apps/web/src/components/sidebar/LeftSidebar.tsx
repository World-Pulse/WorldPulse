'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'

const NAV_ITEMS = [
  { href: '/',           icon: '⚡', labelKey: 'liveFeed' },
  { href: '/map',        icon: '🌍', labelKey: 'worldMap',    badge: 'LIVE', badgeColor: 'amber' },
  { href: '/alerts',     icon: '🔔', labelKey: 'alerts',      badge: '12',   badgeColor: 'red'   },
  { href: '/analytics',  icon: '📊', labelKey: 'analytics'  },
  { href: '/explore',    icon: '🔭', labelKey: 'explore'    },
  { href: '/communities',icon: '🤝', labelKey: 'communities' },
  { href: '/sources',    icon: '📡', labelKey: 'mySources'  },
  { href: '/settings',   icon: '⚙️', labelKey: 'settings'   },
] as const

const CHANNELS = [
  { href: '/c/breaking',   icon: '🔴', labelKey: 'breakingNews',  color: 'text-wp-red' },
  { href: '/c/conflict',   icon: '⚔️', labelKey: 'conflictZones', color: 'text-red-500' },
  { href: '/c/markets',    icon: '📈', labelKey: 'markets',        color: 'text-wp-amber' },
  { href: '/c/climate',    icon: '🌱', labelKey: 'climate',        color: 'text-green-400' },
  { href: '/c/health',     icon: '💊', labelKey: 'health',         color: 'text-purple-400' },
  { href: '/c/technology', icon: '🔬', labelKey: 'scienceTech',    color: 'text-wp-cyan' },
  { href: '/c/politics',   icon: '🗳️', labelKey: 'politics',       color: 'text-blue-400' },
  { href: '/c/culture',    icon: '🌐', labelKey: 'culture',        color: 'text-pink-400' },
] as const

const TRENDING = [
  { tag: '#ManilaQuake',    count: '84.2K', momentum: 'surging', sparkHeights: [4, 7, 10, 14, 18] },
  { tag: '#EUAIDirective',  count: '61.7K', momentum: 'rising',  sparkHeights: [8, 10, 12, 15, 16] },
  { tag: '#ArcticMelt',     count: '48.1K', momentum: 'steady',  sparkHeights: [12, 14, 11, 13, 14] },
  { tag: '#SudanCeasefire', count: '31.4K', momentum: 'cooling', sparkHeights: [18, 16, 13, 9, 7] },
  { tag: '#SKoreaElection', count: '29.8K', momentum: 'rising',  sparkHeights: [5, 8, 11, 14, 17] },
]

const MOMENTUM_LABEL: Record<string, string> = {
  surging: '🔥 Surging',
  rising:  '↑ Rising',
  steady:  '→ Steady',
  cooling: '↓ Cooling',
}

export function LeftSidebar() {
  const pathname = usePathname()
  const tNav = useTranslations('nav')
  const tChannels = useTranslations('channels')
  const tCommon = useTranslations('common')

  return (
    <aside
      aria-label="Main navigation"
      className="sticky top-[52px] h-[calc(100vh-52px)] overflow-y-auto border-r border-[rgba(255,255,255,0.07)] bg-wp-surface flex flex-col scrollbar-thin scrollbar-thumb-[rgba(255,255,255,0.07)] scrollbar-track-transparent rtl:border-r-0 rtl:border-l rtl:border-l-[rgba(255,255,255,0.07)]"
    >

      {/* Threat Index */}
      <div
        className="mx-4 mt-4 mb-2 bg-wp-s2 border border-[rgba(255,255,255,0.07)] rounded-[10px] p-3"
        role="status"
        aria-label="Global Threat Index: Level 2 Elevated"
      >
        <div className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase mb-2" aria-hidden="true">
          {tCommon('globalThreatIndex')}
        </div>
        <div className="flex gap-1 mb-2">
          {[1, 2, 3, 4, 5].map(level => (
            <div
              key={level}
              className={`flex-1 h-[6px] rounded-sm transition-all ${
                level <= 2
                  ? level === 1
                    ? 'bg-green-500 shadow-[0_0_8px_#22c55e]'
                    : 'bg-yellow-400 shadow-[0_0_8px_#eab308]'
                  : 'bg-wp-s3'
              }`}
            />
          ))}
        </div>
        <div className="font-mono text-[11px] text-yellow-400">{tCommon('level').toUpperCase()} 2 · {tCommon('elevated').toUpperCase()}</div>
      </div>

      {/* Navigation */}
      <nav aria-label="Primary navigation" className="px-4 mb-6">
        <div className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase mb-2 px-1" aria-hidden="true">
          {tNav('navigate')}
        </div>
        {NAV_ITEMS.map(item => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-[10px] px-3 py-[9px] rounded-lg mb-0.5 text-[14px] transition-all relative no-underline
                ${isActive
                  ? 'bg-[rgba(245,166,35,0.12)] text-wp-amber'
                  : 'text-wp-text2 hover:bg-wp-s2 hover:text-wp-text'
                }`}
            >
              {isActive && (
                <span className="absolute left-0 rtl:left-auto rtl:right-0 top-1/2 -translate-y-1/2 w-[3px] h-[60%] bg-wp-amber rounded-r rtl:rounded-r-none rtl:rounded-l" aria-hidden="true" />
              )}
              <span className="text-[16px] w-5 text-center" aria-hidden="true">{item.icon}</span>
              <span>{tNav(item.labelKey)}</span>
              {'badge' in item && item.badge && (
                <span
                  className={`ml-auto rtl:ml-0 rtl:mr-auto font-mono text-[9px] px-[6px] py-0.5 rounded-full font-bold
                    ${item.badgeColor === 'red'
                      ? 'bg-wp-red text-white'
                      : 'bg-wp-amber text-black'
                    }`}
                  aria-label={
                    item.badge === 'LIVE'
                      ? 'Live'
                      : `${item.badge} unread notifications`
                  }
                >
                  {item.badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Signal Channels */}
      <nav aria-label="Signal channels" className="px-4 mb-6">
        <div className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase mb-2 px-1" aria-hidden="true">
          {tNav('signalChannels')}
        </div>
        {CHANNELS.map(ch => (
          <Link
            key={ch.href}
            href={ch.href}
            aria-current={pathname === ch.href ? 'page' : undefined}
            className="flex items-center gap-[10px] px-3 py-[9px] rounded-lg mb-0.5 text-[14px] text-wp-text2 hover:bg-wp-s2 hover:text-wp-text transition-all no-underline"
          >
            <span className={`text-[16px] w-5 text-center ${ch.color}`} aria-hidden="true">{ch.icon}</span>
            <span>{tChannels(ch.labelKey)}</span>
          </Link>
        ))}
      </nav>

      {/* Trending */}
      <div className="px-4 mb-6">
        <div className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase mb-2 px-1">
          {tNav('trendingNow')}
        </div>
        {TRENDING.map((topic, i) => (
          <div
            key={topic.tag}
            className="flex items-start gap-[10px] px-3 py-2 rounded-lg hover:bg-wp-s2 cursor-pointer transition-all mb-0.5"
          >
            <span className="font-mono text-[11px] text-wp-text3 w-[18px] flex-shrink-0 pt-0.5">#{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-wp-text truncate">{topic.tag}</div>
              <div className="font-mono text-[10px] text-wp-text3 mt-0.5">
                {topic.count} signals · {MOMENTUM_LABEL[topic.momentum]}
              </div>
            </div>
            <div className="flex items-end gap-0.5 h-5 flex-shrink-0">
              {topic.sparkHeights.map((h, j) => (
                <div
                  key={j}
                  className={`w-[3px] rounded-sm transition-all ${
                    j >= topic.sparkHeights.length - 2
                      ? 'bg-wp-amber'
                      : 'bg-[rgba(245,166,35,0.2)]'
                  }`}
                  style={{ height: `${h}px` }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
