'use client'

/**
 * ShareButton.tsx — BAT-15
 * Floating share button (bottom-right of map).
 * - Click → copy permalink to clipboard + toast
 * - Expanded menu: Twitter, Reddit, copy link, QR code
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { buildShareUrl, type MapPermalinkState } from '@/lib/map-permalink'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShareButtonProps {
  /** Current map state to encode into the permalink. */
  getState: () => MapPermalinkState
  /** Optional: position override. Defaults to bottom-right. */
  className?: string
}

// ─── QR Code generator (inline, no external canvas dep at runtime) ────────────

/**
 * Generates a minimal QR-code SVG using the `qrcode` npm package loaded
 * dynamically on the client. Falls back to a placeholder if the module
 * is not yet loaded.
 */
async function generateQrSvg(url: string): Promise<string> {
  try {
    const QRCode = await import('qrcode')
    return await QRCode.toString(url, {
      type: 'svg',
      margin: 1,
      color: { dark: '#e2e8f0', light: '#06070d' },
      width: 200,
    })
  } catch {
    // Fallback: plain SVG placeholder
    return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
      <rect width="200" height="200" fill="#06070d"/>
      <text x="100" y="105" text-anchor="middle" font-size="12" fill="#8892a4">QR unavailable</text>
    </svg>`
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ShareButton({ getState, className = '' }: ShareButtonProps) {
  const [open,     setOpen]     = useState(false)
  const [copied,   setCopied]   = useState(false)
  const [qrSvg,    setQrSvg]    = useState<string | null>(null)
  const [qrOpen,   setQrOpen]   = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu when clicking outside
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const buildUrl = useCallback(() => {
    const state = getState()
    return buildShareUrl(state)
  }, [getState])

  const handleMainClick = useCallback(async () => {
    const url = buildUrl()
    setShareUrl(url)
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard denied — fall through to show menu
    }
    setOpen(v => !v)
  }, [buildUrl])

  const handleCopyLink = useCallback(async () => {
    const url = shareUrl || buildUrl()
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }, [shareUrl, buildUrl])

  const handleShareTwitter = useCallback(() => {
    const url = shareUrl || buildUrl()
    const tweet = encodeURIComponent(
      `WorldPulse live intelligence map 🌍 ${url} — real-time signals, wind flow, historical playback`
    )
    window.open(`https://twitter.com/intent/tweet?text=${tweet}`, '_blank', 'noopener,noreferrer')
    setOpen(false)
  }, [shareUrl, buildUrl])

  const handleShareReddit = useCallback(() => {
    const url = shareUrl || buildUrl()
    const title = encodeURIComponent('WorldPulse — real-time global intelligence map')
    window.open(
      `https://reddit.com/submit?url=${encodeURIComponent(url)}&title=${title}`,
      '_blank', 'noopener,noreferrer'
    )
    setOpen(false)
  }, [shareUrl, buildUrl])

  const handleShowQr = useCallback(async () => {
    const url = shareUrl || buildUrl()
    if (!qrSvg) {
      const svg = await generateQrSvg(url)
      setQrSvg(svg)
    }
    setQrOpen(v => !v)
  }, [shareUrl, buildUrl, qrSvg])

  return (
    <div
      ref={menuRef}
      className={`absolute bottom-14 right-3 z-30 flex flex-col items-end gap-2 ${className}`}
    >
      {/* QR panel */}
      {qrOpen && qrSvg && (
        <div className="bg-[rgba(6,7,13,0.97)] border border-[rgba(255,255,255,0.12)] rounded-xl p-3 shadow-2xl backdrop-blur-xl">
          <div className="font-mono text-[10px] text-wp-text3 mb-2 text-center">Scan to open</div>
          <div
            className="rounded-lg overflow-hidden"
            style={{ width: 160, height: 160 }}
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        </div>
      )}

      {/* Share menu */}
      {open && (
        <div className="bg-[rgba(6,7,13,0.97)] border border-[rgba(255,255,255,0.12)] rounded-xl shadow-2xl backdrop-blur-xl overflow-hidden min-w-[180px]">
          <div className="px-3 py-2 border-b border-[rgba(255,255,255,0.07)]">
            <div className="font-mono text-[10px] text-wp-text3 tracking-widest">SHARE THIS VIEW</div>
          </div>

          <button
            onClick={handleCopyLink}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 text-left text-[12px] text-wp-text2 hover:bg-[rgba(255,255,255,0.05)] transition-colors"
          >
            <span className="text-[14px]">{copied ? '✅' : '🔗'}</span>
            <span>{copied ? 'Copied!' : 'Copy link'}</span>
          </button>

          <button
            onClick={handleShareTwitter}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 text-left text-[12px] text-wp-text2 hover:bg-[rgba(255,255,255,0.05)] transition-colors"
          >
            <span className="text-[14px]">𝕏</span>
            <span>Share on X / Twitter</span>
          </button>

          <button
            onClick={handleShareReddit}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 text-left text-[12px] text-wp-text2 hover:bg-[rgba(255,255,255,0.05)] transition-colors"
          >
            <span className="text-[14px]">🔴</span>
            <span>Share on Reddit</span>
          </button>

          <button
            onClick={handleShowQr}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 text-left text-[12px] text-wp-text2 hover:bg-[rgba(255,255,255,0.05)] transition-colors border-t border-[rgba(255,255,255,0.07)]"
          >
            <span className="text-[14px]">📱</span>
            <span>{qrOpen ? 'Hide QR code' : 'Show QR code'}</span>
          </button>
        </div>
      )}

      {/* Main FAB */}
      <button
        onClick={handleMainClick}
        title="Share this map view"
        className={`
          flex items-center gap-1.5 px-3 py-2 rounded-xl
          border font-mono text-[11px] transition-all shadow-lg
          backdrop-blur-xl
          ${copied
            ? 'border-[rgba(34,197,94,0.6)] text-[#4ade80] bg-[rgba(34,197,94,0.12)]'
            : open
              ? 'border-[rgba(251,191,36,0.6)] text-[#fbbf24] bg-[rgba(251,191,36,0.1)]'
              : 'border-[rgba(255,255,255,0.12)] text-wp-text2 bg-[rgba(6,7,13,0.85)] hover:border-[rgba(255,255,255,0.25)] hover:text-white'
          }
        `}
      >
        <span>{copied ? '✅' : '🔗'}</span>
        <span>{copied ? 'COPIED!' : 'SHARE'}</span>
      </button>
    </div>
  )
}

export default ShareButton
