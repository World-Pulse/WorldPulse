'use client'

/**
 * Report a post or a community (plan C6; Devon, Oct 21, 2026: "Yes, add the
 * table"): a signed-in reader picks a reason and may add a note; the API
 * (POST /api/v1/posts/:id/report, /communities/:id/report) keeps one report
 * per reader, and anything 3 or more readers report goes on the /admin
 * review list. Nothing is hidden automatically.
 */

import { useState } from 'react'
import Link from 'next/link'
import { authHref } from '@/lib/auth-next'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export type ReportTargetType = 'post' | 'community'

const REASONS: Array<{ value: 'spam' | 'abuse' | 'misinformation' | 'other'; label: string; description: string }> = [
  { value: 'spam',           label: 'Spam',           description: 'Adverts, scams, the same thing posted again and again' },
  { value: 'abuse',          label: 'Abuse',          description: 'Harassment, hate or threats' },
  { value: 'misinformation', label: 'Misinformation', description: 'Deliberately false or manipulated information' },
  { value: 'other',          label: 'Something else', description: 'Tell us in the note' },
]

/** The API's address for a report of this post or community */
export function reportUrl(type: ReportTargetType, id: string): string {
  return `${API_URL}/api/v1/${type === 'post' ? 'posts' : 'communities'}/${encodeURIComponent(id)}/report`
}

export function ReportModal({ type, id, onClose }: { type: ReportTargetType; id: string; onClose: () => void }) {
  const [reason, setReason] = useState<(typeof REASONS)[number]['value'] | null>(null)
  const [note, setNote] = useState('')
  const [state, setState] = useState<'form' | 'sending' | 'done'>('form')
  const [error, setError] = useState<string | null>(null)
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('wp_access_token') : null
  const noun = type === 'post' ? 'post' : 'community'

  async function send() {
    if (!reason || !token) return
    setState('sending')
    setError(null)
    try {
      const res = await fetch(reportUrl(type, id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason, note: note.trim() || undefined }),
      })
      if (res.status === 409) { setError(`You have already reported this ${noun}.`); setState('form'); return }
      if (!res.ok) { setError('The report could not be sent. Try again.'); setState('form'); return }
      setState('done')
    } catch {
      setError('The report could not be sent. Try again.')
      setState('form')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Report this ${noun}`}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-[400px] rounded-2xl bg-[#0d1117] border border-white/[0.10] shadow-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="font-semibold text-[15px] text-wp-text">Report this {noun}</div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-wp-text3 hover:text-wp-text hover:bg-white/[0.06] text-[18px] leading-none" aria-label="Close">×</button>
        </div>
        {!token ? (
          <p className="text-[13px] text-wp-text2">
            <Link href={authHref('login')} className="text-wp-amber underline">Sign in</Link> to report a {noun}.
          </p>
        ) : state === 'done' ? (
          <div className="py-4 text-center space-y-2">
            <div className="text-[14px] font-medium text-wp-green">Thank you: your report is in.</div>
            <div className="text-[12px] text-wp-text3">When several readers report the same {noun}, it is reviewed.</div>
            <button onClick={onClose} className="mt-3 px-4 py-2 rounded-full border border-white/10 text-[12px] text-wp-text2 hover:text-wp-text">Close</button>
          </div>
        ) : (
          <>
            <div className="space-y-2 mb-3">
              {REASONS.map(r => (
                <button key={r.value} type="button" onClick={() => setReason(r.value)} aria-pressed={reason === r.value}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all ${reason === r.value
                    ? 'border-wp-amber/50 bg-wp-amber/10 text-wp-text' : 'border-white/[0.07] bg-white/[0.02] text-wp-text2 hover:border-white/[0.14]'}`}>
                  <div className="font-medium text-[13px]">{r.label}</div>
                  <div className="text-[11px] text-wp-text3 mt-0.5">{r.description}</div>
                </button>
              ))}
            </div>
            <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={500} rows={2} placeholder="A note (optional)"
              className="w-full mb-3 bg-white/[0.03] border border-white/[0.08] rounded-xl px-3 py-2 text-[13px] text-wp-text placeholder:text-wp-text3 focus:outline-none focus:border-wp-amber/50" />
            {error && <p role="alert" className="mb-3 text-[12px] text-wp-red">{error}</p>}
            <button type="button" onClick={() => { void send() }} disabled={!reason || state === 'sending'}
              className="w-full py-2.5 rounded-xl bg-wp-amber text-black font-bold text-[13px] disabled:opacity-50">
              {state === 'sending' ? 'Sending…' : 'Send the report'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
