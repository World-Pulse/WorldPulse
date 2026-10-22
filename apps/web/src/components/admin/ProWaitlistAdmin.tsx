'use client'

/**
 * The Pro waitlist on /admin (plan 13a, Oct 21, 2026): how many wait, and
 * the one "Pro is open" email, sent to everyone on the list once Pro's
 * checkout is live and the server can send email. The API sends it once per
 * address, never twice (POST /api/v1/admin/pro-waitlist/announce).
 */

import { useEffect, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

interface WaitlistState {
  waiting: number
  announced: number
  checkout: 'live' | 'test' | 'off'
  emailReady: boolean
}

/** Why the button is off, or null when it can be pressed */
export function announceBlocked(s: WaitlistState): string | null {
  if (s.checkout !== 'live') return s.checkout === 'test' ? 'Checkout is in Stripe test mode: put the live keys on the server first.' : 'Checkout is off: the server has no Stripe key.'
  if (!s.emailReady) return "The server can't send email yet (the Resend key)."
  if (s.waiting <= s.announced) return s.waiting === 0 ? 'Nobody is on the list.' : 'Everyone on the list has had the email.'
  return null
}

export function ProWaitlistAdmin({ token }: { token: string | null }) {
  const [state, setState] = useState<WaitlistState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  function load(tok: string) {
    fetch(`${API_URL}/api/v1/admin/pro-waitlist`, { headers: { Authorization: `Bearer ${tok}` } })
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const json = await r.json() as { data?: WaitlistState }
        if (json.data) setState(json.data)
      })
      .catch(err => setError(`Couldn't load the waitlist (${String(err instanceof Error ? err.message : err)})`))
  }

  useEffect(() => { if (token) load(token) }, [token])

  async function send() {
    if (!token || sending) return
    setSending(true)
    setResult(null)
    try {
      const r = await fetch(`${API_URL}/api/v1/admin/pro-waitlist/announce`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
      const json = await r.json().catch(() => null) as { data?: { sent: number; skipped: number; failed: number }; error?: string } | null
      if (!r.ok || !json?.data) {
        setResult(json?.error || `Not sent (HTTP ${r.status}).`)
      } else {
        const d = json.data
        setResult(`Sent ${d.sent}; ${d.skipped} had it already${d.failed ? `; ${d.failed} failed (press again to retry them)` : ''}.`)
      }
    } catch {
      setResult('Network error: nothing was confirmed. Press again: nobody gets it twice.')
    }
    setSending(false)
    setConfirming(false)
    load(token)
  }

  const blocked = state ? announceBlocked(state) : null

  return (
    <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl px-5 py-4">
      <h2 className="text-[12px] font-mono text-wp-text3 uppercase tracking-widest mb-3">Pro waitlist</h2>
      {error ? (
        <p className="text-[13px] text-wp-red">{error}</p>
      ) : !state ? (
        <p className="text-[13px] text-wp-text3">Loading…</p>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-wp-text2">
            {state.waiting} waiting · {state.announced} emailed · checkout {state.checkout} · email {state.emailReady ? 'ready' : 'not set up'}
          </p>
          {confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-wp-text">Email {state.waiting - state.announced} addresses that Pro is open?</span>
              <button type="button" onClick={send} disabled={sending}
                className="px-3 py-1.5 rounded-lg bg-wp-cyan text-wp-bg text-[12px] font-bold disabled:opacity-60">{sending ? 'Sending…' : 'Send'}</button>
              <button type="button" onClick={() => setConfirming(false)} disabled={sending}
                className="px-3 py-1.5 rounded-lg border border-white/15 text-[12px] text-wp-text2">Cancel</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} disabled={!!blocked}
              className="px-3 py-1.5 rounded-lg bg-wp-cyan text-wp-bg text-[12px] font-bold disabled:opacity-40 disabled:cursor-not-allowed">
              Email the waitlist that Pro is open
            </button>
          )}
          {blocked && !confirming && <p className="text-[12px] text-wp-text3">{blocked}</p>}
          {result && <p role="status" className="text-[12px] text-wp-text">{result}</p>}
        </div>
      )}
    </div>
  )
}
