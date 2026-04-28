'use client'

import { useState } from 'react'
import type { FlagReason } from '@worldpulse/types'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const FLAG_REASONS: { value: FlagReason; label: string; description: string }[] = [
  { value: 'inaccurate',     label: 'Inaccurate',     description: 'The information is factually wrong or misleading' },
  { value: 'outdated',       label: 'Outdated',       description: 'This signal is no longer current or relevant' },
  { value: 'duplicate',      label: 'Duplicate',      description: 'Duplicates existing signal coverage' },
  { value: 'misinformation', label: 'Misinformation', description: 'Deliberately false or manipulated information' },
]

interface FlagModalProps {
  signalId: string
  onClose: () => void
}

export function FlagModal({ signalId, onClose }: FlagModalProps) {
  const [selected,   setSelected]   = useState<FlagReason | null>(null)
  const [notes,      setNotes]      = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted,  setSubmitted]  = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  async function handleSubmit() {
    if (!selected) return
    setSubmitting(true)
    setError(null)
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('wp_access_token') : null
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch(`${API_URL}/api/v1/signals/${signalId}/flag`, {
        method:  'POST',
        headers,
        body:    JSON.stringify({ reason: selected, notes: notes.trim() || undefined }),
      })

      if (res.status === 409) { setError('You have already flagged this signal.'); return }
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        setError(j.error ?? 'Something went wrong. Please try again.')
        return
      }
      setSubmitted(true)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
      aria-label="Flag signal"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative w-full max-w-[400px] rounded-2xl bg-[#0d1117] border border-white/[0.10] shadow-2xl p-5 animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-semibold text-[15px] text-wp-text">Flag Signal</div>
            <div className="text-[12px] text-wp-text3 mt-0.5">Help keep WorldPulse accurate</div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-wp-text3 hover:text-wp-text hover:bg-white/[0.06] transition-all text-[18px] leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {submitted ? (
          <div className="py-6 text-center space-y-2">
            <div className="w-10 h-10 rounded-full bg-wp-green/10 border border-wp-green/30 flex items-center justify-center text-wp-green mx-auto mb-3">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div className="text-[14px] font-medium text-wp-green">Flag submitted</div>
            <div className="text-[12px] text-wp-text3">Our moderation team will review this signal.</div>
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 rounded-full border border-white/10 text-[12px] text-wp-text2 hover:border-white/20 hover:text-wp-text transition-all"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-2 mb-4">
              {FLAG_REASONS.map(r => (
                <button
                  key={r.value}
                  onClick={() => setSelected(r.value)}
                  aria-pressed={selected === r.value}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all
                    ${selected === r.value
                      ? 'border-wp-amber/50 bg-wp-amber/10 text-wp-text'
                      : 'border-white/[0.07] bg-white/[0.02] text-wp-text2 hover:border-white/[0.14] hover:bg-white/[0.04]'
                    }`}
                >
                  <div className="font-medium text-[13px]">{r.label}</div>
                  <div className="text-[11px] text-wp-text3 mt-0.5">{r.description}</div>
                </button>
              ))}
            </div>

            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Additional context (optional)"
              rows={2}
              maxLength={500}
              className="w-full px-3 py-2 rounded-xl border border-white/[0.07] bg-white/[0.02] text-[13px] text-wp-text placeholder:text-wp-text3 resize-none focus:outline-none focus:border-white/20 mb-3"
            />

            {error && (
              <div className="text-[12px] text-wp-red mb-3">{error}</div>
            )}

            <button
              onClick={handleSubmit}
              disabled={!selected || submitting}
              className="w-full py-2.5 rounded-xl bg-wp-amber/10 border border-wp-amber/30 text-[13px] font-semibold text-wp-amber hover:bg-wp-amber/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? 'Submitting…' : 'Submit Flag'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
