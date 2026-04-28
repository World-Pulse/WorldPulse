'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}

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

      // Manually dispatch storage event so TopNav updates in the same tab
      // (the native storage event only fires in other tabs, not the current one)
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'wp_user',
        newValue: JSON.stringify(data.data.user),
      }))

      router.push(data.data.user.onboarded ? '/' : '/onboarding')
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

        {/* GitHub OAuth */}
        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1 h-px bg-[rgba(255,255,255,0.07)]" />
          <span className="text-[11px] text-wp-text3">or</span>
          <div className="flex-1 h-px bg-[rgba(255,255,255,0.07)]" />
        </div>
        <a
          href={`${API_URL}/api/v1/auth/github`}
          className="mt-3 flex items-center justify-center gap-2 w-full bg-[#24292e] hover:bg-[#2f363d] text-white text-[14px] font-medium rounded-lg py-2 transition-colors border border-[rgba(255,255,255,0.1)]"
        >
          <GitHubIcon />
          Continue with GitHub
        </a>

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
