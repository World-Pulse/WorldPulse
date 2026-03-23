'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export default function RegisterPage() {
  const router = useRouter()
  const [handle, setHandle] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch(`${API_URL}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, displayName, email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Registration failed')
        return
      }

      localStorage.setItem('wp_access_token', data.data.accessToken)
      localStorage.setItem('wp_refresh_token', data.data.refreshToken)
      localStorage.setItem('wp_user', JSON.stringify(data.data.user))

      // Manually dispatch storage event so TopNav updates in the same tab
      // (the native storage event only fires in other tabs, not the current one)
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'wp_user',
        newValue: JSON.stringify(data.data.user),
      }))

      router.push('/onboarding')
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
          <p className="mt-2 text-[13px] text-wp-text2">Create your account</p>
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
            <label className="text-[12px] text-wp-text2 font-medium">Handle</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-wp-text3 text-[14px]">@</span>
              <input
                type="text"
                value={handle}
                onChange={e => setHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                required
                minLength={3}
                maxLength={50}
                autoComplete="username"
                className="w-full bg-wp-surface2 border border-[rgba(255,255,255,0.08)] rounded-lg pl-7 pr-3 py-2 text-[14px] text-wp-text placeholder-wp-text3 outline-none focus:border-wp-amber transition-colors"
                placeholder="yourhandle"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[12px] text-wp-text2 font-medium">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              required
              maxLength={100}
              autoComplete="name"
              className="bg-wp-surface2 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[14px] text-wp-text placeholder-wp-text3 outline-none focus:border-wp-amber transition-colors"
              placeholder="Your Name"
            />
          </div>

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
              minLength={8}
              autoComplete="new-password"
              className="bg-wp-surface2 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[14px] text-wp-text placeholder-wp-text3 outline-none focus:border-wp-amber transition-colors"
              placeholder="Min. 8 characters"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-1 bg-wp-amber text-black font-bold text-[14px] rounded-lg py-2 hover:bg-[#ffb84d] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating account…' : 'Join WorldPulse'}
          </button>
        </form>

        <p className="text-center mt-4 text-[13px] text-wp-text2">
          Already have an account?{' '}
          <Link href="/auth/login" className="text-wp-amber hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
