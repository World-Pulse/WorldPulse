'use client'

/**
 * "Also names…" in the World Map's signal panel (plan C9): other recent
 * stories that name the same people, places or organisations as the open
 * one (GET /signals/:id/connections, the story page's Intelligence web).
 * A story that is on the map opens in place and the globe flies to it;
 * any other opens its own page.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SEVERITY_COLOR } from '@/lib/map-style'

interface Connection {
  id: string
  title: string
  severity: string
  connectedVia: string[]
}

const LIMIT = 4

/** The API's connections, reduced to what the panel shows; anything malformed is dropped */
export function readConnections(json: unknown): Connection[] {
  const list = (json as { data?: { connections?: unknown } } | null)?.data?.connections
  if (!Array.isArray(list)) return []
  const out: Connection[] = []
  for (const c of list) {
    const id = typeof c?.id === 'string' ? c.id : ''
    const title = typeof c?.title === 'string' ? c.title.trim() : ''
    if (!id || !title) continue
    const via = Array.isArray(c.connectedVia)
      ? c.connectedVia.map((e: { name?: unknown }) => (typeof e?.name === 'string' ? e.name : '')).filter(Boolean).slice(0, 2)
      : []
    out.push({ id, title, severity: typeof c.severity === 'string' ? c.severity : 'info', connectedVia: via })
    if (out.length === LIMIT) break
  }
  return out
}

export function SignalConnections({
  signalId, apiUrl, onMap, onOpen,
}: {
  signalId: string
  apiUrl: string
  /** Whether a story is among the map's loaded signals */
  onMap: (id: string) => boolean
  onOpen: (id: string) => void
}) {
  const [items, setItems] = useState<Connection[]>([])

  useEffect(() => {
    setItems([])
    const ctrl = new AbortController()
    fetch(`${apiUrl}/api/v1/signals/${encodeURIComponent(signalId)}/connections?limit=${LIMIT * 2}`, { signal: ctrl.signal })
      .then(r => (r.ok ? r.json() : null))
      .then(json => setItems(readConnections(json)))
      .catch(() => { /* the panel simply has no list */ })
    return () => ctrl.abort()
  }, [signalId, apiUrl])

  if (items.length === 0) return null
  return (
    <div>
      <div className="font-mono text-[10px] tracking-[1.5px] uppercase text-wp-text3 mb-2">Also names the same people and places</div>
      <ul className="space-y-1.5">
        {items.map(c => {
          const body = (
            <>
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: SEVERITY_COLOR[c.severity] ?? '#8892a4' }} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-[12px] text-wp-text2 leading-snug">{c.title}</span>
                {c.connectedVia.length > 0 && (
                  <span className="block font-mono text-[10px] text-wp-text3">via {c.connectedVia.join(', ')}</span>
                )}
              </span>
            </>
          )
          const cls = 'flex gap-2 w-full text-left rounded-lg px-2 py-1.5 hover:bg-[rgba(255,255,255,0.05)] transition-colors'
          return (
            <li key={c.id}>
              {onMap(c.id)
                ? <button type="button" onClick={() => onOpen(c.id)} className={cls}>{body}</button>
                : <Link href={`/signals/${encodeURIComponent(c.id)}`} className={cls}>{body}</Link>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
