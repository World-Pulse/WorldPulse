'use client'

import { useState } from 'react'

export interface PollDraft {
  question:  string
  options:   string[]
  expiresAt: string  // ISO datetime string, empty = no expiry
}

interface PollCreatorProps {
  value:    PollDraft
  onChange: (draft: PollDraft) => void
  onClose:  () => void
}

const EXPIRY_OPTIONS = [
  { label: '1 hour',  value: () => addHours(1) },
  { label: '6 hours', value: () => addHours(6) },
  { label: '1 day',   value: () => addHours(24) },
  { label: '3 days',  value: () => addHours(72) },
  { label: '7 days',  value: () => addHours(168) },
  { label: 'No expiry', value: () => '' },
]

function addHours(n: number): string {
  return new Date(Date.now() + n * 3600_000).toISOString()
}

export function PollCreator({ value, onChange, onClose }: PollCreatorProps) {
  const [expiryLabel, setExpiryLabel] = useState('1 day')

  const setQuestion = (q: string) => onChange({ ...value, question: q })

  const setOption = (i: number, text: string) => {
    const opts = [...value.options]
    opts[i] = text
    onChange({ ...value, options: opts })
  }

  const addOption = () => {
    if (value.options.length < 4) {
      onChange({ ...value, options: [...value.options, ''] })
    }
  }

  const removeOption = (i: number) => {
    if (value.options.length <= 2) return
    const opts = value.options.filter((_, idx) => idx !== i)
    onChange({ ...value, options: opts })
  }

  const setExpiry = (label: string, getValue: () => string) => {
    setExpiryLabel(label)
    onChange({ ...value, expiresAt: getValue() })
  }

  return (
    <div
      className="mt-2 border border-[rgba(245,166,35,0.25)] rounded-xl bg-[rgba(245,166,35,0.04)] p-4"
      role="group"
      aria-label="Poll creator"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-wp-amber text-[14px]">📊</span>
          <span className="font-mono text-[10px] tracking-[2px] text-wp-amber uppercase">Create Poll</span>
        </div>
        <button
          onClick={onClose}
          aria-label="Remove poll"
          className="text-wp-text3 hover:text-wp-text text-[16px] leading-none transition-colors"
        >
          ×
        </button>
      </div>

      {/* Question */}
      <input
        type="text"
        value={value.question}
        onChange={e => setQuestion(e.target.value)}
        placeholder="Ask a question…"
        maxLength={500}
        aria-label="Poll question"
        className="w-full bg-wp-s2 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[14px] text-wp-text placeholder-wp-text3 outline-none focus:border-[rgba(245,166,35,0.4)] transition-colors mb-3"
      />

      {/* Options */}
      <div className="space-y-2 mb-3">
        {value.options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-wp-text3 w-4 flex-shrink-0">{i + 1}.</span>
            <input
              type="text"
              value={opt}
              onChange={e => setOption(i, e.target.value)}
              placeholder={`Option ${i + 1}`}
              maxLength={200}
              aria-label={`Poll option ${i + 1}`}
              className="flex-1 bg-wp-s2 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-[7px] text-[13px] text-wp-text placeholder-wp-text3 outline-none focus:border-[rgba(245,166,35,0.4)] transition-colors"
            />
            {value.options.length > 2 && (
              <button
                onClick={() => removeOption(i)}
                aria-label={`Remove option ${i + 1}`}
                className="text-wp-text3 hover:text-wp-red transition-colors text-[16px] leading-none flex-shrink-0"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Add option */}
      {value.options.length < 4 && (
        <button
          onClick={addOption}
          className="w-full py-[7px] rounded-lg border border-dashed border-[rgba(255,255,255,0.12)] text-wp-text3 text-[12px] hover:border-[rgba(245,166,35,0.3)] hover:text-wp-amber transition-all mb-3"
          aria-label="Add poll option"
        >
          + Add option
        </button>
      )}

      {/* Expiry */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[10px] text-wp-text3">Expires:</span>
        {EXPIRY_OPTIONS.map(opt => (
          <button
            key={opt.label}
            onClick={() => setExpiry(opt.label, opt.value)}
            className={`px-3 py-1 rounded-full text-[11px] border transition-all
              ${expiryLabel === opt.label
                ? 'border-wp-amber text-wp-amber bg-[rgba(245,166,35,0.12)]'
                : 'border-[rgba(255,255,255,0.1)] text-wp-text3 hover:border-[rgba(255,255,255,0.2)] hover:text-wp-text2'
              }`}
            aria-pressed={expiryLabel === opt.label}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
