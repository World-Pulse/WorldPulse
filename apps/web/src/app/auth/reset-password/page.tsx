'use client'

/**
 * Choose a new password (plan G13, Oct 21, 2026): the page the emailed link
 * opens. The token is in the address's #fragment, which browsers never send
 * to a server, so it stays out of logs and analytics; the page reads it,
 * takes it out of the address bar, and sends it with the new password to
 * POST /api/v1/auth/reset-password. The link works once, for 1 hour.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { tokenFromHash } from '@/lib/reset-link'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setToken(tokenFromHash(window.location.hash))
    // the link's secret doesn't stay in the address bar or the history
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) { setError('Choose a password of at least 8 characters.'); return }
    if (password !== confirm) { setError("The two passwords aren't the same."); return }
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json().catch(() => null) as { data?: { message?: string }; error?: string; message?: string } | null
      if (!res.ok) {
        setError(data?.error || data?.message || 'Something went wrong. Please try again.')
        return
      }
      setDone(data?.data?.message || 'Your password is changed. Sign in with the new one.')
    } catch {
      setError('Unable to connect. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const inputClass = 'bg-wp-surface2 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[14px] text-wp-text placeholder-wp-text3 outline-none focus:border-wp-amber transition-colors'

  return (
    <div className="min-h-[calc(100vh-52px)] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-wp-red shadow-[0_0_12px_#ff3b5c] animate-live-pulse" />
            <span className="font-display text-[24px] tracking-[3px] text-wp-text">
              WORLD<span className="text-wp-amber">PULSE</span>
            </span>
          </Link>
          <p className="mt-2 text-[13px] text-wp-text2">Choose a new password</p>
        </div>

        {done ? (
          <div role="status" className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-6 flex flex-col gap-4">
            <p className="text-[14px] leading-relaxed text-wp-text">{done}</p>
            <Link href="/auth/login" className="text-center bg-wp-amber text-black font-bold text-[14px] rounded-lg py-2 hover:bg-[#ffb84d] transition-colors">
              Sign in
            </Link>
          </div>
        ) : token === '' ? (
          <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-6 flex flex-col gap-4">
            <p className="text-[14px] leading-relaxed text-wp-text2">
              This page needs the link from the email we sent you. Open the link from the email, or ask for a new one.
            </p>
            <Link href="/auth/forgot-password" className="text-center bg-wp-amber text-black font-bold text-[14px] rounded-lg py-2 hover:bg-[#ffb84d] transition-colors">
              Ask for a new link
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-6 flex flex-col gap-4">
            {error && (
              <div role="alert" className="bg-[rgba(255,59,92,0.1)] border border-[rgba(255,59,92,0.3)] rounded-lg px-4 py-3 text-[13px] text-wp-red">
                {error}{' '}
                {/link|expired/i.test(error) && <Link href="/auth/forgot-password" className="underline">Ask for a new link</Link>}
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label htmlFor="reset-password" className="text-[12px] text-wp-text2 font-medium">New password</label>
              <input id="reset-password" type="password" value={password} onChange={e => setPassword(e.target.value)}
                required minLength={8} maxLength={128} autoComplete="new-password" className={inputClass} placeholder="At least 8 characters" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="reset-confirm" className="text-[12px] text-wp-text2 font-medium">The same again</label>
              <input id="reset-confirm" type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                required minLength={8} maxLength={128} autoComplete="new-password" className={inputClass} placeholder="••••••••" />
            </div>
            <button
              type="submit"
              disabled={loading || token === null}
              className="mt-1 bg-wp-amber text-black font-bold text-[14px] rounded-lg py-2 hover:bg-[#ffb84d] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Saving…' : 'Save the new password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
