'use client'

import { useState, useCallback } from 'react'

export interface ReputationPoint {
  date: string   // ISO date string YYYY-MM-DD
  score: number  // 0–100
}

interface Props {
  data: ReputationPoint[]
}

const W   = 600
const H   = 180
const PAD = { top: 20, right: 20, bottom: 36, left: 44 }
const CW  = W - PAD.left - PAD.right
const CH  = H - PAD.top  - PAD.bottom

export function ReputationChart({ data }: Props) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center h-[180px] text-wp-text3 text-[13px]">
        Not enough data to display
      </div>
    )
  }

  const scores   = data.map(d => d.score)
  const minScore = Math.max(0,   Math.min(...scores) - 8)
  const maxScore = Math.min(100, Math.max(...scores) + 8)
  const range    = maxScore - minScore || 1

  const toX = (i: number) => PAD.left + (i / (data.length - 1)) * CW
  const toY = (v: number) => PAD.top + ((maxScore - v) / range) * CH

  const linePath = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(d.score).toFixed(1)}`)
    .join(' ')

  const areaPath =
    `${linePath} ` +
    `L ${toX(data.length - 1).toFixed(1)} ${(H - PAD.bottom).toFixed(1)} ` +
    `L ${PAD.left.toFixed(1)} ${(H - PAD.bottom).toFixed(1)} Z`

  // Y-axis grid lines at 25-point intervals within range
  const gridValues = [0, 25, 50, 75, 100].filter(v => v >= minScore - 2 && v <= maxScore + 2)

  // X-axis label indices — show ~6 evenly spaced
  const labelIndices = Array.from({ length: data.length }, (_, i) => i).filter(
    i => i % Math.ceil(data.length / 6) === 0 || i === data.length - 1,
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const svgX = ((e.clientX - rect.left) / rect.width) * W
      let closest = 0
      let closestDist = Infinity
      data.forEach((_, i) => {
        const dist = Math.abs(toX(i) - svgX)
        if (dist < closestDist) { closestDist = dist; closest = i }
      })
      setHoveredIdx(closest)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  )

  const hov = hoveredIdx !== null ? data[hoveredIdx] : null
  const hovX = hoveredIdx !== null ? toX(hoveredIdx) : 0
  const hovY = hoveredIdx !== null ? toY(data[hoveredIdx].score) : 0

  // Tooltip box: flip to left side if too close to right edge
  const tipOnLeft = hoveredIdx !== null && hoveredIdx > data.length * 0.65

  return (
    <div className="w-full select-none">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 180 }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredIdx(null)}
      >
        <defs>
          <linearGradient id="repGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#f5a623" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#f5a623" stopOpacity="0"    />
          </linearGradient>
          <clipPath id="repClip">
            <rect x={PAD.left} y={PAD.top} width={CW} height={CH} />
          </clipPath>
        </defs>

        {/* Grid lines + Y labels */}
        {gridValues.map(v => (
          <g key={v}>
            <line
              x1={PAD.left} y1={toY(v)}
              x2={W - PAD.right} y2={toY(v)}
              stroke="rgba(255,255,255,0.06)" strokeWidth="1"
            />
            <text
              x={PAD.left - 6} y={toY(v) + 4}
              textAnchor="end" fontSize="10" fill="#6b7280"
            >
              {v}%
            </text>
          </g>
        ))}

        {/* Area fill */}
        <path d={areaPath} fill="url(#repGrad)" clipPath="url(#repClip)" />

        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke="#f5a623"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          clipPath="url(#repClip)"
        />

        {/* Hover crosshair */}
        {hoveredIdx !== null && (
          <line
            x1={hovX} y1={PAD.top}
            x2={hovX} y2={H - PAD.bottom}
            stroke="rgba(255,255,255,0.15)"
            strokeWidth="1"
            strokeDasharray="3,3"
          />
        )}

        {/* Data points */}
        {data.map((d, i) => (
          <circle
            key={i}
            cx={toX(i)} cy={toY(d.score)}
            r={hoveredIdx === i ? 5 : 3}
            fill="#f5a623"
            stroke={hoveredIdx === i ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.5)'}
            strokeWidth={hoveredIdx === i ? 2 : 1}
          />
        ))}

        {/* Hover tooltip (SVG) */}
        {hov !== null && hoveredIdx !== null && (
          <>
            <rect
              x={tipOnLeft ? hovX - 70 : hovX + 8}
              y={Math.max(PAD.top, hovY - 22)}
              width={60} height={36}
              rx={6}
              fill="#141622"
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="1"
            />
            <text
              x={tipOnLeft ? hovX - 40 : hovX + 38}
              y={Math.max(PAD.top + 14, hovY - 8)}
              textAnchor="middle" fontSize="12" fontWeight="bold" fill="#f5a623"
            >
              {hov.score}%
            </text>
            <text
              x={tipOnLeft ? hovX - 40 : hovX + 38}
              y={Math.max(PAD.top + 26, hovY + 4)}
              textAnchor="middle" fontSize="10" fill="#9ca3af"
            >
              {new Date(hov.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </text>
          </>
        )}

        {/* X axis labels */}
        {labelIndices.map(i => (
          <text
            key={i}
            x={toX(i)} y={H - 4}
            textAnchor="middle" fontSize="10" fill="#6b7280"
          >
            {new Date(data[i].date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
          </text>
        ))}
      </svg>
    </div>
  )
}

/** Generate synthetic 12-month reputation history from a current trust score (0–1). */
export function generateReputationHistory(currentScore: number): ReputationPoint[] {
  const pct = Math.round(currentScore * 100)
  const baseline = Math.max(20, pct - 18)
  const points: ReputationPoint[] = []
  const now = new Date()

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    const progress = (11 - i) / 11
    const trend = baseline + (pct - baseline) * progress
    // Deterministic noise using sine so it looks natural
    const noise = Math.sin(i * 2.1 + 0.5) * 3
    const score = Math.round(Math.max(0, Math.min(100, trend + noise)))
    points.push({ date: d.toISOString().slice(0, 10), score })
  }

  return points
}
