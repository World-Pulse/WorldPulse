/**
 * The picture world-pulse.io/map shows when shared (plan M29, Oct 15, 2026):
 * today's live figures (verified stories, outlets, countries) and the places
 * with the most stories, in the story card's style (lib/story-card). Drawn by
 * next/og (flexbox only).
 */

import { COLOR, Pill, Rings } from './story-card'

export interface MapDay {
  verified24h: number
  outlets24h: number
  countries24h: number
}

export interface MapPoint { country_code?: string | null }

export interface MapCardText {
  stats: Array<{ value: string; label: string }>
  places: Array<{ name: string; count: string }>
}

const num = (n: number) => n.toLocaleString('en-US')

/** "Ukraine" for "UA", or null for anything that isn't a country code */
function countryName(code: string): string | null {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code)
    return name && name !== code ? name : null
  } catch {
    return null
  }
}

/** The countries with the most points, busiest first */
export function busiestPlaces(points: MapPoint[], limit = 5): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>()
  for (const p of points) {
    const code = p.country_code?.trim().toUpperCase()
    if (code && /^[A-Z]{2}$/.test(code)) counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .flatMap(([code, count]) => {
      const name = countryName(code)
      return name ? [{ name, count }] : []
    })
    .slice(0, limit)
}

/** What the card says, or null when there is nothing live to show (kept apart from the drawing so it can be tested) */
export function mapCardText(day: MapDay, points: MapPoint[]): MapCardText | null {
  if (!(day.verified24h > 0) && !(day.outlets24h > 0)) return null
  return {
    stats: [
      { value: num(day.verified24h), label: 'VERIFIED STORIES' },
      { value: num(day.outlets24h), label: 'OUTLETS' },
      { value: num(day.countries24h), label: 'COUNTRIES' },
    ],
    places: busiestPlaces(points).map(p => ({ name: p.name, count: `${num(p.count)} on the map` })),
  }
}

export function MapCard({ text }: { text: MapCardText }) {
  const grid = {
    backgroundColor: COLOR.bg,
    backgroundImage: `linear-gradient(${COLOR.grid} 1px, transparent 1px), linear-gradient(90deg, ${COLOR.grid} 1px, transparent 1px)`,
    backgroundSize: '60px 60px',
  }
  return (
    <div style={{ ...grid, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'Inter', color: COLOR.text }}>
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: '44px 64px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Rings />
            <div style={{ display: 'flex', fontFamily: 'Bebas Neue', fontSize: 46, letterSpacing: 5, color: COLOR.amber, paddingTop: 6 }}>WORLDPULSE</div>
          </div>
          <Pill color={COLOR.green}>LIVE · LAST 24 HOURS</Pill>
        </div>
        <div style={{ display: 'flex', fontSize: 64, fontWeight: 700, letterSpacing: -1, marginTop: 26 }}>The world right now, on one map</div>
        <div style={{ display: 'flex', gap: 56, marginTop: 30 }}>
          {text.stats.map(s => (
            <div key={s.label} style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', fontSize: 84, fontWeight: 700, color: COLOR.amber, letterSpacing: -2 }}>{s.value}</div>
              <div style={{ display: 'flex', fontSize: 20, fontWeight: 700, letterSpacing: 3, color: COLOR.text2 }}>{s.label}</div>
            </div>
          ))}
        </div>
        {text.places.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 28 }}>
            <div style={{ display: 'flex', fontSize: 20, fontWeight: 700, letterSpacing: 3, color: COLOR.amber }}>BUSIEST PLACES</div>
            <div style={{ display: 'flex', gap: 28, marginTop: 10, fontSize: 28, fontWeight: 700 }}>
              {text.places.map(p => (
                <div key={p.name} style={{ display: 'flex' }}>{p.name}</div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, padding: '20px 64px', backgroundColor: 'rgba(245,166,35,0.09)', borderTop: `2px solid ${COLOR.amber}` }}>
        <div style={{ display: 'flex', fontSize: 24, color: COLOR.text }}>Every story shows the outlets that confirm it</div>
        <div style={{ display: 'flex', fontSize: 26, color: COLOR.text2 }}>world-pulse.io/map</div>
      </div>
      <div style={{ display: 'flex', height: 10, backgroundColor: COLOR.amber }} />
    </div>
  )
}
