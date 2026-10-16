'use client'

/**
 * SavedViews.tsx — plan C10 (v1)
 * A bookmark button in the map's controls: save the current view under a name
 * and open it again in one click. Kept in this browser only (localStorage).
 */

import { useEffect, useState } from 'react'
import { Bookmark, X } from 'lucide-react'
import {
  readSavedViews, writeSavedViews, addSavedView, removeSavedView, MAX_NAME_LENGTH, type SavedView,
} from '@/lib/map-saved-views'

export function SavedViews() {
  const [open, setOpen] = useState(false)
  const [views, setViews] = useState<SavedView[]>([])
  const [name, setName] = useState('')

  useEffect(() => { setViews(readSavedViews(window.localStorage)) }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('[data-saved-views]')) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown) }
  }, [open])

  const save = () => {
    // The address bar holds the filters (query) and the view and layers (#hash)
    const next = addSavedView(views, name, window.location.pathname + window.location.search + window.location.hash)
    if (!next) return
    setViews(next)
    writeSavedViews(window.localStorage, next)
    setName('')
  }

  const remove = (id: string) => {
    const next = removeSavedView(views, id)
    setViews(next)
    writeSavedViews(window.localStorage, next)
  }

  const openView = (href: string) => {
    const here = window.location.pathname + window.location.search
    // A change of #hash alone doesn't reload the page, so reload to apply it
    const sameFilters = href.split('#')[0] === here
    window.location.assign(href)
    if (sameFilters) window.location.reload()
  }

  return (
    <div className="relative" data-saved-views>
      <button
        onClick={() => setOpen(v => !v)}
        title="Saved views"
        aria-label="Saved views"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`wp-map-ctrl ${open ? 'wp-map-ctrl-on' : ''}`}
      >
        <Bookmark size={15} />
      </button>
      {open && (
        <div role="menu" aria-label="Saved views"
          className="absolute right-[40px] top-0 w-[240px] rounded-xl border border-white/10 bg-[rgba(8,11,20,0.94)] backdrop-blur-md shadow-2xl py-1.5">
          <div className="px-3 pt-1 pb-1.5 text-[10px] font-mono uppercase tracking-[1.2px] text-wp-text3">Saved views</div>
          {views.length === 0 && (
            <div className="px-3 pb-2 text-[12px] text-wp-text3">Nothing saved yet. Set the map up the way you like it, name it below and save.</div>
          )}
          {views.map(v => (
            <div key={v.id} className="flex items-center hover:bg-white/[0.06] focus-within:bg-white/[0.06]">
              <button role="menuitem" onClick={() => openView(v.href)}
                className="flex-1 min-w-0 truncate text-left px-3 py-2 text-[13px] text-wp-text focus:outline-none">
                {v.name}
              </button>
              <button onClick={() => remove(v.id)} aria-label={`Remove ${v.name}`} title="Remove"
                className="px-2.5 py-2 text-wp-text3 hover:text-wp-text focus:outline-none focus:text-wp-text">
                <X size={13} />
              </button>
            </div>
          ))}
          <form className="flex gap-1.5 px-3 pt-2 mt-1 border-t border-white/10" onSubmit={e => { e.preventDefault(); save() }}>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={MAX_NAME_LENGTH}
              placeholder="Name this view"
              aria-label="Name for this view"
              className="flex-1 min-w-0 rounded-md bg-white/[0.06] border border-white/10 px-2 py-1 text-[12px] text-wp-text placeholder:text-wp-text3 focus:outline-none focus:border-white/30"
            />
            <button type="submit" disabled={!name.trim()}
              className="rounded-md px-2.5 py-1 text-[12px] bg-white/[0.1] text-wp-text hover:bg-white/[0.16] disabled:opacity-40">
              Save
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
