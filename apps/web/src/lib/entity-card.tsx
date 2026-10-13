/**
 * The picture an entity page link shows on X, LinkedIn, Telegram, Bluesky
 * and in messages (Oct 13, 2026), in the story card's style (lib/story-card):
 * the WorldPulse mark and the entity's kind, its name, how many reports named
 * it in the last 24 hours and 7 days, 14 days of bars, and its most-reported
 * story with how many outlets carry it. Drawn by next/og (flexbox only).
 */

import { COLOR, Pill, Rings, clip } from './story-card'
import { entityTypeLabel } from './entity-links'

export interface CardProfile {
  entity: { name: string; type: string }
  activity: { last24h: number; last7d: number; daily: Array<{ day: string; n: number }> }
  stories: Array<{ title: string; outletCount: number; verifiedAt: string | null }>
}

export interface EntityCardText {
  name: string
  nameSize: number
  kind: string
  counts: string
  bars: number[]
  story: string | null
  proof: string | null
  verified: boolean
}

const plural = (n: number, one: string) => `${n.toLocaleString('en-US')} ${one}${n === 1 ? '' : 's'}`

/** What the card says (kept apart from the drawing so it can be tested) */
export function entityCardText(p: CardProfile): EntityCardText {
  const name = clip(p.entity.name, 60)
  const lead = p.stories[0]
  const verified = Boolean(lead?.verifiedAt)
  return {
    name,
    nameSize: name.length <= 14 ? 112 : name.length <= 24 ? 92 : name.length <= 36 ? 72 : 58,
    kind: entityTypeLabel(p.entity.type).toUpperCase(),
    counts: `${plural(p.activity.last24h, 'report')} in 24 hours · ${p.activity.last7d.toLocaleString('en-US')} this week`,
    bars: p.activity.daily.slice(-14).map(d => d.n),
    story: lead ? clip(lead.title, 90) : null,
    proof: lead ? (verified ? `Verified · ${lead.outletCount} outlets` : `${lead.outletCount} outlets so far`) : null,
    verified,
  }
}

/** The card for an entity */
export function EntityCard({ text }: { text: EntityCardText }) {
  const grid = {
    backgroundColor: COLOR.bg,
    backgroundImage: `linear-gradient(${COLOR.grid} 1px, transparent 1px), linear-gradient(90deg, ${COLOR.grid} 1px, transparent 1px)`,
    backgroundSize: '60px 60px',
  }
  const max = Math.max(1, ...text.bars)
  const proofColor = text.verified ? COLOR.green : COLOR.amber
  return (
    <div style={{ ...grid, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'Inter', color: COLOR.text }}>
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: '48px 64px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Rings />
            <div style={{ display: 'flex', fontFamily: 'Bebas Neue', fontSize: 46, letterSpacing: 5, color: COLOR.amber, paddingTop: 6 }}>WORLDPULSE</div>
          </div>
          <Pill color={COLOR.text2}>{text.kind}</Pill>
        </div>
        <div style={{ display: 'flex', flexGrow: 1, alignItems: 'center', justifyContent: 'space-between', gap: 40 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flexShrink: 1 }}>
            <div style={{ display: 'flex', fontSize: text.nameSize, fontWeight: 700, lineHeight: 1.05, letterSpacing: -1 }}>{text.name}</div>
            <div style={{ display: 'flex', fontSize: 30, color: COLOR.text2 }}>{text.counts}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 150, flexShrink: 0 }}>
            {text.bars.map((n, i) => (
              <div key={i} style={{ display: 'flex', width: 16, height: Math.max(4, Math.round((n / max) * 150)), borderRadius: 3, backgroundColor: n === 0 ? 'rgba(255,255,255,0.10)' : COLOR.amber, opacity: i === text.bars.length - 1 ? 0.55 : 1 }} />
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, padding: '22px 64px', backgroundColor: text.verified ? 'rgba(0,230,118,0.09)' : 'rgba(245,166,35,0.09)', borderTop: `2px solid ${text.story ? proofColor : COLOR.text2}` }}>
        {text.story ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 1 }}>
            <div style={{ display: 'flex', fontSize: 26, color: COLOR.text }}>{text.story}</div>
            <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, color: proofColor }}>{text.proof}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', fontSize: 28, color: COLOR.text2 }}>Every report naming them, checked across outlets</div>
        )}
        <div style={{ display: 'flex', fontSize: 28, color: COLOR.text2, flexShrink: 0 }}>world-pulse.io</div>
      </div>
      <div style={{ display: 'flex', height: 10, backgroundColor: COLOR.amber }} />
    </div>
  )
}
