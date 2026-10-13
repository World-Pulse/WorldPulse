'use client'

/**
 * "Why?" under a connection on an entity page: the stories naming both
 * entities (GET /api/v1/knowledge-graph/entities/:id/with/:other), loaded when
 * asked. If they can't load, it says so in a line and offers to try again.
 */

import { useState } from 'react'
import Link from 'next/link'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.world-pulse.io'

interface Shared {
  stories: Array<{ id: string; leadId: string; title: string; outletCount: number; verifiedAt: string | null }>
  latest: Array<{ id: string; title: string; verified: boolean }>
}

export function ConnectionWhy({ entityId, otherId, names }: { entityId: string; otherId: string; names: [string, string] }) {
  const [state, setState] = useState<'closed' | 'loading' | 'open' | 'error'>('closed')
  const [shared, setShared] = useState<Shared | null>(null)

  async function open() {
    if (state === 'open') { setState('closed'); return }
    if (shared) { setState('open'); return }
    setState('loading')
    try {
      const res = await fetch(`${API_URL}/api/v1/knowledge-graph/entities/${encodeURIComponent(entityId)}/with/${encodeURIComponent(otherId)}`)
      const json = await res.json() as { success?: boolean; data?: Shared }
      if (!res.ok || !json.success || !json.data) throw new Error(`HTTP ${res.status}`)
      setShared(json.data)
      setState('open')
    } catch {
      setState('error')
    }
  }

  const items = shared
    ? [
        ...shared.stories.map(s => ({ id: s.leadId, title: s.title, note: s.verifiedAt ? `✓ ${s.outletCount} outlets` : `${s.outletCount} outlets` })),
        ...shared.latest.filter(l => !shared.stories.some(s => s.leadId === l.id)).map(l => ({ id: l.id, title: l.title, note: l.verified ? '✓ verified' : '' })),
      ].slice(0, 4)
    : []

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => { void open() }}
        aria-expanded={state === 'open'}
        className="inline-flex items-center font-mono text-[10px] text-wp-text3 hover:text-wp-amber transition-colors"
      >
        {state === 'open' ? 'Hide' : state === 'loading' ? 'Loading…' : `Why? Stories naming both`}
      </button>
      {state === 'error' && (
        <p className="mt-1 text-[11px] text-wp-text3">
          Couldn&apos;t load them just now.{' '}
          <button type="button" onClick={() => { void open() }} className="underline hover:text-wp-text2">Try again</button>
        </p>
      )}
      {state === 'open' && (
        items.length === 0
          ? <p className="mt-1 text-[11px] text-wp-text3">No recent story names both {names[0]} and {names[1]}.</p>
          : (
            <ul className="mt-1.5 space-y-1">
              {items.map(it => (
                <li key={it.id} className="text-[12px] leading-snug">
                  <Link href={`/signals/${it.id}`} className="text-wp-text2 hover:text-wp-text transition-colors">{it.title}</Link>
                  {it.note && <span className="ml-1.5 font-mono text-[10px] text-wp-green">{it.note}</span>}
                </li>
              ))}
            </ul>
          )
      )}
    </div>
  )
}
