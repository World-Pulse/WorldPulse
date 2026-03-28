'use client'

/**
 * BiasCorrectionPanel — Community crowdsourced bias corrections
 *
 * Lets authenticated users submit and vote on bias label corrections for a source.
 * Shows community consensus when the threshold is reached (10+ net votes, 70%+ agreement).
 *
 * Counter to Ground News's community bias ratings — fully transparent and auditable.
 */

import { useState, useEffect, useCallback } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const BIAS_LABELS = [
  { value: 'far-left',      label: 'Far Left' },
  { value: 'left',          label: 'Left' },
  { value: 'center-left',   label: 'Center Left' },
  { value: 'center',        label: 'Center' },
  { value: 'center-right',  label: 'Center Right' },
  { value: 'right',         label: 'Right' },
  { value: 'far-right',     label: 'Far Right' },
  { value: 'satire',        label: 'Satire' },
  { value: 'state_media',   label: 'State Media' },
  { value: 'unknown',       label: 'Unknown / Unclear' },
] as const

const BIAS_COLORS: Record<string, string> = {
  'far-left':     '#ef4444',
  'left':         '#f97316',
  'center-left':  '#eab308',
  'center':       '#6b7280',
  'center-right': '#3b82f6',
  'right':        '#8b5cf6',
  'far-right':    '#ec4899',
  'satire':       '#10b981',
  'state_media':  '#dc2626',
  'unknown':      '#6b7280',
}

interface Correction {
  id:              number
  suggested_label: string
  notes:           string | null
  net_votes:       number
  upvotes:         number
  downvotes:       number
  created_at:      string
}

interface Summary {
  pending_count:       number
  top_suggestion:      string | null
  top_suggestion_votes: number
  consensus_reached:   boolean
  consensus_label:     string | null
}

interface Props {
  sourceId:         string
  currentBiasLabel?: string | null
}

export function BiasCorrectionPanel({ sourceId, currentBiasLabel }: Props) {
  const [summary,      setSummary]     = useState<Summary | null>(null)
  const [corrections,  setCorrections] = useState<Correction[]>([])
  const [loading,      setLoading]     = useState(true)
  const [showForm,     setShowForm]    = useState(false)
  const [formLabel,    setFormLabel]   = useState('center')
  const [formNotes,    setFormNotes]   = useState('')
  const [submitting,   setSubmitting]  = useState(false)
  const [voting,       setVoting]      = useState<number | null>(null)
  const [error,        setError]       = useState<string | null>(null)
  const [successMsg,   setSuccessMsg]  = useState<string | null>(null)

  const token = typeof window !== 'undefined'
    ? (localStorage.getItem('wp_token') ?? localStorage.getItem('auth_token'))
    : null

  const fetchData = useCallback(async () => {
    try {
      const [summaryRes, correctionsRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/sources/${sourceId}/bias-corrections/summary`),
        fetch(`${API_URL}/api/v1/sources/${sourceId}/bias-corrections`),
      ])
      if (summaryRes.ok) {
        const j = await summaryRes.json() as { data: Summary }
        setSummary(j.data)
      }
      if (correctionsRes.ok) {
        const j = await correctionsRes.json() as { data: Correction[] }
        setCorrections(j.data ?? [])
      }
    } catch {
      // silently fail — panel is non-critical
    } finally {
      setLoading(false)
    }
  }, [sourceId])

  useEffect(() => { void fetchData() }, [fetchData])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) { setError('You must be logged in to suggest a correction.'); return }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/v1/sources/${sourceId}/bias-corrections`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ suggested_label: formLabel, notes: formNotes || undefined }),
      })
      if (!res.ok) {
        const j = await res.json() as { error?: string }
        setError(j.error ?? 'Failed to submit correction')
      } else {
        setSuccessMsg('Your correction has been submitted for community voting!')
        setShowForm(false)
        setFormNotes('')
        void fetchData()
      }
    } catch {
      setError('Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleVote = async (correctionId: number, vote: 1 | -1) => {
    if (!token) { setError('You must be logged in to vote.'); return }
    setVoting(correctionId)
    setError(null)
    try {
      const res = await fetch(
        `${API_URL}/api/v1/sources/${sourceId}/bias-corrections/${correctionId}/vote`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body:    JSON.stringify({ vote }),
        },
      )
      if (!res.ok) {
        const j = await res.json() as { error?: string }
        setError(j.error ?? 'Failed to record vote')
      } else {
        void fetchData()
      }
    } catch {
      setError('Network error — please try again.')
    } finally {
      setVoting(null)
    }
  }

  if (loading) {
    return (
      <div className="mt-4 rounded-lg border border-white/5 bg-[#0d0f18] p-4 animate-pulse">
        <div className="h-4 w-48 rounded bg-white/5 mb-2" />
        <div className="h-3 w-32 rounded bg-white/5" />
      </div>
    )
  }

  const labelDisplay = (label: string) =>
    BIAS_LABELS.find(b => b.value === label)?.label ?? label

  return (
    <div className="mt-4 rounded-lg border border-white/5 bg-[#0d0f18] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-wp-text1">Community Bias Corrections</h3>
          <p className="text-xs text-wp-text3 mt-0.5">
            Transparent, community-verified bias ratings
          </p>
        </div>
        {summary && summary.pending_count > 0 && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-400">
            {summary.pending_count} pending
          </span>
        )}
      </div>

      {/* Consensus banner */}
      {summary?.consensus_reached && summary.consensus_label && (
        <div className="mb-3 rounded-md border border-green-500/20 bg-green-500/5 px-3 py-2">
          <p className="text-xs font-semibold text-green-400">
            ✓ Community consensus: {labelDisplay(summary.consensus_label)}
          </p>
          <p className="text-xs text-green-400/60 mt-0.5">
            {summary.top_suggestion_votes}+ net votes · Pending auto-apply
          </p>
        </div>
      )}

      {/* Current label */}
      {currentBiasLabel && (
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs text-wp-text3">Current:</span>
          <span
            className="rounded px-2 py-0.5 text-xs font-semibold"
            style={{
              backgroundColor: (BIAS_COLORS[currentBiasLabel] ?? '#6b7280') + '22',
              color:            BIAS_COLORS[currentBiasLabel] ?? '#6b7280',
            }}
          >
            {labelDisplay(currentBiasLabel)}
          </span>
        </div>
      )}

      {/* Top corrections */}
      {corrections.length > 0 && (
        <div className="mb-3 space-y-2">
          {corrections.slice(0, 3).map(c => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded border border-white/5 bg-white/2 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span
                  className="rounded px-1.5 py-0.5 text-xs font-semibold"
                  style={{
                    backgroundColor: (BIAS_COLORS[c.suggested_label] ?? '#6b7280') + '22',
                    color:            BIAS_COLORS[c.suggested_label] ?? '#6b7280',
                  }}
                >
                  {labelDisplay(c.suggested_label)}
                </span>
                {c.notes && (
                  <span className="text-xs text-wp-text3 truncate max-w-[140px]" title={c.notes}>
                    {c.notes}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => void handleVote(c.id, 1)}
                  disabled={voting === c.id}
                  aria-label={`Upvote: ${labelDisplay(c.suggested_label)}`}
                  className="rounded px-1.5 py-0.5 text-xs text-green-400 hover:bg-green-400/10 disabled:opacity-40 transition-colors"
                >
                  ▲ {c.upvotes}
                </button>
                <button
                  onClick={() => void handleVote(c.id, -1)}
                  disabled={voting === c.id}
                  aria-label={`Downvote: ${labelDisplay(c.suggested_label)}`}
                  className="rounded px-1.5 py-0.5 text-xs text-red-400 hover:bg-red-400/10 disabled:opacity-40 transition-colors"
                >
                  ▼ {c.downvotes}
                </button>
                <span className="ml-1 text-xs text-wp-text3 min-w-[2rem] text-right">
                  {c.net_votes > 0 ? `+${c.net_votes}` : c.net_votes}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Success message */}
      {successMsg && (
        <p className="mb-2 text-xs text-green-400">{successMsg}</p>
      )}

      {/* Error message */}
      {error && (
        <p className="mb-2 text-xs text-red-400">{error}</p>
      )}

      {/* Suggest correction form */}
      {showForm ? (
        <form onSubmit={e => void handleSubmit(e)} className="space-y-2">
          <select
            value={formLabel}
            onChange={e => setFormLabel(e.target.value)}
            className="w-full rounded border border-white/10 bg-[#06070d] px-3 py-1.5 text-xs text-wp-text1 focus:border-amber-500/50 focus:outline-none"
            aria-label="Suggested bias label"
          >
            {BIAS_LABELS.map(b => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>
          <textarea
            value={formNotes}
            onChange={e => setFormNotes(e.target.value)}
            placeholder="Optional: explain your reasoning (max 500 chars)"
            maxLength={500}
            rows={2}
            className="w-full resize-none rounded border border-white/10 bg-[#06070d] px-3 py-1.5 text-xs text-wp-text1 placeholder-wp-text3 focus:border-amber-500/50 focus:outline-none"
            aria-label="Correction notes"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(null) }}
              className="rounded border border-white/10 px-3 py-1.5 text-xs text-wp-text3 hover:border-white/20 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => {
            if (!token) { setError('Log in to suggest a bias correction.'); return }
            setShowForm(true)
            setSuccessMsg(null)
            setError(null)
          }}
          className="w-full rounded border border-white/10 px-3 py-1.5 text-xs text-wp-text3 hover:border-amber-500/30 hover:text-amber-400 transition-colors"
        >
          + Suggest a correction
        </button>
      )}
    </div>
  )
}
