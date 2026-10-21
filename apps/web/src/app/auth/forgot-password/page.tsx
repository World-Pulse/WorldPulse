'use client'

/**
 * Forgot password (plan G13, Oct 21, 2026): the reader gives their account's
 * email address and the API emails a link to choose a new password (POST
 * /api/v1/auth/forgot-password). The answer is the same whether or not an
 * account uses the address. Until the server can send email, the API says so
 * and points to support@world-pulse.io, and this page shows that.
 */

import { useState } from 'react'
import Link from 'next/link'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => null) as { data?: { message?: string }; error?: string; message?: string } | null
      if (!res.ok) {
        setError(data?.error || data?.message || 'Something went wrong. Please try again.')
        return
      }
      setSent(data?.data?.message || 'Check your email for a link to choose a new password.')
    } catch {
      setError('Unable to connect. Please try again.')
    } finally {
      setLoading(false)
    }
  }

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
          <p className="mt-2 text-[13px] text-wp-text2">Forgot your password?</p>
        </div>

        {sent ? (
          <div role="status" className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-6 flex flex-col gap-4">
            <p className="text-[14px] leading-relaxed text-wp-text">{sent}</p>
            <Link href="/auth/login" className="text-center bg-wp-amber text-black font-bold text-[14px] rounded-lg py-2 hover:bg-[#ffb84d] transition-colors">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-6 flex flex-col gap-4">
            <p className="text-[13px] leading-relaxed text-wp-text2">
              Enter your account&apos;s email address and we&apos;ll send you a link to choose a new one.
            </p>
            {error && (
              <div role="alert" className="bg-[rgba(255,59,92,0.1)] border border-[rgba(255,59,92,0.3)] rounded-lg px-4 py-3 text-[13px] text-wp-red">
                {error}
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label htmlFor="forgot-email" className="text-[12px] text-wp-text2 font-medium">Email</label>
              <input
                id="forgot-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="bg-wp-surface2 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[14px] text-wp-text placeholder-wp-text3 outline-none focus:border-wp-amber transition-colors"
                placeholder="you@example.com"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="mt-1 bg-wp-amber text-black font-bold text-[14px] rounded-lg py-2 hover:bg-[#ffb84d] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Sending…' : 'Send the link'}
            </button>
          </form>
        )}

        <p className="text-center mt-4 text-[13px] text-wp-text2">
          Remembered it? <Link href="/auth/login" className="text-wp-amber hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
