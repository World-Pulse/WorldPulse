'use client'

// ─── Types (mirrored from API source-bias lib) ────────────────────────────────

export type BiasLabel =
  | 'far-left'
  | 'left'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'right'
  | 'far-right'
  | 'unknown'

interface BiasIndicatorProps {
  biasLabel:  BiasLabel
  confidence: 'high' | 'medium' | 'low'
}

// ─── Color map ────────────────────────────────────────────────────────────────

const BIAS_COLOR: Record<BiasLabel, string> = {
  'far-left':    '#6366f1',
  'left':        '#3b82f6',
  'center-left': '#22d3ee',
  'center':      '#6b7280',
  'center-right':'#f97316',
  'right':       '#ef4444',
  'far-right':   '#dc2626',
  'unknown':     '#6b7280',
}

const BIAS_LABEL_TEXT: Record<BiasLabel, string> = {
  'far-left':    'far left',
  'left':        'left',
  'center-left': 'center left',
  'center':      'center',
  'center-right':'center right',
  'right':       'right',
  'far-right':   'far right',
  'unknown':     'unknown',
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * BiasIndicator — renders a small pill showing the media bias label.
 * Returns null when confidence is 'low' or label is 'unknown' to avoid
 * cluttering the UI with low-signal information.
 */
export function BiasIndicator({ biasLabel, confidence }: BiasIndicatorProps) {
  if (confidence === 'low' || biasLabel === 'unknown') return null

  const color = BIAS_COLOR[biasLabel]
  const text  = BIAS_LABEL_TEXT[biasLabel]

  return (
    <span
      className="inline-flex items-center gap-[3px] font-mono text-[10px] text-wp-text3"
      title={`Source media bias: ${text}`}
      aria-label={`Media bias: ${text}`}
    >
      <span
        className="w-[5px] h-[5px] rounded-full flex-shrink-0"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span style={{ color }}>{text}</span>
    </span>
  )
}
