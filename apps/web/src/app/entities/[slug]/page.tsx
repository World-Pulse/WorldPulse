import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import type { Metadata } from 'next'
import { SITE_NAME, SITE_URL, jsonLdText, metaDescription, pageMetadata } from '@/lib/page-metadata'
import { entityIdFromSlug, entityPath, entityTypeIcon, entityTypeLabel } from '@/lib/entity-links'
import { BriefingSignup } from '@/components/briefing/BriefingSignup'
import { ConnectionWhy } from './ConnectionWhy'
import { ActivityBars } from './ActivityBars'

/**
 * world-pulse.io/entities/<name>-<id>: one person, place or organisation from
 * the knowledge graph (Devon, Oct 12, 2026: "the knowledge tree brings in a lot
 * of value, how can we enhance that?"). Server-rendered so search engines and
 * link previews read it: how often it's in the news, the stories naming it,
 * its newest reports, and who it's named with, each connection explaining
 * itself. Data: GET /api/v1/knowledge-graph/entities/:id/profile.
 */

const API_BASE = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface Story {
  id: string
  leadId: string
  title: string
  category: string | null
  place: string | null
  severity: string
  outletCount: number
  outlets: string[]
  updatedAt: string
  verifiedAt: string | null
}

interface Profile {
  entity: { id: string; type: string; name: string; firstSeen: string | null; lastSeen: string | null }
  activity: { last24h: number; previous24h: number; last7d: number; daily: Array<{ day: string; n: number }> }
  stories: Story[]
  latest: Array<{ id: string; title: string; category: string | null; severity: string | null; place: string | null; verified: boolean; createdAt: string }>
  connections: Array<{ id: string; type: string; name: string; shared: number }>
}

class EntityUnavailableError extends Error {
  constructor() {
    super('The entity could not be loaded: the API did not answer')
    this.name = 'EntityUnavailableError'
  }
}

async function fetchProfile(id: string): Promise<Profile | 'missing' | 'unavailable'> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/knowledge-graph/entities/${encodeURIComponent(id)}/profile`, {
      next: { revalidate: 300 },
    })
    if (res.status === 404) return 'missing'
    if (!res.ok) return 'unavailable'
    const json = await res.json() as { success?: boolean; data?: Profile }
    return json.success && json.data ? json.data : 'missing'
  } catch {
    return 'unavailable'
  }
}

/** The page is worth indexing when there is something to read on it */
const worthIndexing = (p: Profile) => p.stories.length > 0 || p.activity.last7d >= 3

const SEV_COLOR: Record<string, string> = {
  critical: '#ff3b5c', high: '#f5a623', medium: '#fbbf24', low: '#8892a4', info: '#5a6477',
}

function ago(iso: string, now: number): string {
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000))
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

const safeDecode = (v: string): string => { try { return decodeURIComponent(v) } catch { return v } }

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

function schemaType(type: string): string {
  return type === 'person' ? 'Person' : type === 'organisation' ? 'Organization' : type === 'location' ? 'Place' : 'Thing'
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params
  const id = entityIdFromSlug(slug)
  if (!id) return { title: 'Not found — WorldPulse', robots: { index: false } }
  const profile = await fetchProfile(id)
  if (profile === 'unavailable') throw new EntityUnavailableError()
  if (profile === 'missing') return { title: 'Not found — WorldPulse', robots: { index: false } }
  const { entity, activity, stories } = profile
  const lead = stories[0]
  const description = metaDescription(
    `${entity.name} in the news: ${plural(activity.last7d, 'report')} in the last 7 days across the outlets WorldPulse follows`
    + (lead ? `. Top story: ${lead.title}${lead.verifiedAt ? ` (verified, ${lead.outletCount} outlets)` : ''}.` : '.'),
  )
  return {
    ...pageMetadata({ path: entityPath(entity.id, entity.name), title: `${entity.name}: latest verified news and connections`, description }),
    ...(worthIndexing(profile) ? {} : { robots: { index: false, follow: true } }),
  }
}

export default async function EntityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const id = entityIdFromSlug(slug)
  if (!id) notFound()
  const profile = await fetchProfile(id)
  if (profile === 'missing') notFound()
  if (profile === 'unavailable') throw new EntityUnavailableError()

  const { entity, activity, stories, latest, connections } = profile
  const path = entityPath(entity.id, entity.name)
  // One address per entity: an old or mistyped name redirects to the current one
  const expected = path.slice('/entities/'.length)
  if (slug !== expected && safeDecode(slug) !== safeDecode(expected)) permanentRedirect(path)

  const now = Date.now()
  const storyIds = new Set(stories.map(s => s.leadId))
  const moreReports = latest.filter(r => !storyIds.has(r.id)).slice(0, stories.length >= 5 ? 4 : 8)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${entity.name}: latest verified news and connections`,
    url: `${SITE_URL}${path}`,
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL },
    about: { '@type': schemaType(entity.type), name: entity.name },
    ...(stories.length > 0 ? {
      mainEntity: {
        '@type': 'ItemList',
        itemListElement: stories.slice(0, 10).map((s, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE_URL}/signals/${s.leadId}`, name: s.title })),
      },
    } : {}),
  }

  return (
    <main className="min-h-screen bg-wp-bg text-wp-text">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(jsonLd) }} />
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">

        <nav className="flex items-center gap-2 font-mono text-[11px] text-wp-text3 min-w-0" aria-label="Breadcrumb">
          <Link href="/" className="inline-flex items-center hover:text-wp-text transition-colors flex-shrink-0">Home</Link>
          <span className="flex-shrink-0">/</span>
          <Link href="/knowledge-graph" className="inline-flex items-center hover:text-wp-text transition-colors flex-shrink-0">Knowledge Graph</Link>
          <span className="flex-shrink-0">/</span>
          <span className="text-wp-text2 truncate">{entity.name}</span>
        </nav>

        <header className="space-y-2">
          <div className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">
            <span aria-hidden="true">{entityTypeIcon(entity.type)}</span> {entityTypeLabel(entity.type)}
          </div>
          <h1 className="text-[26px] sm:text-[32px] font-bold leading-tight text-wp-text [text-wrap:balance]">{entity.name}</h1>
          <p className="text-[15px] text-wp-text2 leading-relaxed">
            Named in <strong className="text-wp-text font-semibold">{plural(activity.last24h, 'report')}</strong> in the last 24 hours
            and <strong className="text-wp-text font-semibold">{activity.last7d.toLocaleString('en-US')}</strong> in the last 7 days,
            across the outlets WorldPulse follows.
          </p>
        </header>

        <section aria-labelledby="activity-heading" className="p-4 rounded-xl border border-white/[0.07] bg-wp-surface">
          <h2 id="activity-heading" className="font-mono text-[10px] tracking-widest uppercase text-wp-text3 mb-3">Reports per day · last 30 days</h2>
          <ActivityBars name={entity.name} daily={activity.daily} />
        </section>

        <section aria-labelledby="stories-heading" className="space-y-3">
          <h2 id="stories-heading" className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">
            Stories naming {entity.name} · last 14 days
          </h2>
          {stories.length === 0 ? (
            <p className="text-[13px] text-wp-text3">No story naming {entity.name} has been reported by two or more outlets in the last 14 days.</p>
          ) : (
            <ol className="space-y-2">
              {stories.map(s => (
                <li key={s.id}>
                  <Link href={`/signals/${s.leadId}`} className="block p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] transition-colors group">
                    <div className="flex items-center gap-2 mb-1 font-mono text-[10px] text-wp-text3 flex-wrap">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: SEV_COLOR[s.severity] ?? '#8892a4' }} aria-hidden="true" />
                      <span className="uppercase tracking-wider" style={{ color: SEV_COLOR[s.severity] ?? '#8892a4' }}>{s.severity}</span>
                      {s.verifiedAt
                        ? <span className="text-wp-green">✓ Verified · {s.outletCount} outlets</span>
                        : <span>{s.outletCount} outlets</span>}
                      {s.place && <span>· {s.place}</span>}
                      <span>· {ago(s.updatedAt, now)}</span>
                    </div>
                    <p className="text-[14px] text-wp-text group-hover:text-white leading-snug">{s.title}</p>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>

        {moreReports.length > 0 && (
          <section aria-labelledby="latest-heading" className="space-y-3">
            <h2 id="latest-heading" className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">Newest reports</h2>
            <ul className="divide-y divide-white/[0.05] rounded-xl border border-white/[0.06] bg-white/[0.02]">
              {moreReports.map(r => (
                <li key={r.id}>
                  <Link href={`/signals/${r.id}`} className="flex items-start gap-3 p-3 hover:bg-white/[0.04] transition-colors">
                    <span className="font-mono text-[10px] text-wp-text3 w-14 flex-shrink-0 pt-0.5 tabular-nums">{ago(r.createdAt, now)}</span>
                    <span className="text-[13px] text-wp-text2 leading-snug min-w-0">
                      {r.title}
                      {r.verified && <span className="ml-2 font-mono text-[10px] text-wp-green">✓ verified</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {connections.length > 0 && (
          <section aria-labelledby="connections-heading" className="space-y-3">
            <h2 id="connections-heading" className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">
              Named together with {entity.name} · last 30 days
            </h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {connections.map(c => (
                <li key={c.id} className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={entityPath(c.id, c.name)} className="inline-flex items-center min-w-0 text-[14px] font-medium text-wp-text hover:text-wp-amber transition-colors">
                      <span aria-hidden="true" className="mr-1 flex-shrink-0">{entityTypeIcon(c.type)}</span>
                      <span className="truncate">{c.name}</span>
                    </Link>
                    <span className="font-mono text-[10px] text-wp-text3 flex-shrink-0 tabular-nums">{plural(c.shared, 'report')}</span>
                  </div>
                  <ConnectionWhy entityId={entity.id} otherId={c.id} names={[entity.name, c.name]} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-col sm:flex-row gap-3">
          <Link
            href={`/knowledge-graph?entity=${encodeURIComponent(entity.id)}`}
            className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl border border-white/10 text-[13px] text-wp-text2 hover:text-wp-text hover:border-white/20 transition-colors"
          >
            See {entity.name} in the knowledge graph →
          </Link>
        </section>

        <BriefingSignup source="/entities" compact />
      </div>
    </main>
  )
}
