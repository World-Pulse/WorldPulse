import Link from 'next/link'
import type { Metadata } from 'next'
import { SITE_NAME, SITE_URL, jsonLdText, metaDescription } from '@/lib/page-metadata'
import { entityPath, entityTypeIcon } from '@/lib/entity-links'
import { fetchDirectory, weekRange, type DirectoryEntity, type EntityDirectory } from '@/lib/entity-directory'
import { BriefingSignup } from '@/components/briefing/BriefingSignup'
import { ShareMenu } from '@/components/signals/ShareMenu'
import { cachedFetch } from '@/lib/server-fetch'

/**
 * world-pulse.io/entities: who's in the news (Oct 13, 2026). The people,
 * places and organizations named in the most reports in the last 7 days,
 * each opening its own page (entities/[slug]), with the ones rising in the
 * last 24 hours on top. The index of the knowledge graph's pages, for
 * readers and for search engines. Data: GET /api/v1/knowledge-graph/directory
 * and /trending.
 */

const API_BASE = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface Rising {
  entity: { id: string; type: string; canonical_name: string }
  recent_mentions: number
  spike_ratio: number | null
  is_new?: boolean
}

class DirectoryUnavailableError extends Error {
  constructor() {
    super('The directory could not be loaded: the API did not answer')
    this.name = 'DirectoryUnavailableError'
  }
}

async function fetchRising(): Promise<Rising[]> {
  try {
    const res = await cachedFetch(`${API_BASE}/api/v1/knowledge-graph/trending?limit=10&window_hours=24&lean=1`, 120_000, 8_000)
    if (!res.ok) return []
    const json = await res.json() as { trending?: Rising[] }
    return (json.trending ?? []).filter(t => t.entity?.id && t.entity.canonical_name)
  } catch {
    return []
  }
}

const count = (n: number) => n.toLocaleString('en-US')
/** Entities shown per group before "Show N more": the cards stay even side by side */
const SHOWN = 12

function topNames(d: EntityDirectory): string[] {
  return d.groups.filter(g => g.key !== 'more').flatMap(g => g.entities.slice(0, 2).map(e => e.name))
}

export async function generateMetadata(): Promise<Metadata> {
  const directory = await fetchDirectory()
  const names = directory ? topNames(directory) : []
  const title = "Who's in the news this week"
  const description = metaDescription(
    'The people, places and organizations named in the most reports in the last 7 days'
    + (names.length ? `: ${names.slice(0, 5).join(', ')} and more` : '')
    + '. Each has its own page: the stories naming it, its activity and who it is named with.',
  )
  // The picture is the page's own card (opengraph-image.tsx and twitter-image.tsx)
  return {
    title: `${title} — ${SITE_NAME}`,
    description,
    alternates: { canonical: '/entities' },
    openGraph: { title, description, type: 'website', url: '/entities', siteName: SITE_NAME },
    twitter: { card: 'summary_large_image', title, description },
  }
}

function EntityRow({ e, rank, max }: { e: DirectoryEntity; rank: number; max: number }) {
  const rising = e.change != null && e.change >= 1.5
  return (
    <li className="min-w-0">
      <Link
        href={entityPath(e.id, e.name)}
        className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.04] transition-colors"
      >
        <span className="w-6 flex-shrink-0 text-right font-mono text-[11px] text-wp-text3 tabular-nums">{rank}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 min-w-0">
            <span aria-hidden="true" className="flex-shrink-0 text-[12px]">{entityTypeIcon(e.type)}</span>
            <span className="truncate text-[14px] font-medium text-wp-text group-hover:text-wp-amber transition-colors">{e.name}</span>
          </span>
          <span className="mt-1 block h-1 rounded-full bg-white/[0.06] overflow-hidden" aria-hidden="true">
            <span className="block h-full rounded-full bg-wp-amber/70" style={{ width: `${Math.max(3, Math.round((e.last7d / max) * 100))}%` }} />
          </span>
        </span>
        <span className="flex-shrink-0 text-right font-mono tabular-nums">
          <span className="block text-[12px] text-wp-text2">{count(e.last7d)}</span>
          <span className="block text-[10px] text-wp-text3">
            {rising ? <span className="text-wp-red">↑{e.change!.toFixed(1)}×</span> : `${count(e.last24h)} today`}
          </span>
        </span>
      </Link>
    </li>
  )
}

export default async function EntitiesPage() {
  const [directory, rising] = await Promise.all([fetchDirectory(), fetchRising()])
  if (!directory) throw new DirectoryUnavailableError()

  const groups = directory.groups.filter(g => g.entities.length > 0)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: "Who's in the news this week",
    url: `${SITE_URL}/entities`,
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL },
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: groups
        .filter(g => g.key !== 'more')
        .flatMap(g => g.entities.slice(0, 10))
        .map((e, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE_URL}${entityPath(e.id, e.name)}`, name: e.name })),
    },
  }

  return (
    <main className="min-h-screen bg-wp-bg text-wp-text">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(jsonLd) }} />
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

        <nav className="flex items-center gap-2 font-mono text-[11px] text-wp-text3 min-w-0" aria-label="Breadcrumb">
          <Link href="/" className="inline-flex items-center hover:text-wp-text transition-colors flex-shrink-0">Home</Link>
          <span className="flex-shrink-0">/</span>
          <span className="text-wp-text2 truncate">In the news</span>
        </nav>

        <header className="space-y-2 max-w-3xl">
          <div className="flex items-center justify-between gap-3">
            <div className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">
              Knowledge graph · {weekRange(directory.generatedAt)}
            </div>
            <ShareMenu title="Who was in the news this week, counted across the outlets WorldPulse follows" campaign="entities" label="Share this list" />
          </div>
          <h1 className="text-[26px] sm:text-[32px] font-bold leading-tight text-wp-text [text-wrap:balance]">Who&apos;s in the news</h1>
          <p className="text-[15px] text-wp-text2 leading-relaxed">
            The people, places and organizations named in the most reports in the last 7 days, across the outlets
            WorldPulse follows: <strong className="text-wp-text font-semibold">{count(directory.total)}</strong> of them this week.
            Each has its own page with the stories naming it, its activity, and who it&apos;s named with.
          </p>
        </header>

        {rising.length > 0 && (
          <section aria-labelledby="rising-heading" className="space-y-3">
            <h2 id="rising-heading" className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">Trending · last 24 hours</h2>
            <ul className="flex gap-2 overflow-x-auto pb-1 scrollbar-none sm:flex-wrap sm:overflow-visible">
              {rising.map(t => (
                <li key={t.entity.id} className="flex-shrink-0">
                  <Link
                    href={entityPath(t.entity.id, t.entity.canonical_name)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.03] text-[13px] text-wp-text2 hover:text-wp-text hover:border-wp-amber/40 transition-colors"
                    title={`${count(t.recent_mentions)} reports in the last 24 hours`}
                  >
                    <span aria-hidden="true">{entityTypeIcon(t.entity.type)}</span>
                    <span className="whitespace-nowrap">{t.entity.canonical_name}</span>
                    {t.is_new
                      ? <span className="font-mono text-[10px] text-wp-amber">NEW</span>
                      : t.spike_ratio != null && t.spike_ratio >= 1.5
                        ? <span className="font-mono text-[10px] text-wp-red">↑{t.spike_ratio.toFixed(1)}×</span>
                        : <span className="font-mono text-[10px] text-wp-text3 tabular-nums">{count(t.recent_mentions)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {groups.length === 0 ? (
          <p className="text-[14px] text-wp-text3">No one has been named in three or more reports in the last 7 days yet.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {groups.map(g => {
              const max = Math.max(1, ...g.entities.map(e => e.last7d))
              const rest = g.entities.slice(SHOWN)
              return (
                <section key={g.key} aria-labelledby={`group-${g.key}`} className="rounded-xl border border-white/[0.07] bg-wp-surface p-2 min-w-0">
                  <div className="flex items-baseline justify-between gap-3 px-3 pt-2 pb-1">
                    <h2 id={`group-${g.key}`} className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">{g.label}</h2>
                    <span className="font-mono text-[10px] text-wp-text3 flex-shrink-0">reports · 7 days</span>
                  </div>
                  <ol>
                    {g.entities.slice(0, SHOWN).map((e, i) => <EntityRow key={e.id} e={e} rank={i + 1} max={max} />)}
                  </ol>
                  {rest.length > 0 && (
                    <details className="group">
                      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer px-3 py-2.5 font-mono text-[11px] text-wp-text3 hover:text-wp-amber transition-colors group-open:hidden">
                        Show {rest.length} more
                      </summary>
                      <ol start={SHOWN + 1}>
                        {rest.map((e, i) => <EntityRow key={e.id} e={e} rank={SHOWN + i + 1} max={max} />)}
                      </ol>
                    </details>
                  )}
                </section>
              )
            })}
          </div>
        )}

        <section className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/knowledge-graph"
            className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl border border-white/10 text-[13px] text-wp-text2 hover:text-wp-text hover:border-white/20 transition-colors"
          >
            See how they connect in the knowledge graph →
          </Link>
        </section>

        <BriefingSignup source="/entities" compact />
      </div>
    </main>
  )
}
