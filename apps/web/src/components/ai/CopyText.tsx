'use client'

import { useRef, useState } from 'react'

/**
 * A line to copy on the /ai page (the server's address, a command): the text,
 * selectable on its own, and a Copy button. Where the browser refuses the
 * clipboard (an embedded view, an old browser) the text is selected instead,
 * for the reader to copy themselves.
 */
export function CopyText({ text, label = 'Copy' }: { text: string; label?: string }) {
  const ref = useRef<HTMLElement>(null)
  const [done, setDone] = useState<'copied' | 'selected' | null>(null)

  const select = () => {
    const el = ref.current
    const sel = typeof window === 'undefined' ? null : window.getSelection()
    if (!el || !sel) return
    const range = document.createRange()
    range.selectNodeContents(el)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setDone('copied')
    } catch {
      select()
      setDone('selected')
    }
    setTimeout(() => setDone(null), 2500)
  }

  return (
    <div className="flex items-stretch gap-2 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] p-1.5">
      <code ref={ref} className="flex-1 min-w-0 px-2 py-1.5 font-mono text-[13px] text-wp-cyan break-all select-all">{text}</code>
      <button
        type="button"
        onClick={copy}
        aria-label={`${label}: ${text}`}
        className="shrink-0 rounded-md px-3 text-[12px] font-mono bg-[rgba(255,255,255,0.06)] text-wp-text2 hover:bg-[rgba(255,255,255,0.12)] hover:text-wp-text transition-colors"
      >
        <span aria-live="polite">{done === 'copied' ? 'Copied' : done === 'selected' ? 'Selected: copy it' : label}</span>
      </button>
    </div>
  )
}
