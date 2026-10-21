'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations, useLocale } from '@/lib/i18n'
import { useState, useEffect, type ElementType } from 'react'
import { trendingRows, TRENDING_SHOWN, type TrendingRow, type TrendingAnswer } from '@/lib/trending-entities'
import { entityTypeIcon } from '@/lib/entity-links'
import {
  Zap, Globe, Bell, BarChart3, Telescope, LayoutGrid, ClipboardList,
  TrendingUp, Shield, Unplug, Satellite, Lock, Waves, Landmark,
  Wheat, KeyRound, Droplets, Pickaxe, Map, ScrollText, Users, Search,
  Mic, Video, Radio, Wrench, Settings, Activity, Anchor, CalendarDays, Camera,
  CircleDot, Swords, LineChart, Leaf, Pill, FlaskConical, Vote, Globe2, Network, Newspaper, Link2, BadgeCheck,
  type LucideProps,
} from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// "NEW" on the newest few only: on Oct 11, 2026, 18 of 25 items carried it (and
// Alerts a fixed "12"), so it told the reader nothing.
// Oct 20, 2026: what WorldPulse is for comes first (the stories, the week, the
// map, checking a link and how the outlets are counted); every other section
// follows as before.
const CORE_ITEMS = [
  { href: '/',           icon: Zap,           labelKey: 'liveFeed' },
  { href: '/map',        icon: Globe,         labelKey: 'worldMap',    badge: 'LIVE', badgeColor: 'amber' },
  { href: '/briefing',   icon: ClipboardList, labelKey: 'briefing',   badge: 'NEW', badgeColor: 'indigo' },
  { href: '/week',       icon: CalendarDays,  labelKey: 'week',       badge: 'NEW', badgeColor: 'indigo' }, // the week's top stories (plan G11, Oct 20, 2026)
  { href: '/check',      icon: Link2,          labelKey: 'checkLink',  badge: 'NEW', badgeColor: 'indigo' }, // paste a link, get the count (Oct 20, 2026)
  { href: '/entities',   icon: Newspaper,     labelKey: 'inTheNews',  badge: 'NEW', badgeColor: 'purple' }, // who's in the news: the entity pages' index (Oct 13, 2026)
  { href: '/countries',  icon: Map,            labelKey: 'countries' },
  { href: '/how-we-count', icon: BadgeCheck,  labelKey: 'howWeCount' },
] as const

/** Every other section, as before */
const OTHER_ITEMS = [
  { href: '/alerts',     icon: Bell,          labelKey: 'alerts' },
  { href: '/analytics',  icon: BarChart3,     labelKey: 'analytics'  },
  { href: '/explore',    icon: Telescope,     labelKey: 'explore'    },
  { href: '/knowledge-graph/explorer', icon: Network, labelKey: 'knowledgeGraph', badge: 'NEW', badgeColor: 'purple' },
  // { href: '/clusters',   icon: LayoutGrid,    labelKey: 'clusters',   badge: 'NEW', badgeColor: 'blue'   }, // Hidden — needs correlation engine (Aether)
  { href: '/finance',    icon: TrendingUp,    labelKey: 'finance' },
  { href: '/maritime',        icon: Anchor,     labelKey: 'maritime' },
  { href: '/sanctions',        icon: Shield,    labelKey: 'sanctions' },
  { href: '/internet-outages', icon: Unplug,    labelKey: 'internetOutages', badge: 'NEW', badgeColor: 'cyan'   }, // back Oct 20, 2026 (Devon: "Yes"): reports come from IODA's new home at Georgia Tech
  // { href: '/space-weather',   icon: Satellite,  labelKey: 'spaceWeather',    badge: 'NEW', badgeColor: 'cyan'   }, // Hidden — needs more work before launch
  { href: '/cyber-threats',   icon: Lock,       labelKey: 'cyberThreats' },
  { href: '/undersea-cables', icon: Waves,      labelKey: 'underseaCables' },
  { href: '/governance',      icon: Landmark,   labelKey: 'governance' },
  { href: '/food-security',  icon: Wheat,       labelKey: 'foodSecurity' },
  { href: '/digital-rights', icon: KeyRound,    labelKey: 'digitalRights' },
  { href: '/water-security', icon: Droplets,    labelKey: 'waterSecurity' },
  { href: '/labor-rights',  icon: Pickaxe,      labelKey: 'laborRights' },
  { href: '/cameras',    icon: Camera,      labelKey: 'cameras',    badge: 'LIVE', badgeColor: 'red'   }, // back Oct 21, 2026 (M45): the pictures come through our API since M37
  { href: '/patents',    icon: ScrollText,    labelKey: 'patents' },
  { href: '/communities',icon: Users,         labelKey: 'communities' },
  { href: '/claims',     icon: Search,        labelKey: 'claims' },
  // { href: '/audio-claims', icon: Mic,         labelKey: 'audioClaims', badge: 'NEW', badgeColor: 'red'   }, // Hidden — pipeline not wired up yet (no podcast claims are collected)
  // { href: '/video-claims', icon: Video,       labelKey: 'videoClaims', badge: 'NEW', badgeColor: 'red'   }, // Hidden — pipeline not wired up yet
  { href: '/sources',    icon: Radio,         labelKey: 'mySources'  },
  { href: '/developers', icon: Wrench,        labelKey: 'developers'  },
  { href: '/settings',   icon: Settings,      labelKey: 'settings'   },
  { href: '/status',     icon: Activity,      labelKey: 'status'     },
] as const

type NavItem = (typeof CORE_ITEMS)[number] | (typeof OTHER_ITEMS)[number]

const CHANNELS = [
  { href: '/c/breaking',   icon: CircleDot,   labelKey: 'breakingNews',  color: 'text-wp-red' },
  { href: '/c/conflict',   icon: Swords,      labelKey: 'conflictZones', color: 'text-red-500' },
  { href: '/c/markets',    icon: LineChart,    labelKey: 'markets',        color: 'text-wp-amber' },
  { href: '/c/climate',    icon: Leaf,         labelKey: 'climate',        color: 'text-green-400' },
  { href: '/c/health',     icon: Pill,         labelKey: 'health',         color: 'text-purple-400' },
  { href: '/c/technology', icon: FlaskConical, labelKey: 'scienceTech',    color: 'text-wp-cyan' },
  { href: '/c/politics',   icon: Vote,         labelKey: 'politics',       color: 'text-blue-400' },
  { href: '/c/culture',    icon: Globe2,       labelKey: 'culture',        color: 'text-pink-400' },
] as const

export function LeftSidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const tNav = useTranslations('nav')
  // The sidebar's language (the page's stories stay English: lib/locale.ts)
  const locale = useLocale()
  const tChannels = useTranslations('channels')
  const tCommon = useTranslations('common')

  // Who's in the news (lib/trending-entities.ts): null while loading, [] if it can't load
  const [trending, setTrending] = useState<TrendingRow[] | null>(null)
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

      // (The channels' counts were taken out on Oct 20, 2026: each came from a feed page's
      // item count, so every channel said "1", and each visit asked for 8 of them every
      // 2 minutes.)

      try {
        // Who's in the news: the most-named people, places and organisations of 24 hours
        // (twice as many asked for, since rows without a name or count are skipped;
        // a failed refresh keeps the rows already shown)
        const res = await fetch(`${API_URL}/api/v1/knowledge-graph/trending?limit=${TRENDING_SHOWN * 2}&window_hours=24&lean=1`)
        const rows = res.ok ? trendingRows(await res.json() as TrendingAnswer) : null
        setTrending(prev => rows ?? prev ?? [])
      } catch {
        setTrending(prev => prev ?? [])
      }
    }

    loadSidebarData()
    const interval = setInterval(loadSidebarData, 2 * 60 * 1000) // refresh every 2 min
    return () => clearInterval(interval)
  }, [])

  const renderItem = (item: NavItem) => {
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
        <item.icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
        <span>{tNav(item.labelKey)}</span>
        {'badge' in item && item.badge && (
          <span
            className={`ml-auto rtl:ml-0 rtl:mr-auto font-mono text-[9px] px-[6px] py-0.5 rounded-full font-bold
              ${String(item.badgeColor) === 'red'
                ? 'bg-wp-red text-white'
                : 'bg-wp-amber text-black'
              }`}
            aria-label={item.badge === 'LIVE' ? 'Live' : 'New'}
          >
            {item.badge}
          </span>
        )}
      </Link>
    )
  }

  return (
    <aside
      aria-label="Main navigation"
      lang={locale}
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
        {CORE_ITEMS.map(renderItem)}
        <div className="my-2 mx-3 h-px bg-[rgba(255,255,255,0.07)]" aria-hidden="true" />
        {OTHER_ITEMS.map(renderItem)}
      </nav>

      {/* Signal Channels */}
      <nav aria-label="Signal channels" className="px-4 mb-6">
        <div className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase mb-2 px-1" aria-hidden="true">
          {tNav('signalChannels')}
        </div>
        {CHANNELS.map(ch => {
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
              <ch.icon className={`w-4 h-4 flex-shrink-0 ${ch.color}`} aria-hidden="true" />
              <span>{tChannels(ch.labelKey)}</span>
            </Link>
          )
        })}
      </nav>

      {/* Trending: who's in the news, real counts (lib/trending-entities.ts); hidden if it can't load */}
      {(trending === null || trending.length > 0) && (
        <div className="px-4 mb-6">
          <div className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase mb-2 px-1">
            {tNav('trendingNow')}
          </div>
          {trending === null
            ? Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="h-[46px] mx-3 mb-0.5 rounded-lg bg-wp-s2/40" aria-hidden="true" />
              ))
            : trending.map((row, i) => (
                <Link
                  key={row.href}
                  href={row.href}
                  className="flex items-start gap-[10px] px-3 py-2 rounded-lg hover:bg-wp-s2 transition-all mb-0.5 no-underline"
                >
                  <span className="font-mono text-[11px] text-wp-text3 w-[18px] flex-shrink-0 pt-0.5">#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-wp-text truncate">
                      <span aria-hidden="true" className="mr-1">{entityTypeIcon(row.type)}</span>{row.name}
                    </div>
                    <div className="font-mono text-[10px] text-wp-text3 mt-0.5">
                      {row.count}
                      {row.rise && <span className={row.rise === 'NEW' ? 'text-wp-amber' : 'text-wp-red'}> · {row.rise}</span>}
                    </div>
                  </div>
                </Link>
              ))}
        </div>
      )}
    </aside>
  )
}
