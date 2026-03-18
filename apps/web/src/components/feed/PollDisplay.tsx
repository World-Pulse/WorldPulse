'use client'

import { useState, useEffect, useCallback } from 'react'
import type { PollData } from '@worldpulse/types'

interface PollOption {
  text:  string
  votes: number
}

interface PollInfo {
  id:         string
  question:   string
  options:    PollOption[]
  totalVotes: number
  expiresAt:  string | null
  ended:      boolean
  userVote:   number | null
}

interface PollDisplayProps {
  poll:       PollData
  pollId?:    string  // if provided, enables live vote fetching and submission
  postId?:    string
}

function formatTimeRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return 'Ended'
  const hours   = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  if (hours >= 24) return `${Math.floor(hours / 24)}d remaining`
  if (hours > 0)   return `${hours}h ${minutes}m remaining`
  return `${minutes}m remaining`
}

export function PollDisplay({ poll, pollId, postId }: PollDisplayProps) {
  const [state, setState] = useState<PollInfo>({
    id:         pollId ?? '',
    question:   '',
    options:    poll.options,
    totalVotes: poll.totalVotes,
    expiresAt:  poll.endsAt,
    ended:      poll.ended,
    userVote:   null,
  })
  const [voting, setVoting]     = useState(false)
  const [timeStr, setTimeStr]   = useState<string>('')
  const [error, setError]       = useState<string | null>(null)

  // Update time remaining every 30s
  useEffect(() => {
    if (!state.expiresAt) return
    const update = () => setTimeStr(formatTimeRemaining(state.expiresAt!))
    update()
    const id = setInterval(update, 30_000)
    return () => clearInterval(id)
  }, [state.expiresAt])

  // Fetch fresh poll data if pollId provided
  const fetchPoll = useCallback(async () => {
    if (!pollId) return
    try {
      const res = await fetch(`/api/v1/polls/${pollId}`, { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json() as { success: boolean; data: PollInfo }
      if (data.success) setState(data.data)
    } catch {
      // silent — use optimistic state
    }
  }, [pollId])

  useEffect(() => {
    void fetchPoll()
  }, [fetchPoll])

  const handleVote = async (optionIndex: number) => {
    if (!pollId || state.userVote !== null || state.ended || voting) return
    setVoting(true)
    setError(null)

    // Optimistic update
    const prev = { ...state }
    setState(s => {
      const opts = s.options.map((o, i) => i === optionIndex ? { ...o, votes: o.votes + 1 } : o)
      return { ...s, options: opts, totalVotes: s.totalVotes + 1, userVote: optionIndex }
    })

    try {
      const res = await fetch(`/api/v1/polls/${pollId}/vote`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ optionIndex }),
      })
      const data = await res.json() as { success: boolean; data?: PollInfo; error?: string }
      if (!res.ok || !data.success) {
        // Revert optimistic update
        setState(prev)
        setError(data.error ?? 'Failed to submit vote')
      } else if (data.data) {
        setState(data.data)
      }
    } catch {
      setState(prev)
      setError('Network error — please try again')
    } finally {
      setVoting(false)
    }
  }

  const showResults = state.userVote !== null || state.ended
  const total = state.totalVotes > 0 ? state.totalVotes : 1

  return (
    <div
      className="bg-wp-s2 border border-[rgba(255,255,255,0.07)] rounded-xl p-4 my-2"
      role="group"
      aria-label={`Poll: ${state.question || 'Community poll'}`}
    >
      {/* Question */}
      {state.question && (
        <p className="text-[14px] font-semibold text-wp-text mb-3 leading-snug">
          {state.question}
        </p>
      )}

      {/* Options */}
      <div className="space-y-2">
        {state.options.map((opt, i) => {
          const pct      = Math.round((opt.votes / total) * 100)
          const isVoted  = state.userVote === i
          const isWinner = showResults && opt.votes === Math.max(...state.options.map(o => o.votes))

          return showResults ? (
            // Results bar
            <div
              key={i}
              className={`relative rounded-lg overflow-hidden transition-all ${isVoted ? 'ring-1 ring-wp-amber' : ''}`}
              aria-label={`${opt.text}: ${pct}%`}
            >
              {/* Fill bar */}
              <div
                className={`absolute inset-0 rounded-lg transition-all duration-700 ${isWinner ? 'bg-[rgba(245,166,35,0.15)]' : 'bg-[rgba(255,255,255,0.05)]'}`}
                style={{ width: `${pct}%` }}
                aria-hidden="true"
              />
              <div className="relative flex items-center justify-between px-3 py-[10px]">
                <div className="flex items-center gap-2">
                  {isVoted && (
                    <span className="text-wp-amber text-[11px]" aria-hidden="true">✓</span>
                  )}
                  <span className="text-[13px] text-wp-text">{opt.text}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`font-mono text-[11px] font-bold ${isWinner ? 'text-wp-amber' : 'text-wp-text2'}`}>
                    {pct}%
                  </span>
                  <span className="font-mono text-[10px] text-wp-text3">
                    ({opt.votes.toLocaleString()})
                  </span>
                </div>
              </div>
            </div>
          ) : (
            // Voteable button
            <button
              key={i}
              onClick={() => handleVote(i)}
              disabled={voting || state.ended}
              aria-label={`Vote for: ${opt.text}`}
              className={`w-full text-left px-3 py-[10px] rounded-lg border text-[13px] transition-all
                border-[rgba(255,255,255,0.1)] text-wp-text2
                hover:border-wp-amber hover:text-wp-amber hover:bg-[rgba(245,166,35,0.06)]
                disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {opt.text}
            </button>
          )
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-[rgba(255,255,255,0.05)]">
        <span className="font-mono text-[10px] text-wp-text3">
          {state.totalVotes.toLocaleString()} {state.totalVotes === 1 ? 'vote' : 'votes'}
        </span>
        {state.expiresAt && (
          <span className={`font-mono text-[10px] ${state.ended ? 'text-wp-red' : 'text-wp-text3'}`}>
            {state.ended ? 'Poll ended' : timeStr}
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <p role="alert" className="text-wp-red text-[11px] mt-2">
          {error}
        </p>
      )}
    </div>
  )
}
