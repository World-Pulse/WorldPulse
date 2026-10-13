/**
 * The picture world-pulse.io/entities shows when shared (Oct 13, 2026): who
 * was in the news this week, the top three people, places and organizations
 * with their report counts, in the story card's style (lib/story-card). A
 * ready-made weekly post. Drawn by next/og (flexbox only).
 */

import { COLOR, Pill, Rings, clip } from './story-card'
import { weekRange, type EntityDirectory } from './entity-directory'

export interface DirectoryCardText {
  range: string
  columns: Array<{ label: string; rows: Array<{ name: string; count: string }> }>
}

const COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'people', label: 'PEOPLE' },
  { key: 'places', label: 'PLACES' },
  { key: 'organisations', label: 'ORGANIZATIONS' },
]

/** What the card says, or null when there is nothing to show (kept apart from the drawing so it can be tested) */
export function directoryCardText(d: EntityDirectory): DirectoryCardText | null {
  const columns = COLUMNS.map(c => ({
    label: c.label,
    rows: (d.groups.find(g => g.key === c.key)?.entities ?? []).slice(0, 3).map(e => ({
      name: clip(e.name, 22),
      count: `${e.last7d.toLocaleString('en-US')} report${e.last7d === 1 ? '' : 's'}`,
    })),
  }))
  if (columns.every(c => c.rows.length === 0)) return null
  return { range: weekRange(d.generatedAt), columns }
}

export function DirectoryCard({ text }: { text: DirectoryCardText }) {
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
          <Pill color={COLOR.text2}>{text.range.toUpperCase()}</Pill>
        </div>
        <div style={{ display: 'flex', fontSize: 64, fontWeight: 700, letterSpacing: -1, marginTop: 26 }}>Who was in the news this week</div>
        <div style={{ display: 'flex', gap: 40, marginTop: 30 }}>
          {text.columns.map(c => (
            <div key={c.label} style={{ display: 'flex', flexDirection: 'column', gap: 14, width: 336 }}>
              <div style={{ display: 'flex', fontSize: 20, fontWeight: 700, letterSpacing: 3, color: COLOR.amber }}>{c.label}</div>
              {c.rows.map((r, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, color: COLOR.text }}>{r.name}</div>
                  <div style={{ display: 'flex', fontSize: 21, color: COLOR.text2 }}>{r.count}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, padding: '20px 64px', backgroundColor: 'rgba(245,166,35,0.09)', borderTop: `2px solid ${COLOR.amber}` }}>
        <div style={{ display: 'flex', fontSize: 24, color: COLOR.text }}>Counted across the outlets WorldPulse follows</div>
        <div style={{ display: 'flex', fontSize: 26, color: COLOR.text2 }}>world-pulse.io/entities</div>
      </div>
      <div style={{ display: 'flex', height: 10, backgroundColor: COLOR.amber }} />
    </div>
  )
}
