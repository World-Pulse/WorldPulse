/**
 * The World Map's play mode (/map?play=24h, plan G9) as the nightly recorder
 * films it (Oct 21, 2026): it must cover the site's header and tab bar, and
 * Replay must have a cluster index to draw the moment's reports into. The
 * recorder's first video showed both bars and no dots.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
