'use client'

/**
 * The form on world-pulse.io/check: paste a news article's link, see how many
 * outlets reported its story (lib/link-check.ts). The check's link goes into
 * the page's address (?url=…), so a result can be shared and opened again.
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { byLinkUrl, checkView, failureMessage, type CheckView, type LinkAnswer } from '@/lib/link-check'

type State = { kind: 'idle' } | { kind: 'checking' } | { kind: 'done'; view: CheckView } | { kind: 'failed'; message: string }

export function LinkChecker() {
  const [link, setLink] = useState('')
  const [state, setState] = useState<State>({ kind: 'idle' })
  const asked = useRef(0)

  async function check(value: string) {
    const url = value.trim()
    if (!url) return
    const mine = ++asked.current
    setState({ kind: 'checking' })
    try {
      window.history.replaceState(null, '', `/check?url=${encodeURIComponent(url)}`)
    } catch { /* the address stays as it was */ }
    try {
      const res = await fetch(byLinkUrl(url))
      if (mine !== asked.current) return
      if (!res.ok) { setState({ kind: 'failed', message: failureMessage(res.status) }); return }
      const json = await res.json() as { data?: LinkAnswer }
      if (mine !== asked.current) return
      setState(json.data ? { kind: 'done', view: checkView(json.data) } : { kind: 'failed', message: failureMessage(null) })
    } catch {
      if (mine === asked.current) setState({ kind: 'failed', message: failureMessage(null) })
    }
  }

  // A shared check (?url=…) runs when the page opens
  useEffect(() => {
    try {
      const shared = new URLSearchParams(window.location.search).get('url')
      if (shared) { setLink(shared); void check(shared) }
    } catch { /* no address to read */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <form
        onSubmit={e => { e.preventDefault(); void check(link) }}
        className="flex flex-col sm:flex-row gap-2"
        role="search"
        aria-label="Check a news link"
      >
        <label htmlFor="check-link" className="sr-only">A news article&apos;s link</label>
        <input
          id="check-link"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          required
          value={link}
          onChange={e => setLink(e.target.value)}
          placeholder="https://www.bbc.com/news/articles/…"
          className="flex-1 min-w-0 rounded-lg bg-wp-s2 border border-white/10 px-3 py-2.5 text-[14px] text-wp-text placeholder:text-wp-text3 outline-none focus:border-wp-amber"
        />
        <button
          type="submit"
          disabled={state.kind === 'checking'}
          className="rounded-lg bg-wp-amber px-5 py-2.5 text-[14px] font-semibold text-black hover:brightness-110 disabled:opacity-60"
        >
          {state.kind === 'checking' ? 'Checking…' : 'Check'}
        </button>
      </form>

      <div aria-live="polite" className="mt-5">
        {state.kind === 'done' && state.view.kind === 'found' && (
          <div className="rounded-xl border border-white/10 bg-wp-surface p-4">
            <p className="text-[15px] font-semibold text-wp-text leading-snug">{state.view.title}</p>
            {state.view.outlet && <p className="mt-0.5 font-mono text-[11px] text-wp-text3">{state.view.outlet}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={`inline-block rounded-full border px-3 py-1 font-mono text-[12px] font-bold ${state.view.verified
                  ? 'border-[rgba(0,230,118,0.35)] bg-[rgba(0,230,118,0.12)] text-wp-green'
                  : 'border-[rgba(245,166,35,0.35)] bg-[rgba(245,166,35,0.12)] text-wp-amber'}`}
              >
                {state.view.count}
              </span>
              {state.view.outlets && <span className="text-[12px] text-wp-text3">{state.view.outlets}</span>}
            </div>
            <p className="mt-3 text-[13px] text-wp-text2 leading-relaxed">{state.view.verdict}</p>
            <Link href={state.view.href} className="mt-3 inline-block text-[13px] font-semibold text-wp-amber hover:underline">
              See every outlet and report →
            </Link>
          </div>
        )}
        {state.kind === 'done' && state.view.kind === 'missing' && (
          <p className="rounded-xl border border-white/10 bg-wp-surface p-4 text-[13px] text-wp-text2 leading-relaxed">
            {state.view.message}{' '}
            <Link href="/search" className="text-wp-amber hover:underline">Search WorldPulse →</Link>
          </p>
        )}
        {state.kind === 'failed' && (
          <p className="rounded-xl border border-white/10 bg-wp-surface p-4 text-[13px] text-wp-text2">{state.message}</p>
        )}
      </div>
    </div>
  )
}
