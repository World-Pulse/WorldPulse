'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface AutocompleteSignal {
  id: string
  title: string
  category: string
}

interface AutocompleteUser {
  id: string
  handle: string
  displayName: string
  verified?: boolean
}

interface AutocompleteData {
  signals: AutocompleteSignal[]
  users: AutocompleteUser[]
  tags: string[]
}

type PaletteItem =
  | { kind: 'signal'; id: string; title: string; category: string }
  | { kind: 'user';   id: string; handle: string; displayName: string; verified?: boolean }
  | { kind: 'tag';    tag: string }
  | { kind: 'search'; query: string }

function buildItems(query: string, ac: AutocompleteData | null): PaletteItem[] {
  const items: PaletteItem[] = []
  if (ac) {
    for (const s of ac.signals) items.push({ kind: 'signal', ...s })
    for (const u of ac.users)   items.push({ kind: 'user', ...u })
    for (const t of ac.tags)    items.push({ kind: 'tag', tag: t })
  }
  if (query.trim().length >= 2) {
    items.push({ kind: 'search', query: query.trim() })
  }
  return items
}

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen]         = useState(false)
  const [query, setQuery]       = useState('')
  const [ac, setAc]             = useState<AutocompleteData | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef  = useRef<HTMLInputElement>(null)
  const listRef   = useRef<HTMLDivElement>(null)

  // Open on Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(v => !v)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setAc(null)
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  // 150ms debounced autocomplete
  const fetchAc = useCallback(async (q: string) => {
    if (q.length < 2) { setAc(null); return }
    try {
      const res  = await fetch(`${API_URL}/api/v1/search/autocomplete?q=${encodeURIComponent(q)}`)
      const data = await res.json() as { success: boolean; data: AutocompleteData }
      if (data.success) setAc(data.data)
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => fetchAc(query), 150)
    return () => clearTimeout(t)
  }, [query, fetchAc])

  const items = buildItems(query, ac)

  // Reset active index when items change
  useEffect(() => { setActiveIdx(0) }, [items.length])

  const execute = useCallback((item: PaletteItem) => {
    setOpen(false)
    switch (item.kind) {
      case 'signal': router.push(`/signals/${item.id}`); break
      case 'user':   router.push(`/@${item.handle}`); break
      case 'tag':    router.push(`/search?q=${encodeURIComponent(item.tag)}&type=tags`); break
      case 'search': router.push(`/search?q=${encodeURIComponent(item.query)}`); break
    }
  }, [router])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      const item = items[activeIdx]
      if (item) execute(item)
      else if (query.trim().length >= 2) {
        setOpen(false)
        router.push(`/search?q=${encodeURIComponent(query.trim())}`)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const active = list.querySelector('[data-active="true"]') as HTMLElement | null
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />

      {/* Panel */}
      <div
        className="relative w-full max-w-xl mx-4 bg-wp-s2 border border-[rgba(255,255,255,0.12)] rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        {/* Input row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[rgba(255,255,255,0.07)]">
          <span className="text-wp-text3 text-[16px]" aria-hidden="true">⌘</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value) }}
            onKeyDown={handleKeyDown}
            placeholder="Search signals, people, tags…"
            className="flex-1 bg-transparent border-none outline-none text-wp-text text-[15px] placeholder-wp-text3 caret-wp-amber"
            aria-label="Command palette search"
            aria-autocomplete="list"
            aria-activedescendant={items[activeIdx] ? `cp-item-${activeIdx}` : undefined}
            role="combobox"
            aria-expanded={items.length > 0}
          />
          <kbd className="font-mono text-[10px] text-wp-text3 border border-[rgba(255,255,255,0.1)] rounded px-1.5 py-0.5">
            ESC
          </kbd>
        </div>

        {/* Results list */}
        {items.length > 0 && (
          <div
            ref={listRef}
            role="listbox"
            className="max-h-[360px] overflow-y-auto py-1"
          >
            {items.map((item, idx) => {
              const active = idx === activeIdx
              const base = `flex items-center gap-3 px-4 py-[10px] cursor-pointer transition-colors text-[13px]
                ${active ? 'bg-[rgba(245,166,35,0.12)] text-wp-text' : 'text-wp-text2 hover:bg-wp-s3'}`
              const id = `cp-item-${idx}`

              if (item.kind === 'signal') return (
                <div
                  key={id} id={id} role="option" aria-selected={active}
                  data-active={active}
                  className={base}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => execute(item)}
                >
                  <span className="text-[14px] flex-shrink-0" aria-hidden="true">📡</span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{item.title}</div>
                  </div>
                  <span className="font-mono text-[10px] text-wp-text3 uppercase flex-shrink-0">{item.category}</span>
                </div>
              )

              if (item.kind === 'user') return (
                <div
                  key={id} id={id} role="option" aria-selected={active}
                  data-active={active}
                  className={base}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => execute(item)}
                >
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-wp-amber to-orange-600 flex items-center justify-center font-bold text-[11px] text-black flex-shrink-0">
                    {item.handle.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{item.displayName}</span>
                    {item.verified && <span className="text-wp-cyan ml-1 text-[11px]">✓</span>}
                  </div>
                  <span className="font-mono text-[11px] text-wp-text3 flex-shrink-0">@{item.handle}</span>
                </div>
              )

              if (item.kind === 'tag') return (
                <div
                  key={id} id={id} role="option" aria-selected={active}
                  data-active={active}
                  className={base}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => execute(item)}
                >
                  <span className="font-mono text-wp-amber font-bold text-[14px] flex-shrink-0">#</span>
                  <span>{item.tag}</span>
                </div>
              )

              // kind === 'search'
              return (
                <div
                  key={id} id={id} role="option" aria-selected={active}
                  data-active={active}
                  className={`${base} border-t border-[rgba(255,255,255,0.05)]`}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => execute(item)}
                >
                  <span className="text-[14px] flex-shrink-0" aria-hidden="true">🔍</span>
                  <span>Search for <strong className="text-wp-amber">&ldquo;{item.query}&rdquo;</strong></span>
                </div>
              )
            })}
          </div>
        )}

        {/* Empty / hint */}
        {items.length === 0 && (
          <div className="px-4 py-6 text-center text-[13px] text-wp-text3">
            {query.length < 2
              ? 'Type to search signals, people, and tags'
              : `No results for "${query}"`}
          </div>
        )}

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-[rgba(255,255,255,0.05)] font-mono text-[10px] text-wp-text3">
          <span><kbd className="border border-[rgba(255,255,255,0.1)] rounded px-1">↑↓</kbd> navigate</span>
          <span><kbd className="border border-[rgba(255,255,255,0.1)] rounded px-1">↵</kbd> select</span>
          <span><kbd className="border border-[rgba(255,255,255,0.1)] rounded px-1">ESC</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
