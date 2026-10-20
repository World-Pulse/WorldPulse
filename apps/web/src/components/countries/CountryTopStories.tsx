import Link from 'next/link'

// A country's top stories with how many outlets carry each (plan 14, Oct 20,
// 2026): the stories with a report placed in the country in the last 3 days,
// ranked as the home page ranks them. Fetched by the server page and drawn
// in the page's first HTML, so readers and search engines see them at once.
// (No hooks and no times, so the server's HTML and the browser's match.)

export interface CountryStory {
  id: string
  leadId: string
  title: string
  place: string | null
  category: string | null
  severity: string
  outletCount: number
  verifiedAt: string | null
}

const SEV_COLOR: Record<string, string> = {
  critical: '#ff3b5c', high: '#f5a623', medium: '#fbbf24', low: '#8892a4', info: '#5a6477',
}

/** "✓ Verified · 12 outlets", or "3 outlets" while not verified */
export function outletLine(s: Pick<CountryStory, 'outletCount' | 'verifiedAt'>): string {
  const outlets = `${s.outletCount} ${s.outletCount === 1 ? 'outlet' : 'outlets'}`
  return s.verifiedAt ? `✓ Verified · ${outlets}` : outlets
}

export function CountryTopStories({ name, stories }: { name: string | null; stories: CountryStory[] }) {
  if (stories.length === 0) return null
  return (
    <section aria-labelledby="top-stories-heading" className="space-y-3">
      <h2 id="top-stories-heading" className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">
        Top stories{name ? ` · ${name}` : ''} · last 3 days
      </h2>
      <ol className="space-y-2">
        {stories.map(s => (
          <li key={s.id}>
            <Link href={`/signals/${s.leadId}`} className="block p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] transition-colors group no-underline">
              <div className="flex items-center gap-2 mb-1 font-mono text-[10px] text-wp-text3 flex-wrap">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: SEV_COLOR[s.severity] ?? '#8892a4' }} aria-hidden="true" />
                <span className="uppercase tracking-wider" style={{ color: SEV_COLOR[s.severity] ?? '#8892a4' }}>{s.severity}</span>
                <span className={s.verifiedAt ? 'text-wp-green' : ''}>{outletLine(s)}</span>
                {s.place && <span>· {s.place}</span>}
              </div>
              <p className="text-[14px] text-wp-text group-hover:text-white leading-snug">{s.title}</p>
            </Link>
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-wp-text3">
        Ranked by how many outlets report each story. <Link href="/how-we-count" className="text-wp-amber underline">How we count outlets</Link>
      </p>
    </section>
  )
}
