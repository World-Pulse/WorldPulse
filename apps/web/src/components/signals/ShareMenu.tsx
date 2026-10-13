'use client'

/**
 * The story page's Share button (plan G3): X, LinkedIn, Telegram, Bluesky,
 * WhatsApp, the phone's own share sheet where there is one, and Copy link.
 * It used to copy the address only. Also on entity pages and /entities
 * (Oct 13, 2026), with their own utm campaign.
 */

import { useEffect, useRef, useState } from 'react'
import { shareLinks, withUtm } from '@/lib/share-links'

export function ShareMenu({ title, campaign = 'story', label = 'Share this story' }: { title: string; campaign?: string; label?: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [canNativeShare, setCanNativeShare] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => { setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function') }, [])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const pageUrl = () => window.location.origin + window.location.pathname

  async function copy() {
    const url = pageUrl()
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const input = document.createElement('input')
      input.value = url
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
    }
    setCopied(true)
    setTimeout(() => { setCopied(false); setOpen(false) }, 1500)
  }

  async function nativeShare() {
    try {
      await navigator.share({ title, url: withUtm(pageUrl(), 'device', campaign) })
      setOpen(false)
    } catch { /* closed without sharing */ }
  }

  const item = 'flex items-center w-full px-3 py-2.5 rounded-lg font-mono text-[11px] text-wp-text2 hover:bg-white/5 hover:text-wp-text transition-colors min-h-[40px] text-left'

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-full border border-white/10 font-mono text-[10px] text-wp-text3 hover:border-white/20 hover:text-wp-text2 transition-all min-h-[44px]"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        Share
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-2 z-40 w-48 p-1.5 rounded-xl border border-white/10 bg-wp-s2 shadow-2xl">
          {shareLinks(pageUrl(), title, campaign).map(l => (
            <a key={l.network} role="menuitem" href={l.href} target="_blank" rel="noopener noreferrer" className={item} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
          {canNativeShare && (
            <button role="menuitem" onClick={nativeShare} className={item}>More…</button>
          )}
          <button role="menuitem" onClick={copy} className={item}>
            {copied ? <span style={{ color: '#00e676' }}>Link copied</span> : 'Copy link'}
          </button>
        </div>
      )}
    </div>
  )
}
