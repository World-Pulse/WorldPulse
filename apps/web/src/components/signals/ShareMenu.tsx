'use client'

/**
 * The story page's Share button (plan G3): X, LinkedIn, Telegram, Bluesky,
 * WhatsApp, the phone's own share sheet where there is one, and Copy link.
 * It used to copy the address only. Also on entity pages and /entities
 * (Oct 13, 2026), with their own utm campaign. On a story's page only, it
 * also offers "Embed this card" (plan G20): the code for the story's
 * "Verified · N outlets" card, light or dark, with a preview.
 */

import { useEffect, useRef, useState } from 'react'
import { shareLinks, withUtm } from '@/lib/share-links'
import { CARD_HEIGHT, cardUrl, storyEmbedCode, type CardTheme } from '@/lib/embed-card'

export function ShareMenu({ title, campaign = 'story', label = 'Share this story', embedId }: {
  title: string
  campaign?: string
  label?: string
  /** A story page's report id: adds "Embed this card" */
  embedId?: string
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [embedding, setEmbedding] = useState(false)
  const [theme, setTheme] = useState<CardTheme>('light')
  const [codeCopied, setCodeCopied] = useState(false)
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

  const embedCode = () => (embedId ? storyEmbedCode(window.location.origin, embedId, title, theme) : '')

  async function copyCode() {
    const code = embedCode()
    try {
      await navigator.clipboard.writeText(code)
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 2000)
    } catch { /* the code stays selectable in the box */ }
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
        onClick={() => { setEmbedding(false); setCodeCopied(false); setOpen(o => !o) }}
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
      {open && embedding && embedId && (
        <EmbedCardPanel
          code={embedCode()}
          previewSrc={cardUrl(window.location.origin, embedId, theme)}
          theme={theme}
          copied={codeCopied}
          onTheme={t => { setTheme(t); setCodeCopied(false) }}
          onCopy={copyCode}
        />
      )}
      {open && !embedding && (
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
          {embedId && (
            <button role="menuitem" onClick={() => setEmbedding(true)} className={item}>Embed this card</button>
          )}
        </div>
      )}
    </div>
  )
}

/** "Embed this card" (plan G20): light or dark, a preview, the code and a copy button */
export function EmbedCardPanel({ code, previewSrc, theme, copied, onTheme, onCopy }: {
  code: string
  previewSrc: string
  theme: CardTheme
  copied: boolean
  onTheme: (theme: CardTheme) => void
  onCopy: () => void
}) {
  return (
    <div role="dialog" aria-label="Embed this card" className="absolute right-0 top-full mt-2 z-40 w-[320px] max-w-[calc(100vw-24px)] p-3 rounded-xl border border-white/10 bg-wp-s2 shadow-2xl">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[10px] text-wp-text3 tracking-widest">EMBED THIS CARD</span>
        <span className="flex gap-1" role="group" aria-label="Card colours">
          {(['light', 'dark'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => onTheme(t)}
              aria-pressed={theme === t}
              className={`px-2 py-1 rounded-md font-mono text-[10px] border ${theme === t ? 'border-wp-amber text-wp-amber' : 'border-white/10 text-wp-text3 hover:text-wp-text2'}`}
            >
              {t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </span>
      </div>
      <iframe
        key={previewSrc}
        src={previewSrc}
        title="Preview of the card"
        height={CARD_HEIGHT}
        loading="lazy"
        className="w-full rounded-xl border-0 bg-transparent"
      />
      <textarea
        readOnly
        value={code}
        rows={4}
        aria-label="Embed code"
        onFocus={e => e.currentTarget.select()}
        className="mt-2 w-full resize-none rounded-lg bg-black/40 border border-white/10 p-2 font-mono text-[10px] text-wp-text2"
      />
      <button
        type="button"
        onClick={onCopy}
        className="mt-2 w-full rounded-lg border border-white/12 px-3 py-1.5 font-mono text-[11px] text-wp-text2 hover:text-white min-h-[36px]"
      >
        {copied ? 'Copied!' : 'Copy code'}
      </button>
      <p className="mt-2 text-[10px] text-wp-text3 leading-relaxed">Paste it into a page: it shows this story&apos;s outlet count, kept up to date, and links back here.</p>
    </div>
  )
}
