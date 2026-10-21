'use client'

/**
 * "Pro coming soon": the waitlist box on /pricing and /developers (plan 13;
 * Devon, Oct 21, 2026: "Waitlist now, price later"). POST
 * /api/v1/pro/waitlist; the address is used once, to say Pro is open.
 */

import { useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export function ProWaitlist({ source, compact = false }: { source: string; compact?: boolean }) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (state === 'sending') return
    setState('sending')
    setMessage('')
    try {
      const res = await fetch(`${API_URL}/api/v1/pro/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source }),
      })
      const data = await res.json().catch(() => null) as { message?: string; error?: string } | null
      if (!res.ok) {
        setState('error')
        setMessage(data?.error ?? (res.status === 429 ? 'Too many tries. Please wait a minute.' : 'Couldn’t add you just now. Please try again.'))
        return
      }
      setState('done')
      setMessage(data?.message ?? 'You’re on the list. We’ll email you once, when Pro opens.')
    } catch {
      setState('error')
      setMessage('Network error. Please check your connection and try again.')
    }
  }

  if (state === 'done') {
    return <p role="status" className="text-sm text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-3 py-2">{message}</p>
  }

  return (
    <form onSubmit={submit} className="space-y-2" aria-label="Join the Pro waitlist">
      <div className={compact ? 'flex flex-col sm:flex-row gap-2' : 'flex flex-col gap-2'}>
        <label htmlFor={`waitlist-${source}`} className="sr-only">Email address</label>
        <input
          id={`waitlist-${source}`}
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="flex-1 min-w-0 rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-sm text-wp-text placeholder:text-wp-text/40 outline-none focus:border-wp-cyan/60"
        />
        <button
          type="submit"
          disabled={state === 'sending'}
          className="rounded-xl bg-wp-cyan hover:bg-wp-cyan/90 active:bg-wp-cyan/80 text-wp-bg font-bold px-5 py-3 text-sm transition-colors disabled:opacity-60 disabled:cursor-wait"
        >
          {state === 'sending' ? 'Adding you…' : 'Join the waitlist'}
        </button>
      </div>
      {state === 'error' && <p role="alert" className="text-xs text-red-400">{message}</p>}
      <p className="text-xs text-wp-text/40">We use your address once, to tell you when Pro opens. Nothing else, and no card.</p>
    </form>
  )
}
