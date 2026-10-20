/**
 * The embedded story card (plan G20): what other sites show in a frame from
 * world-pulse.io/embed/story/<id>. The whole card is one link to the story's
 * page. It fills its frame, so its own colours are the frame's (the light
 * theme is the default: most pages it sits on are light).
 */

import { cardLink, countLine, outletsLine, updatedLine, type CardTheme, type StoryCardResult } from '@/lib/embed-card'
import { SITE_URL } from '@/lib/page-metadata'

const THEMES: Record<CardTheme, {
  bg: string; border: string; text: string; muted: string; accent: string
  yes: { bg: string; fg: string; border: string }
  no: { bg: string; fg: string; border: string }
}> = {
  light: {
    bg: '#ffffff', border: '#e3e6ee', text: '#111827', muted: '#5b6475', accent: '#a15c00',
    yes: { bg: '#e8f8ef', fg: '#0a6b37', border: '#b9e8cc' },
    no: { bg: '#fdf3e1', fg: '#8a5200', border: '#f3d39a' },
  },
  dark: {
    bg: '#0d0f18', border: 'rgba(255,255,255,0.12)', text: '#e2e6f0', muted: '#8892a4', accent: '#f5a623',
    yes: { bg: 'rgba(0,230,118,0.12)', fg: '#00e676', border: 'rgba(0,230,118,0.35)' },
    no: { bg: 'rgba(245,166,35,0.12)', fg: '#f5a623', border: 'rgba(245,166,35,0.35)' },
  },
}

export function StoryCardView({ card, theme, id }: { card: StoryCardResult; theme: CardTheme; id: string }) {
  const t = THEMES[theme]
  const frame: React.CSSProperties = {
    position: 'absolute', inset: 0, boxSizing: 'border-box', background: t.bg, color: t.text,
    border: `1px solid ${t.border}`, borderRadius: 12, overflow: 'hidden',
  }
  const link: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 8, height: '100%', boxSizing: 'border-box',
    padding: '14px 16px', color: 'inherit', textDecoration: 'none',
  }
  const top = (right: string) => (
    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 11, color: t.muted, flexShrink: 0 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, letterSpacing: '0.08em', color: t.text }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: '#f5a623', display: 'inline-block' }} />
        WORLDPULSE
      </span>
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{right}</span>
    </span>
  )
  const cta = (label: string) => (
    <span style={{ marginTop: 'auto', paddingTop: 8, borderTop: `1px solid ${t.border}`, fontSize: 12, fontWeight: 600, color: t.accent, flexShrink: 0 }}>{label}</span>
  )

  if (card === 'missing' || card === 'unavailable') {
    const href = card === 'missing'
      ? `${SITE_URL}/?utm_source=embed&utm_medium=card&utm_campaign=story`
      : cardLink(id)
    return (
      <div style={frame}>
        <a href={href} target="_blank" rel="noopener" style={link}>
          {top('')}
          <span style={{ fontSize: 15, lineHeight: 1.4 }}>
            {card === 'missing'
              ? 'This story is no longer on WorldPulse.'
              : 'WorldPulse could not load this story just now. It will be back in a moment.'}
          </span>
          {cta(card === 'missing' ? 'See the stories most outlets are reporting →' : 'Open the story on WorldPulse →')}
        </a>
      </div>
    )
  }

  const pill = card.verified ? t.yes : t.no
  const count = countLine(card)
  const outlets = outletsLine(card)
  // (one outlet so far: there's no list to see yet, but the count may grow)
  const action = card.outlets > 1 ? 'See every outlet on WorldPulse' : 'Follow this story on WorldPulse'
  return (
    <div style={frame}>
      <a
        href={cardLink(card.id)}
        target="_blank"
        rel="noopener"
        style={link}
        aria-label={`${card.title}: ${count.replace('✓ ', '')}. ${action}`}
      >
        {top(updatedLine(card.updatedAt))}
        <span style={{
          fontSize: 16, lineHeight: 1.3, fontWeight: 650, display: '-webkit-box', WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical', overflow: 'hidden', flexShrink: 0,
        }}>{card.title}</span>
        <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 6, flexShrink: 0 }}>
          <span style={{
            display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 12.5, fontWeight: 700,
            background: pill.bg, color: pill.fg, border: `1px solid ${pill.border}`, whiteSpace: 'nowrap',
          }}>{count}</span>
          {outlets && (
            <span style={{ fontSize: 12, color: t.muted, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 160px' }}>{outlets}</span>
          )}
        </span>
        {cta(`${action} →`)}
      </a>
    </div>
  )
}
