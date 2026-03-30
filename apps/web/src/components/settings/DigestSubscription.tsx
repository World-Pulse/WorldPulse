'use client'

import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@/components/Toast'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ─── Types ────────────────────────────────────────────────────────────────────

type Frequency   = 'weekly' | 'daily'
type MinSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

interface DigestStatus {
  subscribed:   boolean
  frequency?:   Frequency
  categories?:  string[]
  min_severity?: MinSeverity
  last_sent_at?: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_CATEGORIES = [
  'conflict',
  'disaster',
  'politics',
  'economy',
  'health',
  'technology',
  'environment',
  'security',
  'energy',
  'transport',
]

const SEVERITY_OPTIONS: { value: MinSeverity; label: string }[] = [
  { value: 'critical', label: 'Critical only' },
  { value: 'high',     label: 'High & above' },
  { value: 'medium',   label: 'Medium & above' },
  { value: 'low',      label: 'Low & above' },
  { value: 'info',     label: 'All signals' },
]

const SEVERITY_COLORS: Record<MinSeverity, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#22c55e',
  info:     '#3b82f6',
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  /** Pre-fill the email field (e.g. from the logged-in user's profile) */
  defaultEmail?: string
}

export default function DigestSubscription({ defaultEmail = '' }: Props) {
  const { toast } = useToast()

  const [email,       setEmail]       = useState(defaultEmail)
  const [frequency,   setFrequency]   = useState<Frequency>('weekly')
  const [categories,  setCategories]  = useState<string[]>([])
  const [minSeverity, setMinSeverity] = useState<MinSeverity>('medium')
  const [status,      setStatus]      = useState<DigestStatus | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [checking,    setChecking]    = useState(false)

  // ── Check subscription status ────────────────────────────────────────────

  const checkStatus = useCallback(async (emailToCheck: string) => {
    if (!emailToCheck || !emailToCheck.includes('@')) return
    setChecking(true)
    try {
      const res = await fetch(
        `${API_URL}/api/v1/digest/status?email=${encodeURIComponent(emailToCheck)}`,
      )
      if (!res.ok) return
      const data = await res.json() as { success: boolean; data: DigestStatus }
      if (data.success) {
        setStatus(data.data)
        if (data.data.subscribed) {
          setFrequency(data.data.frequency ?? 'weekly')
          setCategories(data.data.categories ?? [])
          setMinSeverity(data.data.min_severity ?? 'medium')
        }
      }
    } catch {
      // silently ignore network errors during status check
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    if (defaultEmail) {
      void checkStatus(defaultEmail)
    }
  }, [defaultEmail, checkStatus])

  // ── Subscribe ────────────────────────────────────────────────────────────

  async function handleSubscribe(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !email.includes('@')) {
      toast('Please enter a valid email address', 'error')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/digest/subscribe`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          frequency,
          categories,
          min_severity: minSeverity,
        }),
      })
      const data = await res.json() as { success: boolean; message?: string; error?: string }
      if (data.success) {
        toast(data.message ?? 'Subscribed to digest!', 'success')
        setStatus({ subscribed: true, frequency, categories, min_severity: minSeverity })
      } else {
        toast(data.error ?? 'Failed to subscribe', 'error')
      }
    } catch {
      toast('Network error — please try again', 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── Unsubscribe ──────────────────────────────────────────────────────────

  async function handleUnsubscribe() {
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/digest/unsubscribe`, {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json() as { success: boolean; message?: string; error?: string }
      if (data.success) {
        toast('Unsubscribed from digest', 'info')
        setStatus({ subscribed: false })
      } else {
        toast(data.error ?? 'Failed to unsubscribe', 'error')
      }
    } catch {
      toast('Network error — please try again', 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── Category toggle ──────────────────────────────────────────────────────

  function toggleCategory(cat: string) {
    setCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat],
    )
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const isSubscribed = status?.subscribed === true
  const currentColor = SEVERITY_COLORS[minSeverity]

  return (
    <div className="bg-black/40 border border-white/10 rounded-xl p-5 space-y-5">
      {/* Section header */}
      <div>
        <div className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase mb-1">
          Intelligence Digest
        </div>
        <p className="text-[12px] text-wp-text3">
          Receive a curated briefing of the top verified signals, grouped by category.
        </p>
      </div>

      {/* Status badge */}
      {status && (
        <div
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
            isSubscribed
              ? 'bg-wp-green/10 text-wp-green border border-wp-green/20'
              : 'bg-white/5 text-wp-text3 border border-white/10'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isSubscribed ? 'bg-wp-green' : 'bg-wp-text3'}`} />
          {isSubscribed ? `Active — ${status.frequency ?? 'weekly'}` : 'Not subscribed'}
        </div>
      )}

      {/* Form */}
      <form onSubmit={(e) => { void handleSubscribe(e) }} className="space-y-4">
        {/* Email */}
        <div>
          <label className="block text-[11px] text-wp-text3 mb-1.5">Email address</label>
          <div className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onBlur={() => { void checkStatus(email) }}
              placeholder="you@example.com"
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[13px] text-wp-text placeholder:text-wp-text3 focus:outline-none focus:border-wp-amber/50 transition-colors"
              required
              disabled={loading}
            />
            {checking && (
              <span className="flex items-center text-[11px] text-wp-text3 pr-1">checking…</span>
            )}
          </div>
        </div>

        {/* Frequency toggle */}
        <div>
          <label className="block text-[11px] text-wp-text3 mb-1.5">Frequency</label>
          <div className="flex gap-2">
            {(['weekly', 'daily'] as Frequency[]).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setFrequency(f)}
                className={`px-4 py-1.5 rounded-lg text-[12px] font-medium border transition-all capitalize ${
                  frequency === f
                    ? 'bg-wp-amber text-black border-wp-amber'
                    : 'bg-white/5 text-wp-text2 border-white/10 hover:border-wp-amber/30'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Min severity */}
        <div>
          <label className="block text-[11px] text-wp-text3 mb-1.5">
            Minimum severity
            <span
              className="ml-2 font-semibold"
              style={{ color: currentColor }}
            >
              {SEVERITY_OPTIONS.find(s => s.value === minSeverity)?.label}
            </span>
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {SEVERITY_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setMinSeverity(value)}
                className="px-3 py-1 rounded-md text-[11px] font-medium border transition-all"
                style={{
                  backgroundColor: minSeverity === value ? `${SEVERITY_COLORS[value]}20` : 'transparent',
                  borderColor:      minSeverity === value ? `${SEVERITY_COLORS[value]}50` : 'rgba(255,255,255,0.1)',
                  color:            minSeverity === value ? SEVERITY_COLORS[value] : '#6b7280',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Category filter */}
        <div>
          <label className="block text-[11px] text-wp-text3 mb-1.5">
            Categories
            <span className="ml-1 text-wp-text3/60">(leave blank for all)</span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {ALL_CATEGORIES.map(cat => {
              const active = categories.includes(cat)
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all capitalize ${
                    active
                      ? 'bg-wp-amber/15 text-wp-amber border-wp-amber/30'
                      : 'bg-white/5 text-wp-text3 border-white/10 hover:border-white/20'
                  }`}
                >
                  {cat}
                </button>
              )
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          {!isSubscribed ? (
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 rounded-lg bg-wp-amber text-black font-bold text-[14px] hover:bg-[#ffb84d] transition-all disabled:opacity-50"
            >
              {loading ? 'Subscribing…' : 'Subscribe to Digest'}
            </button>
          ) : (
            <>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2.5 rounded-lg bg-wp-amber text-black font-bold text-[14px] hover:bg-[#ffb84d] transition-all disabled:opacity-50"
              >
                {loading ? 'Saving…' : 'Update Preferences'}
              </button>
              <button
                type="button"
                onClick={() => { void handleUnsubscribe() }}
                disabled={loading}
                className="px-4 py-2.5 rounded-lg bg-white/5 text-wp-text3 font-medium text-[13px] border border-white/10 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 transition-all disabled:opacity-50"
              >
                Unsubscribe
              </button>
            </>
          )}
        </div>
      </form>

      {/* Last sent info */}
      {isSubscribed && status?.last_sent_at && (
        <p className="text-[11px] text-wp-text3">
          Last digest sent:{' '}
          {new Date(status.last_sent_at).toLocaleDateString(undefined, {
            weekday: 'short', month: 'short', day: 'numeric',
          })}
        </p>
      )}
    </div>
  )
}
