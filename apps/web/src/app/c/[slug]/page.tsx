'use client'

import { use } from 'react'
import { FeedList } from '@/components/feed/FeedList'
import { LeftSidebar } from '@/components/sidebar/LeftSidebar'
import { RightSidebar } from '@/components/sidebar/RightSidebar'

const CATEGORY_META: Record<string, { label: string; icon: string; description: string; color: string }> = {
  breaking:   { label: 'Breaking News',  icon: '🚨', description: 'Real-time breaking news verified across multiple sources', color: '#ff3b5c' },
  conflict:   { label: 'Conflict',       icon: '⚔️', description: 'Global conflict zones, military operations, and peace negotiations', color: '#ff3b5c' },
  markets:    { label: 'Markets',        icon: '📈', description: 'Financial markets, economic signals, and global trade', color: '#f5a623' },
  climate:    { label: 'Climate',        icon: '🌡️', description: 'Climate events, policy, scientific data, and environmental signals', color: '#00e676' },
  health:     { label: 'Health',         icon: '🏥', description: 'WHO alerts, disease outbreaks, and global health policy', color: '#00d4ff' },
  technology: { label: 'Technology',     icon: '💻', description: 'AI governance, tech regulation, cybersecurity, and digital policy', color: '#a855f7' },
  politics:   { label: 'Politics',       icon: '🏛️', description: 'Elections, governance, geopolitics, and international relations', color: '#f5a623' },
  culture:    { label: 'Culture',        icon: '🎭', description: 'Art, society, sports, and cultural movements worldwide', color: '#00d4ff' },
  geopolitics:{ label: 'Geopolitics',    icon: '🌐', description: 'International relations, diplomacy, and global power dynamics', color: '#f5a623' },
  economy:    { label: 'Economy',        icon: '💰', description: 'Global economics, trade, inflation, and fiscal policy', color: '#f5a623' },
  science:    { label: 'Science',        icon: '🔬', description: 'Scientific discoveries, research, and academic breakthroughs', color: '#00d4ff' },
  elections:  { label: 'Elections',      icon: '🗳️', description: 'Electoral events, voter rights, and democratic processes', color: '#00d4ff' },
  disaster:   { label: 'Disaster',       icon: '🌊', description: 'Natural disasters, emergency response, and humanitarian crises', color: '#ff3b5c' },
  security:   { label: 'Security',       icon: '🔒', description: 'Cybersecurity, national security, and intelligence signals', color: '#f97316' },
  space:      { label: 'Space',          icon: '🚀', description: 'Space exploration, astronomy, and aerospace developments', color: '#6366f1' },
}

// Map /c/ slugs to API category names
const SLUG_TO_CATEGORY: Record<string, string> = {
  breaking:   'breaking',
  conflict:   'conflict',
  markets:    'economy',
  climate:    'climate',
  health:     'health',
  technology: 'technology',
  politics:   'elections',
  culture:    'culture',
  geopolitics:'geopolitics',
  economy:    'economy',
  science:    'science',
  elections:  'elections',
  disaster:   'disaster',
  security:   'security',
  space:      'space',
}

export default function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const meta = CATEGORY_META[slug] ?? {
    label: slug.charAt(0).toUpperCase() + slug.slice(1),
    icon: '📡',
    description: `Signals tagged with ${slug}`,
    color: '#f5a623',
  }
  const apiCategory = SLUG_TO_CATEGORY[slug] ?? slug

  return (
    <div className="grid grid-cols-[240px_1fr_300px] min-h-[calc(100vh-52px)]">
      <LeftSidebar />

      <div className="border-x border-[rgba(255,255,255,0.07)] bg-wp-bg">
        {/* Category header */}
        <div className="sticky top-[52px] glass border-b border-[rgba(255,255,255,0.07)] z-50 px-5 py-4">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-[22px] flex-shrink-0"
              style={{ background: `${meta.color}22`, border: `1px solid ${meta.color}44` }}
            >
              {meta.icon}
            </div>
            <div>
              <h1 className="font-display text-[18px] tracking-wider text-wp-text">{meta.label.toUpperCase()}</h1>
              <p className="text-[12px] text-wp-text3 mt-0.5">{meta.description}</p>
            </div>
            <div
              className="ml-auto flex items-center gap-[6px] px-3 py-1 rounded font-mono text-[10px] font-bold tracking-widest"
              style={{ background: `${meta.color}18`, border: `1px solid ${meta.color}44`, color: meta.color }}
            >
              <span className="w-[5px] h-[5px] rounded-full animate-pulse" style={{ background: meta.color }} />
              LIVE
            </div>
          </div>
        </div>

        <FeedList tab="global" category={apiCategory} />
      </div>

      <RightSidebar />
    </div>
  )
}
