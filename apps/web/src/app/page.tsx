'use client'

import { useState } from 'react'
import { LeftSidebar } from '@/components/sidebar/LeftSidebar'
import { RightSidebar } from '@/components/sidebar/RightSidebar'
import { FeedList } from '@/components/feed/FeedList'
import { Composer } from '@/components/composer/Composer'
import { NewPostsBar } from '@/components/feed/NewPostsBar'

type FeedTab = 'global' | 'following' | 'verified' | 'digest'
type FilterCat = 'all' | 'breaking' | 'conflict' | 'climate' | 'economy' | 'technology' | 'health'

const TABS: { id: FeedTab; label: string }[] = [
  { id: 'global',   label: 'Global Pulse' },
  { id: 'following',label: 'Following' },
  { id: 'verified', label: 'Verified Sources' },
  { id: 'digest',   label: 'AI Digest' },
]

const FILTERS: { id: FilterCat; label: string }[] = [
  { id: 'all',        label: 'All' },
  { id: 'breaking',   label: 'Breaking' },
  { id: 'conflict',   label: 'Conflict' },
  { id: 'climate',    label: 'Climate' },
  { id: 'economy',    label: 'Markets' },
  { id: 'technology', label: 'Tech' },
  { id: 'health',     label: 'Health' },
]

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<FeedTab>('global')
  const [activeFilter, setActiveFilter] = useState<FilterCat>('all')
  const [newCount, setNewCount] = useState(14)

  return (
    <div className="grid grid-cols-[240px_1fr_300px] min-h-[calc(100vh-52px)]">

      {/* LEFT SIDEBAR */}
      <LeftSidebar />

      {/* MAIN FEED */}
      <div className="border-x border-[rgba(255,255,255,0.07)] bg-wp-bg">

        {/* Feed header sticky */}
        <div className="sticky top-[52px] glass border-b border-[rgba(255,255,255,0.07)] z-50">
          <div className="flex items-center justify-between px-5 py-3">
            {/* Tabs */}
            <div className="flex gap-0">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-[6px] text-[13px] font-medium border-b-2 transition-all
                    ${activeTab === tab.id
                      ? 'text-wp-amber border-wp-amber'
                      : 'text-wp-text3 border-transparent hover:text-wp-text2'
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Category filters */}
            <div className="flex items-center gap-[6px]">
              {FILTERS.map(f => (
                <button
                  key={f.id}
                  onClick={() => setActiveFilter(f.id)}
                  className={`px-[10px] py-1 rounded-full border text-[11px] font-mono transition-all
                    ${activeFilter === f.id
                      ? 'border-wp-cyan text-wp-cyan bg-[rgba(0,212,255,0.1)]'
                      : 'border-[rgba(255,255,255,0.07)] text-wp-text3 hover:border-[rgba(255,255,255,0.15)] hover:text-wp-text2'
                    }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Composer */}
        <Composer />

        {/* New posts notification */}
        {newCount > 0 && (
          <NewPostsBar count={newCount} onLoad={() => setNewCount(0)} />
        )}

        {/* Feed items */}
        <FeedList tab={activeTab} category={activeFilter} />
      </div>

      {/* RIGHT SIDEBAR */}
      <RightSidebar />
    </div>
  )
}
