/**
 * The World Map's play mode (/map?play=24h, plan G9) as the nightly recorder
 * films it (Oct 21, 2026): it must cover the site's header and tab bar, and
 * Replay must have a cluster index to draw the moment's reports into. The
 * recorder's first video showed both bars and no dots.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pickTourStop, playCounts, playDateLabel, type TourSignal } from '../lib/map-play'

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const zOf = (src: string, marker: RegExp) => Number(marker.exec(src)?.[1] ?? NaN)

describe('play mode', () => {
  it('sits above the site\'s header and tab bar', () => {
    const map = read('app/map/page.tsx')
    const play = zOf(map, /fixed top-0 bottom-0 z-\[(\d+)\] flex flex-col bg-wp-bg \$\{playVertical/)
    const header = zOf(read('components/nav/TopNav.tsx'), /fixed top-0 left-0 right-0 h-\[52px\][^"]*z-\[(\d+)\]/)
    const tabs = zOf(read('components/nav/BottomTabBar.tsx'), /fixed bottom-0 left-0 right-0[^"]*z-\[(\d+)\]/)
    expect(play).toBeGreaterThan(header)
    expect(play).toBeGreaterThan(tabs)
  })
  it('makes the cluster index even when it starts in Replay', () => {
    expect(read('app/map/page.tsx')).toContain('if (timelineActive && scRef.current) return')
  })
})

describe('the video (Oct 30, 2026: "add some more layers, make it more exciting")', () => {
  const sig = (id: string, extra: Partial<TourSignal> = {}): TourSignal =>
    ({ id, lat: 10, lng: 20, title: `Story ${id}`, severity: 'medium', status: 'pending', is_breaking: false, ...extra })

  it('flies the camera to the best-ranked story with a place in the last moments, not the one it is at', () => {
    const buckets = [
      { signals: [sig('a', { severity: 'critical' })] },
      { signals: [sig('b', { status: 'verified' }), sig('c', { severity: 'high' })] },
      { signals: [sig('d', { lat: 0, lng: 0, status: 'verified', severity: 'critical' }), sig('e', { lat: NaN })] },
    ]
    expect(pickTourStop(buckets, 2)?.id).toBe('b')              // verified first; d and e have no place
    expect(pickTourStop(buckets, 2, 'b')?.id).toBe('a')         // then the most severe, not the one it is at
    expect(pickTourStop([], 0)).toBeNull()
  })

  it('counts what the replay has shown, and names the day', () => {
    expect(playCounts([{ signals: [{ status: 'verified' }, {}] }, { signals: [{ status: 'verified' }] }], 0)).toEqual({ reports: 2, verified: 1 })
    expect(playDateLabel('2026-10-30T10:00:00Z')).toBe('FRIDAY, OCTOBER 30')
    expect(playDateLabel(null)).toBe('')
  })

  it('opens with the heat, conflict zones and hazards on, and tells the recorder when it is done', () => {
    const map = read('app/map/page.tsx')
    expect(map).toContain("useState(() => searchParams.get('hm') === '1' || playParam)")
    expect(map).toContain('const [conflictMode,    setConflictMode]    = useState(playParam)')
    expect(map).toContain('const [hazardsMode,    setHazardsMode]    = useState(playParam)')
    expect(map).toContain('document.documentElement.dataset.playDone = \'1\'')
    expect(read('../../../infrastructure/recorder/record.mjs')).toContain('dataset.playDone')
  })
})
