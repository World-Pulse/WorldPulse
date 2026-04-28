'use client'

import { useEffect, useState, useCallback } from 'react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface EmbedSignal {
  id: string
  title: string
  summary: string | null
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  category: string
  location_name: string | null
  country_code: string | null
  reliability_score: number
  created_at: string
  url: string
}

type Theme = 'dark' | 'light'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#3b82f6',
  info:     '#6b7280',
}

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'CRITICAL',
  high:     'HIGH',
  medium:   'MEDIUM',
  low:      'LOW',
  info:     'INFO',
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function reliabilityLabel(score: number): string {
  if (score >= 0.8) return '●●●●●'
  if (score >= 0.6) return '●●●●○'
  if (score >= 0.4) return '●●●○○'
  if (score >= 0.2) return '●●○○○'
  return '●○○○○'
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function EmbedPage() {
  const [signals, setSignals]     = useState<EmbedSignal[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [lastRefresh, setRefresh] = useState(Date.now())

  // Parse query params from URL (client-side only)
  const [ready, setReady] = useState(false)
  const [params, setParams] = useState<{
    theme: Theme
    limit: number
    category: string
    apiBase: string
  }>({ theme: 'dark', limit: 5, category: 'all', apiBase: '' })

  useEffect(() => {
    const sp         = new URLSearchParams(window.location.search)
    const theme      = (sp.get('theme') === 'light' ? 'light' : 'dark') as Theme
    const limit      = Math.min(Math.max(parseInt(sp.get('limit') ?? '5', 10) || 5, 1), 20)
    const category   = sp.get('category') ?? 'all'
    const apiBase    = sp.get('apiBase') ?? ''
    setParams({ theme, limit, category, apiBase })
    setReady(true)
  }, [])

  const fetchSignals = useCallback(async () => {
    try {
      const qs   = new URLSearchParams({ limit: String(params.limit), status: 'verified' })
      if (params.category && params.category !== 'all') qs.set('category', params.category)
      const base = params.apiBase || '/api/v1'
      const res  = await fetch(`${base}/signals?${qs.toString()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { signals: EmbedSignal[] }
      setSignals(data.signals ?? [])
      setError(null)
    } catch (err) {
      setError('Unable to load signals')
    } finally {
      setLoading(false)
    }
  }, [params.limit, params.category, params.apiBase])

  // Initial fetch + 30s polling — wait until URL params are hydrated
  useEffect(() => {
    if (!ready) return
    fetchSignals()
    const iv = setInterval(() => {
      fetchSignals()
      setRefresh(Date.now())
    }, 30_000)
    return () => clearInterval(iv)
  }, [fetchSignals, ready])

  const { theme } = params
  const isDark = theme === 'dark'

  const css = {
    bg:           isDark ? '#06070d' : '#ffffff',
    border:       isDark ? '#1e2028' : '#e5e7eb',
    cardBg:       isDark ? '#0d0e17' : '#f9fafb',
    cardBorder:   isDark ? '#1a1c28' : '#e5e7eb',
    text:         isDark ? '#e2e8f0' : '#111827',
    textMuted:    isDark ? '#64748b' : '#6b7280',
    headerBg:     isDark ? '#0a0b12' : '#f3f4f6',
    accent:       '#f59e0b',
    link:         isDark ? '#93c5fd' : '#2563eb',
  }

  return (
    <div style={{
      background:  css.bg,
      color:       css.text,
      width:       '100%',
      height:      '100vh',
      overflow:    'hidden',
      display:     'flex',
      flexDirection: 'column',
      fontFamily:  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize:    '13px',
    }}>
      {/* Header */}
      <div style={{
        background:     css.headerBg,
        borderBottom:   `1px solid ${css.border}`,
        padding:        '8px 12px',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        flexShrink:     0,
      }}>
        <a
          href="https://worldpulse.io"
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <span style={{ color: css.accent, fontWeight: 700, fontSize: 14 }}>⚡</span>
          <span style={{ color: css.text, fontWeight: 700, fontSize: 13, letterSpacing: '0.02em' }}>
            WorldPulse
          </span>
        </a>
        <span style={{ color: css.textMuted, fontSize: 11 }}>
          {loading ? 'Loading…' : `${signals.length} signals`}
        </span>
      </div>

      {/* Signal list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
        {loading && (
          <div style={{ padding: 16, textAlign: 'center', color: css.textMuted }}>
            Loading signals…
          </div>
        )}
        {error && (
          <div style={{ padding: 16, textAlign: 'center', color: '#ef4444', fontSize: 12 }}>
            {error}
          </div>
        )}
        {!loading && !error && signals.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', color: css.textMuted }}>
            No signals found.
          </div>
        )}
        {signals.map((sig) => (
          <a
            key={sig.id}
            href={`https://worldpulse.io/signals/${sig.id}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display:       'block',
              textDecoration:'none',
              color:          css.text,
              background:     css.cardBg,
              border:         `1px solid ${css.cardBorder}`,
              borderLeft:     `3px solid ${SEVERITY_COLOR[sig.severity] ?? '#6b7280'}`,
              borderRadius:   6,
              padding:        '8px 10px',
              marginBottom:   5,
              transition:     'opacity 0.15s',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.opacity = '0.8')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.opacity = '1')}
          >
            {/* Title row */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
              <span style={{
                background:   SEVERITY_COLOR[sig.severity] ?? '#6b7280',
                color:        '#000',
                fontSize:     9,
                fontWeight:   700,
                padding:      '1px 4px',
                borderRadius: 3,
                flexShrink:   0,
                marginTop:    1,
              }}>
                {SEVERITY_LABEL[sig.severity] ?? sig.severity.toUpperCase()}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.35, color: css.text }}>
                {sig.title}
              </span>
            </div>

            {/* Meta row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {sig.location_name && (
                <span style={{ color: css.textMuted, fontSize: 11 }}>
                  📍 {sig.location_name}
                  {sig.country_code ? ` (${sig.country_code})` : ''}
                </span>
              )}
              <span style={{ color: css.textMuted, fontSize: 11 }}>
                {timeAgo(sig.created_at)}
              </span>
              <span style={{ color: css.accent, fontSize: 11, letterSpacing: '0.05em' }}>
                {reliabilityLabel(sig.reliability_score)}
              </span>
            </div>
          </a>
        ))}
      </div>

      {/* Footer */}
      <div style={{
        borderTop:      `1px solid ${css.border}`,
        padding:        '5px 12px',
        display:        'flex',
        justifyContent: 'space-between',
        alignItems:     'center',
        flexShrink:     0,
        background:     css.headerBg,
      }}>
        <span style={{ color: css.textMuted, fontSize: 10 }}>
          Refreshes every 30s
        </span>
        <a
          href="https://worldpulse.io"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: css.link, fontSize: 10, textDecoration: 'none' }}
        >
          Open WorldPulse →
        </a>
      </div>
    </div>
  )
}
