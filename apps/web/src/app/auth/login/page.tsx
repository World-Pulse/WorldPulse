'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Login failed')
        return
      }

      localStorage.setItem('wp_access_token', data.data.accessToken)
      localStorage.setItem('wp_refresh_token', data.data.refreshToken)
      localStorage.setItem('wp_user', JSON.stringify(data.data.user))

      router.push('/')
      router.refresh()
    } catch {
      setError('Unable to connect. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[calc(100vh-52px)] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Logo mark */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-wp-red shadow-[0_0_12px_#ff3b5c] animate-live-pulse" />
            <span className="font-display text-[24px] tracking-[3px] text-wp-text">
              WORLD<span className="text-wp-amber">PULSE</span>
            </span>
          </Link>
          <p className="mt-2 text-[13px] text-wp-text2">Sign in to your account</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-6 flex flex-col gap-4"
        >
          {error && (
            <div className="bg-[rgba(255,59,92,0.1)] border border-[rgba(255,59,92,0.3)] rounded-lg px-4 py-3 text-[13px] text-wp-red">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-[12px] text-wp-text2 font-medium">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="bg-wp-surface2 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[14px] text-wp-text placeholder-wp-text3 outline-none focus:border-wp-amber transition-colors"
              placeholder="you@example.com"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[12px] text-wp-text2 font-medium">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="bg-wp-surface2 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[14px] text-wp-text placeholder-wp-text3 outline-none focus:border-wp-amber transition-colors"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-1 bg-wp-amber text-black font-bold text-[14px] rounded-lg py-2 hover:bg-[#ffb84d] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="text-center mt-4 text-[13px] text-wp-text2">
          No account?{' '}
          <Link href="/auth/register" className="text-wp-amber hover:underline">
            Join free
          </Link>
        </p>
      </div>
    </div>
  )
}
