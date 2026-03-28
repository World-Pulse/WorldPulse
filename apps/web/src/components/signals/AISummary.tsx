'use client'

import { useState } from 'react'

interface AISummaryData {
  text:        string
  model:       'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'ollama' | 'extractive'
  generatedAt: string
}

interface AISummaryProps {
  signalId:   string
  aiSummary:  AISummaryData | null | undefined
  isAdmin?:   boolean
}

const MODEL_LABELS: Record<AISummaryData['model'], string> = {
  anthropic:  'Claude (Anthropic)',
  openai:     'GPT-4o mini',
  gemini:     'Gemini Flash',
  openrouter: 'OpenRouter',
  ollama:     'Local AI (Ollama)',
  extractive: 'Auto-summary',
}

const MODEL_ICONS: Record<AISummaryData['model'], string> = {
  anthropic:  '🟠',
  openai:     '🟢',
  gemini:     '🔵',
  openrouter: '🟣',
  ollama:     '🏠',
  extractive: '📝',
}

const PROVIDER_COLORS: Record<AISummaryData['model'], { bg: string; text: string }> = {
  anthropic:  { bg: 'rgba(251,191,36,0.15)',  text: '#f97316' },
  openai:     { bg: 'rgba(34,197,94,0.15)',   text: '#22c55e' },
  gemini:     { bg: 'rgba(59,130,246,0.15)',  text: '#3b82f6' },
  openrouter: { bg: 'rgba(168,85,247,0.15)',  text: '#a855f7' },
  ollama:     { bg: 'rgba(6,182,212,0.15)',   text: '#06b6d4' },
  extractive: { bg: 'rgba(100,116,139,0.15)', text: '#94a3b8' },
}

export function AISummary({ signalId, aiSummary: initialSummary, isAdmin }: AISummaryProps) {
  const [summary, setSummary]     = useState<AISummaryData | null>(initialSummary ?? null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [expanded, setExpanded]   = useState(false)

  // If no summary yet (e.g., list view without aiSummary), load on expand
  const handleExpand = async () => {
    if (summary) {
      setExpanded(v => !v)
      return
    }
    setExpanded(true)
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/signals/${signalId}/summary`)
      if (!res.ok) throw new Error('Failed to load summary')
      const data = await res.json() as { success: boolean; data: { aiSummary: AISummaryData } }
      setSummary(data.data.aiSummary)
    } catch {
      setError('Could not load AI summary')
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/signals/${signalId}/summary?refresh=true`)
      if (!res.ok) throw new Error('Failed to refresh summary')
      const data = await res.json() as { success: boolean; data: { aiSummary: AISummaryData } }
      setSummary(data.data.aiSummary)
    } catch {
      setError('Could not refresh AI summary')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border border-blue-200/60 bg-blue-50/40 dark:border-blue-900/40 dark:bg-blue-950/20 overflow-hidden">
      {/* Header bar — always visible */}
      <button
        onClick={handleExpand}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100/50 dark:hover:bg-blue-900/30 transition-colors"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2">
          {/* Sparkle icon */}
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
          AI Summary
          {summary && (
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
              style={{
                background: PROVIDER_COLORS[summary.model].bg,
                color:      PROVIDER_COLORS[summary.model].text,
              }}
            >
              {MODEL_ICONS[summary.model]} {MODEL_LABELS[summary.model]}
            </span>
          )}
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expandable body */}
      {expanded && (
        <div className="px-4 pb-4 pt-1">
          {loading && (
            <div className="space-y-2 animate-pulse">
              <div className="h-3 bg-blue-200/60 dark:bg-blue-800/40 rounded w-full" />
              <div className="h-3 bg-blue-200/60 dark:bg-blue-800/40 rounded w-5/6" />
              <div className="h-3 bg-blue-200/60 dark:bg-blue-800/40 rounded w-4/6" />
            </div>
          )}

          {error && !loading && (
            <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
          )}

          {summary && !loading && (
            <>
              <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                {summary.text}
              </p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-gray-400 dark:text-gray-500">
                  Generated {new Date(summary.generatedAt).toLocaleString()}
                </span>
                {isAdmin && (
                  <button
                    onClick={handleRefresh}
                    disabled={loading}
                    className="text-[11px] text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors disabled:opacity-50"
                  >
                    ↻ Refresh summary
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
