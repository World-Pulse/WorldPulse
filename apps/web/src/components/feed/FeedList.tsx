'use client'

import { useState } from 'react'
import type { Post } from '@worldpulse/types'
import { PollDisplay } from './PollDisplay'
import { RichMediaEmbed, extractFirstEmbedUrl } from '@/components/RichMediaEmbed'
import { ImageGallery } from '@/components/ImageGallery'

// ─── MOCK DATA (replaced by API in production) ────────────────────────────
const MOCK_POSTS = [
  {
    id: '1',
    type: 'signal',
    severity: 'critical',
    source: 'AP',
    sourceBadge: 'ap',
    author: { initials: 'AP', name: 'AP World', handle: '@apworld', verified: true, color: 'from-red-700 to-red-900' },
    breaking: true,
    event: {
      category: 'SEISMIC · DISASTER',
      location: '📍 Manila Bay, Philippines',
      title: 'Earthquake M5.8 strikes Manila Bay — buildings evacuated across Metro Manila',
      summary: 'PHIVOLCS confirms M5.8 at 14km depth. Tsunami watch NOT issued. Reports of structural damage in Pasay and Parañaque. All emergency services activated. 14 aftershocks in first 20 minutes.',
      sources: ['ap', 'reuters', 'bbc', 'ai'],
      impact: 72,
      impactColor: '#ff3b5c',
    },
    likes: 31400, boosts: 12700, replies: 4200,
    time: '2m',
    reliability: 4.5,
  },
  {
    id: '2',
    type: 'post',
    author: { initials: 'SJ', name: 'Sara Johnson', handle: '@sara_seismo', verified: true, color: 'from-violet-600 to-purple-900', badge: 'Seismologist' },
    content: `Manila M5.8 — context: this sits near the West Valley Fault. Depth of 14km is shallow = more surface shaking. Watch for delayed structural collapses in older buildings. Thread on what to expect 👇\n\n#ManilaQuake #PHIVOLCS #Seismology`,
    tags: ['#ManilaQuake', '#PHIVOLCS', '#Seismology'],
    tagTypes: ['conflict', 'technology', 'science'],
    likes: 18200, boosts: 6300, replies: 892,
    time: '4m',
    reliability: 5,
  },
  {
    id: '3',
    type: 'signal',
    severity: 'high',
    author: { initials: 'EU', name: 'Reuters World', handle: '@reuters', verified: true, color: 'from-blue-700 to-blue-900' },
    source: 'REUTERS',
    sourceBadge: 'reuters',
    event: {
      category: 'REGULATION · TECHNOLOGY',
      location: '📍 Brussels, Belgium',
      title: 'EU issues emergency AI safety directive — 24-hour compliance window for frontier labs',
      summary: 'European Commission invokes emergency clause under AI Act. Major AI labs must submit capability assessments within 24h. Three companies in sealed annex. Markets reacting to enforcement uncertainty.',
      sources: ['reuters', 'bbc', 'ai'],
      impact: 58,
      impactColor: '#f5a623',
    },
    likes: 14600, boosts: 8900, replies: 2100,
    time: '11m',
    reliability: 4.5,
  },
  {
    id: '4',
    type: 'post',
    author: { initials: 'MK', name: 'Marcus K.', handle: '@marcus_climate', color: 'from-green-600 to-emerald-900', badge: 'Climate Analyst' },
    content: `The Arctic sea ice data drop today is alarming. We're not just at a new March low — we're 940,000 km² below the previous record. That's the size of Egypt gone. Feedback loops are accelerating faster than IPCC worst-case models from 2021.`,
    tags: ['#ArcticMelt', '#ClimateEmergency', '#SeaIce'],
    tagTypes: ['climate', 'climate', 'science'],
    hasChart: true,
    likes: 22800, boosts: 9200, replies: 1400,
    time: '18m',
    reliability: null,
  },
  {
    id: '5',
    type: 'signal',
    severity: 'medium',
    author: { initials: 'BBC', name: 'BBC World', handle: '@bbcworld', verified: true, color: 'from-red-800 to-red-950' },
    source: 'BBC',
    sourceBadge: 'bbc',
    event: {
      category: 'ELECTIONS · POLITICS',
      location: '📍 South Korea',
      title: 'South Korea Snap Presidential Election — 68.2% turnout, 23% votes counted',
      summary: 'Opposition Democratic Party holds 3.4% lead in early count. Rural districts not yet reporting. 38 countries\' observers on-site. Results expected before 06:00 KST.',
      sources: ['bbc', 'ai'],
      impact: 44,
      impactColor: '#00d4ff',
      isLive: true,
    },
    likes: 7600, boosts: 4100, replies: 983,
    time: '24m',
    reliability: 5,
  },
  {
    id: '6',
    type: 'ai_digest',
    author: { initials: '⚡', name: 'WorldPulse AI Digest', handle: '@worldpulse_ai', color: 'from-amber-500 to-orange-700' },
    content: `**Market Synthesis — 14:00 UTC**\n\nMarkets reacting to three converging signals: Manila quake (PSEI -1.2%), EU AI directive uncertainty (tech sector -0.8%), and South Korea election volatility (KRW -0.4%). Gold and JPY seeing safe-haven flows. Watch: Fed minutes release in 2h may recalibrate risk appetite regardless of geopolitical developments.`,
    tags: ['#Markets', '#GlobalEconomy', '#TechStocks'],
    tagTypes: ['economy', 'economy', 'technology'],
    likes: 11300, boosts: 5800, replies: 672,
    time: '31m',
    reliability: null,
  },
]

const SEVERITY_BORDER: Record<string, string> = {
  critical: 'border-l-[3px] border-l-wp-red',
  high:     'border-l-[3px] border-l-wp-amber',
  medium:   'border-l-[3px] border-l-wp-cyan',
}

const SOURCE_BADGES: Record<string, string> = {
  ap:      'bg-red-700 text-white',
  reuters: 'bg-orange-500 text-black',
  bbc:     'bg-red-800 text-white',
  ai:      'bg-[rgba(0,212,255,0.1)] text-wp-cyan border border-[rgba(0,212,255,0.3)]',
}

const SOURCE_LABELS: Record<string, string> = {
  ap: 'AP', reuters: 'REUTERS', bbc: 'BBC', ai: 'AI VERIFIED',
}

function formatCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n)
}

function ReliabilityDots({ score }: { score: number | null }) {
  if (!score) return null
  const filled  = Math.floor(score)
  const partial = score % 1 >= 0.5 ? 1 : 0
  const empty   = 5 - filled - partial
  return (
    <div className="ml-auto flex items-center gap-1 text-wp-text3 font-mono text-[10px]">
      <span>Reliability</span>
      <div className="flex gap-[2px]">
        {Array(filled).fill(0).map((_,i)  => <div key={`f${i}`} className="w-[5px] h-[5px] rounded-full bg-wp-green" />)}
        {Array(partial).fill(0).map((_,i) => <div key={`p${i}`} className="w-[5px] h-[5px] rounded-full bg-wp-amber" />)}
        {Array(empty).fill(0).map((_,i)   => <div key={`e${i}`} className="w-[5px] h-[5px] rounded-full bg-wp-s3" />)}
      </div>
    </div>
  )
}

function TagPills({ tags, types }: { tags: string[]; types?: string[] }) {
  return (
    <div className="flex gap-[6px] flex-wrap mb-[10px]">
      {tags.map((tag, i) => (
        <span key={tag} className={`tag-pill tag-${types?.[i] ?? 'breaking'}`}>{tag}</span>
      ))}
    </div>
  )
}

function ActionBar({ item }: { item: typeof MOCK_POSTS[0] }) {
  const [liked, setLiked] = useState(false)
  const [likes, setLikes] = useState(item.likes)

  const toggleLike = () => {
    setLiked(l => !l)
    setLikes(n => liked ? n - 1 : n + 1)
  }

  return (
    <div className="flex items-center gap-0 mt-2" role="group" aria-label="Post actions">
      <button
        className="flex items-center gap-[5px] px-3 py-[6px] rounded-full text-[12px] text-wp-text3 hover:text-wp-amber hover:bg-[rgba(245,166,35,0.1)] transition-all"
        aria-label={`Reply — ${formatCount(item.replies)} replies`}
      >
        <span aria-hidden="true">💬</span> {formatCount(item.replies)}
      </button>
      <button
        className="flex items-center gap-[5px] px-3 py-[6px] rounded-full text-[12px] text-wp-text3 hover:text-wp-amber hover:bg-[rgba(245,166,35,0.1)] transition-all"
        aria-label={`Boost — ${formatCount(item.boosts)} boosts`}
        aria-pressed={false}
      >
        <span aria-hidden="true">🔁</span> {formatCount(item.boosts)}
      </button>
      <button
        onClick={toggleLike}
        aria-label={liked ? `Unlike — ${formatCount(likes)} likes` : `Like — ${formatCount(likes)} likes`}
        aria-pressed={liked}
        className={`flex items-center gap-[5px] px-3 py-[6px] rounded-full text-[12px] transition-all
          ${liked ? 'text-wp-red' : 'text-wp-text3 hover:text-wp-red hover:bg-[rgba(255,59,92,0.1)]'}`}
      >
        <span aria-hidden="true">❤️</span> {formatCount(likes)}
      </button>
      <button
        className="flex items-center gap-[5px] px-3 py-[6px] rounded-full text-[12px] text-wp-text3 hover:text-wp-amber hover:bg-[rgba(245,166,35,0.1)] transition-all"
        aria-label="Share post"
      >
        <span aria-hidden="true">📤</span>
      </button>
      <ReliabilityDots score={item.reliability} />
    </div>
  )
}

export function FeedList({ tab, category }: { tab: string; category: string }) {
  return (
    <div>
      {MOCK_POSTS.map(item => (
        <article
          key={item.id}
          role="article"
          aria-label={
            'event' in item && item.event
              ? item.event.title
              : 'content' in item && item.content
                ? item.content.slice(0, 80)
                : `Post by ${item.author.name}`
          }
          className={`flex gap-3 px-5 py-4 border-b border-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.015)] transition-colors cursor-pointer animate-fade-in
            ${item.type === 'signal' ? SEVERITY_BORDER[(item as typeof MOCK_POSTS[0] & {severity?:string}).severity ?? ''] ?? '' : ''}`}
        >
          {/* Avatar */}
          <div className={`w-[42px] h-[42px] rounded-full bg-gradient-to-br ${item.author.color} flex items-center justify-center font-bold text-[14px] text-white flex-shrink-0`}>
            {item.author.initials}
          </div>

          {/* Body */}
          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-center gap-[6px] mb-1 flex-wrap">
              <span className="font-semibold text-[14px] text-wp-text">{item.author.name}</span>
              {item.author.verified && <span className="text-wp-cyan text-[13px]">✓</span>}
              {'sourceBadge' in item && item.sourceBadge && (
                <span className={`source-badge ${SOURCE_BADGES[item.sourceBadge] ?? ''}`}>
                  {SOURCE_LABELS[item.sourceBadge]}
                </span>
              )}
              {'badge' in item.author && item.author.badge && (
                <span className="source-badge badge-community">{item.author.badge}</span>
              )}
              {item.type === 'ai_digest' && (
                <span className="source-badge badge-ai">AI SYNTHESIS</span>
              )}
              {'breaking' in item && item.breaking && (
                <span className="source-badge bg-wp-red text-white animate-flash-tag">BREAKING</span>
              )}
              <span className="ml-auto font-mono text-[12px] text-wp-text3 flex-shrink-0">{item.time} ago</span>
            </div>

            {/* Event card for signals */}
            {'event' in item && item.event && (
              <div className={`bg-wp-s2 border border-[rgba(255,255,255,0.07)] rounded-[10px] p-3 mb-[10px] relative overflow-hidden`}>
                <div className={`absolute top-0 left-0 right-0 h-[2px]`}
                  style={{ background: `linear-gradient(to right, ${item.event.impactColor ?? '#f5a623'}, transparent)` }} />
                <div className="flex items-center gap-2 mb-[6px] flex-wrap">
                  <span className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase">{item.event.category}</span>
                  <span className="font-mono text-[10px] text-wp-text2">{item.event.location}</span>
                  {'isLive' in item.event && item.event.isLive && (
                    <span className="ml-auto tag-pill tag-technology text-[8px]">LIVE RESULTS</span>
                  )}
                </div>
                <div className="font-semibold text-[14px] text-wp-text mb-1 leading-[1.4]">{item.event.title}</div>
                <div className="text-[12px] text-wp-text2 leading-[1.5] mb-2">{item.event.summary}</div>
                <div className="flex gap-1 flex-wrap mb-2">
                  {item.event.sources.map(s => (
                    <span key={s} className={`source-badge ${SOURCE_BADGES[s]}`}>{SOURCE_LABELS[s]}</span>
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-[rgba(255,255,255,0.05)]">
                  <span className="font-mono text-[9px] text-wp-text3">IMPACT</span>
                  <div className="flex-1 h-1 bg-wp-s3 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-1000"
                      style={{ width: `${item.event.impact}%`, background: item.event.impactColor }} />
                  </div>
                  <span className="font-mono text-[9px] text-wp-text3">{item.event.impact}%</span>
                </div>
              </div>
            )}

            {/* Post content */}
            {'content' in item && item.content && (() => {
              const text = (item.content as string).replace(/\*\*(.*?)\*\*/g, '$1')
              const embedUrl = extractFirstEmbedUrl(text)
              return (
                <>
                  <div className="text-[14px] text-wp-text leading-[1.6] mb-[10px] whitespace-pre-line">
                    {text}
                  </div>
                  {/* Auto-embed detected YouTube/Vimeo URLs */}
                  {embedUrl && (
                    <div className="mb-[10px]">
                      <RichMediaEmbed url={embedUrl} />
                    </div>
                  )}
                  {/* Image/video gallery if post has media_urls */}
                  {'mediaUrls' in item && Array.isArray((item as Record<string, unknown>).mediaUrls) && ((item as Record<string, unknown>).mediaUrls as string[]).length > 0 && (
                    <div className="mb-[10px]">
                      <ImageGallery
                        urls={(item as Record<string, unknown>).mediaUrls as string[]}
                        types={(item as Record<string, unknown>).mediaTypes as string[] | undefined}
                      />
                    </div>
                  )}
                </>
              )
            })()}

            {/* Chart placeholder */}
            {'hasChart' in item && item.hasChart && (
              <div className="bg-gradient-to-br from-[#0f2027] via-[#203a43] to-[#2c5364] rounded-[10px] border border-[rgba(255,255,255,0.07)] mb-[10px] p-5 flex items-center justify-center min-h-[80px] text-wp-cyan font-mono text-[12px]">
                [Arctic Sea Ice Extent — Click to expand]
              </div>
            )}

            {/* Poll */}
            {'pollData' in item && item.pollData && (
              <PollDisplay
                poll={item.pollData}
                pollId={'pollId' in item ? (item as { pollId?: string }).pollId : undefined}
              />
            )}

            {/* Tags */}
            {'tags' in item && item.tags && (
              <TagPills tags={item.tags} types={'tagTypes' in item ? item.tagTypes : undefined} />
            )}

            {/* Actions */}
            <ActionBar item={item} />
          </div>
        </article>
      ))}

      {/* Load more */}
      <div className="flex justify-center py-6">
        <button className="px-6 py-[10px] rounded-full border border-[rgba(255,255,255,0.1)] text-[13px] text-wp-text2 hover:border-wp-amber hover:text-wp-amber hover:bg-[rgba(245,166,35,0.05)] transition-all font-medium">
          Load more signals
        </button>
      </div>
    </div>
  )
}
