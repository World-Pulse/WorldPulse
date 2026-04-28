'use client'

/**
 * HotspotLabels.tsx
 * BAT-16 — Floating hotspot labels on the map at zoom > 5
 *
 * Renders projected overlay labels for geographic convergence hotspots so that
 * the densest signal zones are named on the map surface itself, instead of
 * being hidden in the side panel.
 *
 * Each label shows:
 *   - Location description (from sampleTitles or fallback lat/lng)
 *   - Signal count + dominant category
 *   - Mini severity breakdown bar
 *
 * Collision detection: labels are sorted by signalCount descending and a
 * simple spatial grid rejects any label whose projected position would
 * overlap an already-placed label (within COLLISION_RADIUS pixels).
 */

import { useEffect, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

// ── Types ────────────────────────────────────────────────────────────────────

export interface HotspotForLabel {
  centerLat:      number
  centerLng:      number
  signalCount:    number
  categoryCount:  number
  categories:     string[]
  maxSeverity:    string
  avgReliability: number
  latestSignalAt: string | null
  sampleTitles:   string[]
  sampleIds:      string[]
}

interface ProjectedLabel extends HotspotForLabel {
  px: number
  py: number
}

// ── Constants ────────────────────────────────────────────────────────────────

const MIN_ZOOM        = 5      // labels hidden below this zoom
const COLLISION_RADIUS = 140   // minimum pixel distance between label centres
const MAX_LABELS      = 6      // cap to avoid visual noise at busy zoom levels

const SEV_COLOR: Record<string, string> = {
  critical: '#ff3b5c',
  high:     '#f97316',
  medium:   '#fbbf24',
  low:      '#8892a4',
  info:     '#4b5563',
}

const CAT_EMOJI: Record<string, string> = {
  conflict:    '⚔️',
  climate:     '🌡️',
  health:      '🏥',
  security:    '🛡️',
  geopolitics: '🌐',
  economy:     '📈',
  disaster:    '🌊',
  technology:  '💻',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function categoryEmoji(categories: string[]): string {
  for (const cat of categories) {
    if (CAT_EMOJI[cat]) return CAT_EMOJI[cat]
  }
  return '⚡'
}

function shortLocation(hs: HotspotForLabel): string {
  // Best effort: grab location name from first sample title if it contains
  // a dash-separated location like "Ukraine — Shelling..."
  const title = hs.sampleTitles[0] ?? ''
  const parts = title.split(/[—–-]/)
  const loc   = parts[0]?.trim() ?? ''
  if (loc && loc.length > 3 && loc.length < 30) return loc
  return `${hs.centerLat.toFixed(1)}°, ${hs.centerLng.toFixed(1)}°`
}

/** Remove overlapping labels using a greedy spatial sweep. */
function decollidedLabels(labels: ProjectedLabel[]): ProjectedLabel[] {
  const placed: ProjectedLabel[] = []
  for (const label of labels) {
    const overlaps = placed.some(p => {
      const dx = p.px - label.px
      const dy = p.py - label.py
      return Math.sqrt(dx * dx + dy * dy) < COLLISION_RADIUS
    })
    if (!overlaps) placed.push(label)
    if (placed.length >= MAX_LABELS) break
  }
  return placed
}

// ── Component ────────────────────────────────────────────────────────────────

interface HotspotLabelsProps {
  hotspots:    HotspotForLabel[]
  mapRef:      React.RefObject<MapLibreMap | null>
  /** Increments on every map moveend/zoomend to trigger re-projection. */
  moveCount:   number
  currentZoom: number
}

export default function HotspotLabels({
  hotspots,
  mapRef,
  moveCount,
  currentZoom,
}: HotspotLabelsProps) {
  const [labels, setLabels] = useState<ProjectedLabel[]>([])
  const containerRef        = useRef<HTMLDivElement | null>(null)

  // ── Project hotspot lat/lng → pixel coords & run collision detection ───────

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.loaded()) { setLabels([]); return }

    if (currentZoom < MIN_ZOOM) { setLabels([]); return }

    // Sort by signal count descending so the most prominent zones win collisions
    const sorted = [...hotspots].sort((a, b) => b.signalCount - a.signalCount)

    const projected: ProjectedLabel[] = sorted.flatMap(hs => {
      try {
        const pt = map.project([hs.centerLng, hs.centerLat])
        return [{ ...hs, px: Math.round(pt.x), py: Math.round(pt.y) }]
      } catch {
        return []
      }
    })

    setLabels(decollidedLabels(projected))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotspots, moveCount, currentZoom])

  if (!labels.length || currentZoom < MIN_ZOOM) return null

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 8 }}
      aria-hidden="true"
    >
      {labels.map((hs, i) => {
        const sevColor = SEV_COLOR[hs.maxSeverity] ?? '#8892a4'
        const emoji    = categoryEmoji(hs.categories)
        const loc      = shortLocation(hs)
        const topCats  = hs.categories.slice(0, 3)

        return (
          <div
            key={i}
            style={{
              position:  'absolute',
              left:      hs.px,
              top:       hs.py,
              transform: 'translate(-50%, -100%) translateY(-10px)',
              pointerEvents: 'none',
            }}
          >
            {/* Label card */}
            <div
              style={{
                background:   'rgba(6,7,13,0.88)',
                border:       `1px solid ${sevColor}44`,
                borderRadius: 8,
                padding:      '5px 8px',
                minWidth:     120,
                maxWidth:     180,
                backdropFilter: 'blur(8px)',
                boxShadow:    `0 0 12px ${sevColor}22, 0 2px 8px rgba(0,0,0,0.4)`,
              }}
            >
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                <span style={{ fontSize: 11 }}>{emoji}</span>
                <span
                  style={{
                    fontFamily:  'monospace',
                    fontSize:    9,
                    fontWeight:  700,
                    color:       sevColor,
                    letterSpacing: '0.05em',
                    overflow:    'hidden',
                    textOverflow:'ellipsis',
                    whiteSpace:  'nowrap',
                    maxWidth:    130,
                  }}
                >
                  {loc.toUpperCase()}
                </span>
              </div>

              {/* Signal count + categories */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span
                  style={{
                    fontFamily:  'monospace',
                    fontSize:    10,
                    color:       '#e2e8f0',
                    fontWeight:  700,
                    flexShrink:  0,
                  }}
                >
                  {hs.signalCount}
                </span>
                <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  {topCats.map(cat => (
                    <span
                      key={cat}
                      style={{
                        fontFamily:  'monospace',
                        fontSize:    8,
                        color:       '#8892a4',
                        background:  'rgba(255,255,255,0.05)',
                        borderRadius: 3,
                        padding:     '1px 3px',
                      }}
                    >
                      {cat}
                    </span>
                  ))}
                </div>
              </div>

              {/* Severity breakdown mini-bar */}
              <SeverityBar maxSeverity={hs.maxSeverity} count={hs.signalCount} />
            </div>

            {/* Pointer pip */}
            <div
              style={{
                width:       0,
                height:      0,
                borderLeft:  '5px solid transparent',
                borderRight: '5px solid transparent',
                borderTop:   `6px solid ${sevColor}44`,
                margin:      '0 auto',
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

// ── SeverityBar ──────────────────────────────────────────────────────────────

function SeverityBar({ maxSeverity, count }: { maxSeverity: string; count: number }) {
  // Build a rough severity distribution heuristic from maxSeverity
  // (real breakdown would need API changes — approximate for now)
  const sevOrder = ['critical', 'high', 'medium', 'low']
  const idx      = sevOrder.indexOf(maxSeverity)

  const barParts = sevOrder.map((sev, i) => {
    // Distribute count with most weight at maxSeverity and tapering off
    const distance = Math.abs(i - idx)
    const frac     = Math.max(0, 1 - distance * 0.35)
    return { sev, frac }
  })
  const total = barParts.reduce((s, p) => s + p.frac, 0) || 1

  return (
    <div
      style={{
        display:      'flex',
        height:       3,
        borderRadius: 2,
        overflow:     'hidden',
        marginTop:    4,
        gap:          1,
      }}
    >
      {barParts.map(({ sev, frac }) => {
        if (frac <= 0) return null
        const width = Math.round((frac / total) * 100)
        return (
          <div
            key={sev}
            style={{
              width:       `${width}%`,
              height:      '100%',
              background:  SEV_COLOR[sev] ?? '#4b5563',
              opacity:     0.85,
              borderRadius: 1,
              flexShrink:  0,
            }}
          />
        )
      })}
    </div>
  )
}
