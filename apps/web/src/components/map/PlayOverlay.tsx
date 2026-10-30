'use client'

import type { PlayCaption, PlayPhase } from '@/lib/map-play'

const SEV_DOT: Record<string, string> = {
  critical: '#ff3b5c', high: '#ff9f43', medium: '#f5a623', low: '#00d4aa',
}

export interface PlayDayStats {
  reports: number
  outlets: number
  countries: number
  verified: number
}

export interface PlayTopStory {
  title: string
  outlets: number
}

interface PlayOverlayProps {
  phase: PlayPhase
  caption: PlayCaption | null
  timeLabel: string
  /** "FRIDAY, OCTOBER 30" */
  dateLabel: string
  /** 0–1 */
  progress: number
  /** e.g. "LAST 24H" */
  windowLabel: string
  /** The day's numbers for the title card (null while they load) */
  day: PlayDayStats | null
  /** The day's most-reported stories for the closing card */
  topStories: PlayTopStory[]
}

/** Keyframes for the cards, the captions and the ripple at the story the camera visits (page.tsx) */
const PLAY_CSS = `
@keyframes wpPlayIn { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: none } }
.wp-play-in { animation: wpPlayIn .5s ease-out both }
@keyframes wpPlayRing { from { transform: scale(.35); opacity: .95 } to { transform: scale(3); opacity: 0 } }
.wp-play-ripple { position: relative; width: 26px; height: 26px; pointer-events: none }
.wp-play-ripple i { position: absolute; inset: 0; border-radius: 50%; border: 2px solid var(--c, #f5a623); animation: wpPlayRing 1.6s ease-out infinite }
.wp-play-ripple i + i { animation-delay: .8s }
.wp-play-ripple b { position: absolute; left: 9px; top: 9px; width: 8px; height: 8px; border-radius: 50%; background: var(--c, #f5a623); box-shadow: 0 0 14px 3px var(--c, #f5a623) }
@keyframes wpPlayBeat { 0% { box-shadow: 0 0 0 0 rgba(245,166,35,.55) } 100% { box-shadow: 0 0 0 22px rgba(245,166,35,0) } }
.wp-play-beat { animation: wpPlayBeat 1.4s ease-out infinite }
`

const Mark = ({ size = 15 }: { size?: number }) => (
  <span className="font-display font-bold" style={{ fontSize: size, letterSpacing: size / 5 }}>
    WORLD<span className="text-wp-amber">PULSE</span>
  </span>
)

/**
 * What the video shows over the map while /map?play= plays (plan G9): a title card, the clock and the headline
 * of each moment during the replay, and the day's most-reported stories at the end
 */
export function PlayOverlay({ phase, caption, timeLabel, dateLabel, progress, windowLabel, day, topStories }: PlayOverlayProps) {
  const sev = caption ? SEV_DOT[caption.severity] ?? '#8892a4' : '#8892a4'
  return (
    <>
      <style>{PLAY_CSS}</style>

      {/* The replay: the mark, the clock, the moment's headline and the progress line */}
      <div className="absolute top-4 left-4 right-4 z-20 flex items-start justify-between pointer-events-none text-wp-text">
        <div className="drop-shadow">
          <Mark />
          <div className="font-mono text-[10px] tracking-wider opacity-70 mt-0.5">world-pulse.io</div>
        </div>
        <div className="text-right font-mono text-[11px]">
          <div className="tracking-wider flex items-center justify-end gap-1.5">
            {phase === 'play' && <span className="w-1.5 h-1.5 rounded-full bg-[#ff3b5c] wp-play-beat" />}
            {phase === 'outro' ? `${windowLabel} · LIVE MAP` : timeLabel}
          </div>
          {day && <div className="opacity-70 mt-0.5">{day.reports.toLocaleString()} reports · {day.outlets.toLocaleString()} outlets</div>}
        </div>
      </div>

      <div className="absolute left-4 right-4 bottom-8 z-20 pointer-events-none" aria-live="polite">
        {caption && phase === 'play' && (
          <div key={caption.title} className="wp-play-in bg-[rgba(6,7,13,0.84)] border border-[rgba(255,255,255,0.12)] rounded-xl px-4 py-3 backdrop-blur-xl max-w-[640px] mx-auto"
            style={{ borderLeft: `3px solid ${sev}` }}>
            <div className="flex items-center gap-2 font-mono text-[10px] tracking-wider mb-1" style={{ color: sev }}>
              <span className="w-2 h-2 rounded-full" style={{ background: sev }} />
              {caption.severity.toUpperCase()}{caption.verified ? ' · VERIFIED' : ''}
            </div>
            <div className="text-[15px] leading-snug text-wp-text font-semibold">{caption.title}</div>
          </div>
        )}
        <div className="mt-3 h-[3px] rounded bg-[rgba(255,255,255,0.15)] overflow-hidden max-w-[640px] mx-auto">
          <div className="h-full bg-wp-amber" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </div>

      {/* The title card: shown from the first frame, while the map and the day's data load */}
      <div className={`absolute inset-0 z-30 flex flex-col items-center justify-center text-center px-6 text-wp-text pointer-events-none transition-opacity duration-700 ${phase === 'intro' ? 'opacity-100' : 'opacity-0'}`}
        style={{ background: 'radial-gradient(120% 75% at 50% 38%, #101a2e 0%, #070a12 62%, #05070d 100%)' }}>
        <span className="w-3 h-3 rounded-full bg-wp-amber wp-play-beat" />
        <div className="mt-5"><Mark size={14} /></div>
        <h1 className="mt-6 font-display font-bold leading-[1.02] text-[34px] tracking-[1px]">THE WORLD<br />IN 60 SECONDS</h1>
        {dateLabel && <div className="mt-4 font-mono text-[12px] tracking-[2px] text-wp-amber">{dateLabel}</div>}
        <p className="mt-5 text-[14px] leading-relaxed max-w-[300px] opacity-80">24 hours of world news on one map: every report, and the stories newsrooms confirmed.</p>
        {day && (
          <div className="mt-7 grid grid-cols-3 gap-3 w-full max-w-[320px] wp-play-in">
            {[[day.reports, 'reports'], [day.outlets, 'outlets'], [day.countries, 'countries']].map(([n, l]) => (
              <div key={l as string} className="rounded-lg border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] py-2">
                <div className="font-display font-bold text-[19px]">{(n as number).toLocaleString()}</div>
                <div className="font-mono text-[9.5px] tracking-wider opacity-60 uppercase">{l as string}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* The closing card: the day's most-reported stories, over the finished map */}
      <div className={`absolute inset-0 z-30 flex flex-col justify-end px-6 pb-14 text-wp-text pointer-events-none transition-opacity duration-700 ${phase === 'outro' ? 'opacity-100' : 'opacity-0'}`}
        style={{ background: 'linear-gradient(180deg, rgba(5,7,13,0) 0%, rgba(5,7,13,0.78) 38%, rgba(5,7,13,0.97) 64%)' }}>
        {phase === 'outro' && (
          <>
            <div className="font-mono text-[11px] tracking-[2px] text-wp-amber wp-play-in">THE DAY&apos;S MOST-REPORTED STORIES</div>
            <ol className="mt-4 flex flex-col gap-4">
              {topStories.slice(0, 3).map((s, i) => (
                <li key={s.title} className="wp-play-in" style={{ animationDelay: `${350 + i * 450}ms` }}>
                  <div className="font-mono text-[10.5px] tracking-wider opacity-60">{i + 1} · {s.outlets.toLocaleString()} OUTLETS</div>
                  <div className="text-[16px] font-semibold leading-snug">{s.title}</div>
                </li>
              ))}
            </ol>
            <div className="mt-8 wp-play-in" style={{ animationDelay: `${450 + Math.min(3, topStories.length) * 450}ms` }}>
              <div className="text-[14px] opacity-90">Don&apos;t trust one headline. Count the newsrooms.</div>
              <div className="mt-2 flex items-baseline gap-2"><Mark size={15} /><span className="font-mono text-[12px] tracking-wider opacity-80">world-pulse.io</span></div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
