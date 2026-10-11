/**
 * The picture a story link shows on X, LinkedIn, Telegram, Bluesky and in
 * messages (plan G3, Oct 11, 2026). Story links showed no picture; Devon
 * wants them fixed before WorldPulse posts anywhere.
 *
 * 1200×630, in the site's colors: the WorldPulse mark, the severity and
 * category, the headline, the place and time, and how many outlets carry the
 * story and whether it is verified, so the card says why WorldPulse is worth
 * the click. Drawn by next/og (flexbox only: every element with more than one
 * child is display:flex).
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const CARD_SIZE = { width: 1200, height: 630 }

const COLOR = {
  bg: '#06070d', text: '#e2e6f0', text2: '#8892a4', amber: '#f5a623', green: '#00e676', grid: 'rgba(255,255,255,0.055)',
}
const SEVERITY_COLOR: Record<string, string> = {
  critical: '#ff3b5c', high: '#ff8a3d', medium: '#f5a623', low: '#00d4ff', info: '#8892a4',
}

export interface CardStory {
  title: string
  severity?: string | null
  category?: string | null
  locationName?: string | null
  firstReported?: string | null
  createdAt?: string | null
  status?: string | null
}

export interface CardOutlets { outlets: number; verified: boolean }

export interface CardText {
  headline: string
  headlineSize: number
  severity: string | null
  severityColor: string
  category: string | null
  place: string | null
  when: string | null
  proof: string
  verified: boolean
}

/** A headline cut to at most `max` characters, at a word */
function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/u, '')}…`
}

/** "Oct 11, 2026 · 16:02 UTC" */
function whenText(iso: string | null | undefined): string | null {
  const t = Date.parse(iso ?? '')
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
  return `${date} · ${time} UTC`
}

/** What the card says, worked out from the story (kept apart from the drawing so it can be tested) */
export function storyCardText(s: CardStory, o: CardOutlets | null): CardText {
  const headline = clip(s.title, 150)
  const n = headline.length
  const severity = s.severity ? s.severity.toLowerCase() : null
  const verified = o ? o.verified : s.status === 'verified'
  const outlets = o?.outlets ?? 0
  const proof = verified
    ? outlets > 1 ? `Verified · ${outlets} outlets` : 'Verified'
    : outlets > 1 ? `${outlets} outlets so far · not yet verified` : 'One outlet so far · not yet verified'
  return {
    headline,
    headlineSize: n <= 50 ? 72 : n <= 80 ? 64 : n <= 110 ? 56 : n <= 130 ? 50 : 46,
    severity: severity ? severity.toUpperCase() : null,
    severityColor: SEVERITY_COLOR[severity ?? ''] ?? COLOR.text2,
    category: s.category ? s.category.charAt(0).toUpperCase() + s.category.slice(1).replace(/_/g, ' ') : null,
    place: s.locationName?.trim() ? clip(s.locationName, 48) : null,
    when: whenText(s.firstReported ?? s.createdAt),
    proof,
    verified,
  }
}

type CardFont = { name: string; data: Buffer; weight: 400 | 700; style: 'normal' }

let fontsOnce: Promise<CardFont[]> | null = null

/**
 * The card's fonts (Inter and Bebas Neue, SIL Open Font License, in
 * public/fonts/og: the server's container keeps public/). Each path is
 * written out in full so the build traces only these files (a computed path
 * makes it trace the whole project). Read once; if they are missing the card
 * is drawn in next/og's own font rather than not at all.
 */
export function cardFonts(): Promise<CardFont[]> {
  fontsOnce ??= Promise.all([
    readFile(join(process.cwd(), 'public/fonts/og/inter-latin-400-normal.woff')),
    readFile(join(process.cwd(), 'public/fonts/og/inter-latin-ext-400-normal.woff')),
    readFile(join(process.cwd(), 'public/fonts/og/inter-cyrillic-400-normal.woff')),
    readFile(join(process.cwd(), 'public/fonts/og/inter-latin-700-normal.woff')),
    readFile(join(process.cwd(), 'public/fonts/og/inter-latin-ext-700-normal.woff')),
    readFile(join(process.cwd(), 'public/fonts/og/inter-cyrillic-700-normal.woff')),
    readFile(join(process.cwd(), 'public/fonts/og/bebas-neue-latin-400-normal.woff')),
  ]).then(([r1, r2, r3, b1, b2, b3, bebas]): CardFont[] => [
    ...[r1, r2, r3].map(data => ({ name: 'Inter', data, weight: 400 as const, style: 'normal' as const })),
    ...[b1, b2, b3].map(data => ({ name: 'Inter', data, weight: 700 as const, style: 'normal' as const })),
    { name: 'Bebas Neue', data: bebas, weight: 400, style: 'normal' },
  ]).catch(() => [])
  return fontsOnce
}

function Pill({ color, children }: { color: string; children: string }) {
  return (
    <div style={{ display: 'flex', padding: '8px 18px', borderRadius: 999, border: `2px solid ${color}`, color, fontSize: 22, fontWeight: 700, letterSpacing: 2 }}>
      {children}
    </div>
  )
}

/** The WorldPulse rings (as on og-image.png) */
function Rings() {
  return (
    <div style={{ display: 'flex', position: 'relative', width: 44, height: 44 }}>
      {[44, 30, 16].map(d => (
        <div key={d} style={{ position: 'absolute', left: (44 - d) / 2, top: (44 - d) / 2, width: d, height: d, borderRadius: 999, border: `2px solid ${COLOR.amber}` }} />
      ))}
    </div>
  )
}

/** The card for a story, or the site's own card when there is none */
export function StoryCard({ text }: { text: CardText | null }) {
  const grid = {
    backgroundColor: COLOR.bg,
    backgroundImage: `linear-gradient(${COLOR.grid} 1px, transparent 1px), linear-gradient(90deg, ${COLOR.grid} 1px, transparent 1px)`,
    backgroundSize: '60px 60px',
  }
  if (!text) {
    return (
      <div style={{ ...grid, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter', color: COLOR.text }}>
        <div style={{ display: 'flex', fontFamily: 'Bebas Neue', fontSize: 120, letterSpacing: 8, color: COLOR.amber }}>WORLDPULSE</div>
        <div style={{ display: 'flex', fontSize: 36, color: COLOR.text2 }}>Real-time world news, verified across outlets</div>
      </div>
    )
  }
  const proofColor = text.verified ? COLOR.green : COLOR.amber
  return (
    <div style={{ ...grid, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'Inter', color: COLOR.text }}>
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: '48px 64px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Rings />
            <div style={{ display: 'flex', fontFamily: 'Bebas Neue', fontSize: 46, letterSpacing: 5, color: COLOR.amber, paddingTop: 6 }}>WORLDPULSE</div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            {text.severity ? <Pill color={text.severityColor}>{text.severity}</Pill> : null}
            {text.category ? <Pill color={COLOR.text2}>{text.category.toUpperCase()}</Pill> : null}
          </div>
        </div>
        <div style={{ display: 'flex', flexGrow: 1, alignItems: 'center' }}>
          <div style={{ display: 'flex', fontSize: text.headlineSize, fontWeight: 700, lineHeight: 1.16, letterSpacing: -0.5 }}>{text.headline}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 28, color: COLOR.text2, paddingBottom: 30 }}>
          {text.place ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', width: 14, height: 14, borderRadius: 999, backgroundColor: text.severityColor }} />
              <div style={{ display: 'flex' }}>{text.place}</div>
            </div>
          ) : null}
          {text.when ? <div style={{ display: 'flex' }}>{text.when}</div> : null}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 64px', backgroundColor: text.verified ? 'rgba(0,230,118,0.09)' : 'rgba(245,166,35,0.09)', borderTop: `2px solid ${proofColor}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 32, fontWeight: 700, color: proofColor }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 999, backgroundColor: proofColor }}>
            {text.verified ? (
              <svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" stroke={COLOR.bg} strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24"><circle cx="5" cy="12" r="2.4" fill={COLOR.bg} /><circle cx="12" cy="12" r="2.4" fill={COLOR.bg} /><circle cx="19" cy="12" r="2.4" fill={COLOR.bg} /></svg>
            )}
          </div>
          <div style={{ display: 'flex' }}>{text.proof}</div>
        </div>
        <div style={{ display: 'flex', fontSize: 28, color: COLOR.text2 }}>world-pulse.io</div>
      </div>
      <div style={{ display: 'flex', height: 10, backgroundColor: COLOR.amber }} />
    </div>
  )
}
