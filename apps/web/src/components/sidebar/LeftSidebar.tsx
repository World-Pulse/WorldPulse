'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from '@/lib/i18n'
import { useState, useEffect } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const NAV_ITEMS = [
  { href: '/',           icon: '⚡', labelKey: 'liveFeed' },
  { href: '/map',        icon: '🌍', labelKey: 'worldMap',    badge: 'LIVE', badgeColor: 'amber' },
  { href: '/alerts',     icon: '🔔', labelKey: 'alerts',      badge: '12',   badgeColor: 'red'   },
  { href: '/analytics',  icon: '📊', labelKey: 'analytics'  },
  { href: '/explore',    icon: '🔭', labelKey: 'explore'    },
  { href: '/clusters',   icon: '🧩', labelKey: 'clusters',   badge: 'NEW', badgeColor: 'blue'   },
  { href: '/briefing',   icon: '📋', labelKey: 'briefing',   badge: 'NEW', badgeColor: 'indigo' },
  { href: '/finance',    icon: '💹', labelKey: 'finance',    badge: 'NEW', badgeColor: 'green'  },
  { href: '/sanctions',        icon: '🛡️', labelKey: 'sanctions',       badge: 'NEW', badgeColor: 'amber'  },
  { href: '/internet-outages', icon: '🔌', labelKey: 'internetOutages', badge: 'NEW', badgeColor: 'cyan'   },
  { href: '/space-weather',   icon: '🛰️', labelKey: 'spaceWeather',    badge: 'NEW', badgeColor: 'cyan'   },
  { href: '/cyber-threats',   icon: '🔒', labelKey: 'cyberThreats',    badge: 'NEW', badgeColor: 'red'    },
  { href: '/undersea-cables', icon: '🌊', labelKey: 'underseaCables', badge: 'NEW', badgeColor: 'cyan'   },
  { href: '/governance',      icon: '🏛️', labelKey: 'governance',      badge: 'NEW', badgeColor: 'purple' },
  { href: '/food-security',  icon: '🌾', labelKey: 'foodSecurity',    badge: 'NEW', badgeColor: 'amber'  },
  { href: '/digital-rights', icon: '🔐', labelKey: 'digitalRights',   badge: 'NEW', badgeColor: 'amber'  },
  { href: '/water-security', icon: '💧', labelKey: 'waterSecurity',   badge: 'NEW', badgeColor: 'amber'  },
  { href: '/labor-rights',  icon: '⚒️', labelKey: 'laborRights',    badge: 'NEW', badgeColor: 'amber'  },
  { href: '/countries',  icon: '🗺️', labelKey: 'countries',  badge: 'NEW',  badgeColor: 'blue'  },
  // { href: '/cameras',    icon: '📹', labelKey: 'cameras',    badge: 'LIVE', badgeColor: 'red'   }, // Hidden pre-launch: EarthCam hotlink-blocks snapshots; needs backend image proxy
  { href: '/patents',    icon: '📜', labelKey: 'patents',    badge: 'NEW',  badgeColor: 'cyan'  },
  { href: '/communities',icon: '🤝', labelKey: 'communities' },
  { href: '/claims',     icon: '🔍', labelKey: 'claims',     badge: 'NEW', badgeColor: 'amber'  },
  { href: '/audio-claims', icon: '🎙️', labelKey: 'audioClaims', badge: 'NEW', badgeColor: 'red'   },
  { href: '/video-claims', icon: '📹', labelKey: 'videoClaims', badge: 'NEW', badgeColor: 'red'   },
  { href: '/sources',    icon: '📡', labelKey: 'mySources'  },
  { href: '/developers', icon: '🛠️', labelKey: 'developers'  },
  { href: '/settings',   icon: '⚙️', labelKey: 'settings'   },
  { href: '/status',     icon: '🟢', labelKey: 'status'     },
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

// Fallback trending topics shown before real data loads
const TRENDING_FALLBACK = [
  { tag: '#WorldPulse',   count: '—',  momentum: 'steady',  sparkHeights: [8, 10, 12, 10, 12] },
  { tag: '#Breaking',     count: '—',  momentum: 'rising',  sparkHeights: [5, 8, 11, 14, 17] },
  { tag: '#Climate',      count: '—',  momentum: 'steady',  sparkHeights: [12, 14, 11, 13, 14] },
  { tag: '#GlobalEvents', count: '—',  momentum: 'rising',  sparkHeights: [8, 10, 12, 15, 16] },
  { tag: '#OSINT',        count: '—',  momentum: 'surging', sparkHeights: [4, 7, 10, 14, 18] },
]

const MOMENTUM_LABEL: Record<string, string> = {
  surging: '🔥 Surging',
  rising:  '↑ Rising',
  steady:  '→ Steady',
  cooling: '↓ Cooling',
}

// Map channel slugs to API category params for live count fetch
const CHANNEL_CATEGORIES: Record<string, string> = {
  breaking:   'breaking',
  conflict:   'conflict',
  markets:    'economy',
  climate:    'climate',
  health:     'health',
  technology: 'technology',
  politics:   'elections',
  culture:    'culture',
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000)      return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

export function LeftSidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const tNav = useTranslations('nav')
  const tChannels = useTranslations('channels')
  const tCommon = useTranslations('common')

  // Live signal counts per channel (fetched once on mount, refreshes every 2 min)
  const [channelCounts, setChannelCounts] = useState<Record<string, number>>({})
  // Real trending topics from API
  const [trending, setTrending] = useState(TRENDING_FALLBACK)
  // Live Global Threat Index
  const [threatLevel, setThreatLevel] = useState<{ level: number; label: string; color: string } | null>(null)

  // Global Cmd+K / Ctrl+K → open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        router.push('/search')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [router])

  useEffect(() => {
    async function loadSidebarData() {
      // Fetch threat index in parallel
      try {
        const tres = await fetch(`${API_URL}/api/v1/analytics/threat-index?window=6h`, { cache: 'no-store' })
        if (tres.ok) {
          const tdata: { level: number; label: string; color: string } = await tres.json()
          setThreatLevel(tdata)
        }
      } catch { /* keep static fallback */ }

      try {
        // Fetch channel counts in parallel (one request per channel)
        const slugs = Object.keys(CHANNEL_CATEGORIES)
        const countResults = await Promise.allSettled(
          slugs.map(async (slug) => {
            const cat = CHANNEL_CATEGORIES[slug]
            const res = await fetch(`${API_URL}/api/v1/feed/signals?category=${cat}&limit=1`, { cache: 'no-store' })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data: { total?: number; items?: unknown[] } = await res.json()
            return { slug, count: data.total ?? (data.items?.length ?? 0) }
          })
        )
        const counts: Record<string, number> = {}
        for (const result of countResults) {
          if (result.status === 'fulfilled') {
            counts[result.value.slug] = result.value.count
          }
        }
        setChannelCounts(counts)
      } catch {
        // Silently fail — counts are decorative
      }

      try {
        // Fetch real trending topics
        const res = await fetch(`${API_URL}/api/v1/feed/trending?window=1h`, { cache: 'no-store' })
        if (res.ok) {
          const data: { items?: Array<{ topic: string; score: number; window: string }> } = await res.json()
          if (data.items && data.items.length > 0) {
            const mapped = data.items.slice(0, 5).map((t, i) => ({
              tag: `#${t.topic.replace(/\s+/g, '')}`,
              count: formatCount(Math.round(t.score)),
              momentum: i === 0 ? 'surging' : i <= 2 ? 'rising' : 'steady',
              sparkHeights: [4 + i, 7 + i, 10 - i, 14 - i, 16 - i].map(h => Math.max(2, Math.min(20, h))),
            }))
            setTrending(mapped)
          }
        }
      } catch {
        // Keep fallback
      }
    }

    loadSidebarData()
    const interval = setInterval(loadSidebarData, 2 * 60 * 1000) // refresh every 2 min
    return () => clearInterval(interval)
  }, [])

  return (
    <aside
      aria-label="Main navigation"
      className="sticky top-[52px] h-[calc(100vh-52px)] overflow-y-auto border-r border-[rgba(255,255,255,0.07)] bg-wp-surface flex flex-col scrollbar-thin scrollbar-thumb-[rgba(255,255,255,0.07)] scrollbar-track-transparent rtl:border-r-0 rtl:border-l rtl:border-l-[rgba(255,255,255,0.07)]"
    >

      {/* Threat Index — live */}
      <div
        className="mx-4 mt-4 mb-2 bg-wp-s2 border border-[rgba(255,255,255,0.07)] rounded-[10px] p-3"
        role="status"
        aria-label={`Global Threat Index: Level ${threatLevel?.level ?? '…'} ${threatLevel?.label ?? ''}`}
      >
        <div className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase mb-2" aria-hidden="true">
          {tCommon('globalThreatIndex')}
        </div>
        <div className="flex gap-1 mb-2">
          {[1, 2, 3, 4, 5].map(lvl => {
            const active = lvl <= (threatLevel?.level ?? 2)
            return (
              <div
                key={lvl}
                className="flex-1 h-[6px] rounded-sm transition-all duration-700"
                style={active
                  ? { backgroundColor: threatLevel?.color ?? '#ffd700', boxShadow: `0 0 8px ${threatLevel?.color ?? '#ffd700'}` }
                  : { backgroundColor: 'rgba(255,255,255,0.06)' }
                }
              />
            )
          })}
        </div>
        <div className="font-mono text-[11px]" style={{ color: threatLevel?.color ?? '#ffd700' }}>
          {tCommon('level').toUpperCase()} {threatLevel?.level ?? '…'} · {(threatLevel?.label ?? tCommon('elevated')).toUpperCase()}
        </div>
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
        {CHANNELS.map(ch => {
          const slug = ch.href.replace('/c/', '')
          const count = channelCounts[slug]
          const isActive = pathname === ch.href
          return (
            <Link
              key={ch.href}
              href={ch.href}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-[10px] px-3 py-[9px] rounded-lg mb-0.5 text-[14px] transition-all no-underline relative
                ${isActive
                  ? 'bg-[rgba(245,166,35,0.08)] text-wp-text'
                  : 'text-wp-text2 hover:bg-wp-s2 hover:text-wp-text'
                }`}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[60%] bg-wp-amber rounded-r" aria-hidden="true" />
              )}
              <span className={`text-[16px] w-5 text-center ${ch.color}`} aria-hidden="true">{ch.icon}</span>
              <span>{tChannels(ch.labelKey)}</span>
              {count != null && count > 0 && (
                <span className="ml-auto font-mono text-[9px] text-wp-text3 flex-shrink-0" aria-label={`${count} signals`}>
                  {formatCount(count)}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Trending */}
      <div className="px-4 mb-6">
        <div className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase mb-2 px-1">
          {tNav('trendingNow')}
        </div>
        {trending.map((topic, i) => (
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
