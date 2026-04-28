'use client'

// ─── Risk Score Gauge ─────────────────────────────────────────────────────────
// Visual gauge for the geopolitical risk score (0-100).
// Competes with WorldMonitor strategic risk scoring feature.

interface RiskScoreGaugeProps {
  score: number   // 0-100
  level: string   // "critical"|"high"|"medium"|"low"
  label: string   // e.g. "High Risk · 72"
  size?: 'sm' | 'md'
}

const LEVEL_COLOR: Record<string, string> = {
  critical: '#ff3b5c',
  high:     '#f5a623',
  medium:   '#f0c040',
  low:      '#00e676',
}

const LEVEL_BG: Record<string, string> = {
  critical: 'rgba(255,59,92,0.12)',
  high:     'rgba(245,166,35,0.12)',
  medium:   'rgba(240,192,64,0.12)',
  low:      'rgba(0,230,118,0.12)',
}

// Compact badge (sm) — just score + colored pill, for feed cards
function SmGauge({ score, level, label }: { score: number; level: string; label: string }) {
  const color = LEVEL_COLOR[level] ?? '#f5a623'
  const bg    = LEVEL_BG[level]   ?? 'rgba(245,166,35,0.12)'
  return (
    <span
      title={label}
      className="inline-flex items-center gap-[5px] px-2 py-0.5 rounded font-mono text-[9px] tracking-widest uppercase"
      style={{ background: bg, color, border: `1px solid ${color}33` }}
    >
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
        <circle cx="4" cy="4" r="3" fill="none" stroke={color} strokeWidth="1.5" opacity="0.4" />
        <circle cx="4" cy="4" r="3" fill="none" stroke={color} strokeWidth="1.5"
          strokeDasharray={`${(score / 100) * 18.85} 18.85`}
          strokeLinecap="round"
          style={{ transform: 'rotate(-90deg)', transformOrigin: '4px 4px' }}
        />
      </svg>
      {score}
    </span>
  )
}

// Full gauge (md) — bar + score + level badge for detail page
function MdGauge({ score, level, label }: { score: number; level: string; label: string }) {
  const color = LEVEL_COLOR[level] ?? '#f5a623'
  const bg    = LEVEL_BG[level]   ?? 'rgba(245,166,35,0.12)'

  // Semicircular SVG arc: r=36, circumference half = π*36 ≈ 113.1
  const R = 36
  const halfCirc = Math.PI * R  // ≈ 113.097
  const dash = (score / 100) * halfCirc

  return (
    <div
      className="p-4 rounded-xl border space-y-3"
      style={{ borderColor: `${color}22`, background: bg }}
      aria-label={label}
    >
      <div className="font-mono text-[10px] tracking-widest uppercase" style={{ color, opacity: 0.7 }}>
        Risk Score
      </div>

      {/* Semicircular gauge */}
      <div className="flex flex-col items-center gap-2">
        <svg width="96" height="54" viewBox="0 0 96 54" aria-hidden="true">
          {/* Track */}
          <path
            d="M8,48 A40,40 0 0,1 88,48"
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="6"
            strokeLinecap="round"
          />
          {/* Progress arc — strokeDasharray on a path of known length */}
          <path
            d="M8,48 A40,40 0 0,1 88,48"
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${halfCirc}`}
          />
          {/* Score label */}
          <text
            x="48" y="44"
            textAnchor="middle"
            fill={color}
            fontSize="20"
            fontFamily="monospace"
            fontWeight="bold"
          >
            {score}
          </text>
        </svg>

        {/* Level badge */}
        <span
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-mono text-[10px] tracking-widest uppercase font-semibold"
          style={{ background: `${color}20`, color, border: `1px solid ${color}44` }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
          {level} risk
        </span>
      </div>

      {/* Bar breakdown */}
      <div className="h-1.5 bg-white/[0.07] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${score}%`, background: color }}
        />
      </div>
    </div>
  )
}

export function RiskScoreGauge({ score, level, label, size = 'md' }: RiskScoreGaugeProps) {
  if (size === 'sm') return <SmGauge score={score} level={level} label={label} />
  return <MdGauge score={score} level={level} label={label} />
}
