/**
 * The picture a morning video's own link shows (world-pulse.io/map/day/<date>, Nov 12, 2026).
 *
 * Devon, Nov 12: "you're stating 211 countries in the video and only 202 in the picture". The video's
 * reply linked to /map, whose picture is the live map card: other numbers than the video's, and X kept
 * showing a copy it had saved days before (2,623 verified stories under a video recorded with 3,470).
 * Each day's link now has a picture of its own, drawn from the card the recorder saves beside the video
 * (world-in-60s-<date>.json: the numbers that were on screen), so the two always agree, and a new
 * address each day means no saved copy from another day.
 *
 * What it says is kept apart from the drawing so it can be tested. Drawn by next/og (flexbox only).
 */

import { COLOR, Pill, Rings } from './story-card'

export interface DayCard {
  date: string
  reports: number
  outlets: number
  countries: number
}

export interface DayCardText {
  day: string
  stats: Array<{ value: string; label: string }>
}

/** Nothing older: the recorder saves a card beside the video since November 2026 */
const FIRST_DAY = '2026-11-01'

const num = (n: number) => n.toLocaleString('en-US')
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0)

/** "2026-11-12" when it is a real day a video could have, else null */
export function parseDay(value: unknown, now: Date = new Date()): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const t = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== value) return null
  // (a day ahead at most: the address is written in New York, read in UTC)
  if (value < FIRST_DAY || t > now.getTime() + 36 * 3600_000) return null
  return value
}

/** The recorder's saved card for that day, or null when it isn't one (another day's, no numbers) */
export function readDayCard(json: unknown, date: string): DayCard | null {
  if (!json || typeof json !== 'object') return null
  const c = json as Record<string, unknown>
  if (c.date !== date) return null
  const card = { date, reports: count(c.reports), outlets: count(c.outlets), countries: count(c.countries) }
  return card.reports > 0 && card.outlets > 0 && card.countries > 0 ? card : null
}

/** "Thursday, Nov 12" */
export function dayLabel(date: string, month: 'short' | 'long' = 'short'): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month, day: 'numeric' })
}

/** The link's title: the video's own */
export function dayTitle(date: string): string {
  return `The world in 30 seconds: ${dayLabel(date)}`
}

/** One line for the link's description, in the video's numbers */
export function dayDescription(card: DayCard | null): string {
  return card
    ? `24 hours of world news on one map: ${num(card.reports)} reports from ${num(card.outlets)} outlets in ${num(card.countries)} countries.`
    : '24 hours of world news on one map: every report, and the stories newsrooms confirmed.'
}

export function dayCardText(card: DayCard): DayCardText {
  return {
    day: dayLabel(card.date, 'long').toUpperCase(),
    stats: [
      { value: num(card.reports), label: 'REPORTS' },
      { value: num(card.outlets), label: 'OUTLETS' },
      { value: num(card.countries), label: 'COUNTRIES' },
    ],
  }
}

export function MapDayCard({ text }: { text: DayCardText }) {
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
          <Pill color={COLOR.amber}>{text.day}</Pill>
        </div>
        <div style={{ display: 'flex', fontSize: 64, fontWeight: 700, letterSpacing: -1, marginTop: 40 }}>The world in 30 seconds</div>
        <div style={{ display: 'flex', fontSize: 30, color: COLOR.text2, marginTop: 10 }}>24 hours of world news on one map</div>
        <div style={{ display: 'flex', gap: 64, marginTop: 44 }}>
          {text.stats.map(s => (
            <div key={s.label} style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', fontSize: 96, fontWeight: 700, color: COLOR.amber, letterSpacing: -2 }}>{s.value}</div>
              <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, letterSpacing: 3, color: COLOR.text2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, padding: '20px 64px', backgroundColor: 'rgba(245,166,35,0.09)', borderTop: `2px solid ${COLOR.amber}` }}>
        <div style={{ display: 'flex', fontSize: 24, color: COLOR.text }}>The same numbers as that morning’s video</div>
        <div style={{ display: 'flex', fontSize: 26, color: COLOR.text2 }}>world-pulse.io/map</div>
      </div>
      <div style={{ display: 'flex', height: 10, backgroundColor: COLOR.amber }} />
    </div>
  )
}
