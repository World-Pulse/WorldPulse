import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import en from '../../messages/en.json'

// "WorldPulse Week" could only be reached by its address (Devon, Oct 20, 2026:
// "I can't find it on the home page"): the menu, the home page and the Daily
// Briefing now link to it

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('links to WorldPulse Week', () => {
  it('is in the left menu, right under the Daily Briefing', () => {
    const src = read('components/sidebar/LeftSidebar.tsx')
    const briefing = src.indexOf("{ href: '/briefing'")
    const week = src.indexOf("{ href: '/week'")
    expect(briefing).toBeGreaterThan(0)
    expect(week).toBeGreaterThan(briefing)
    // the next item after the briefing is the week
    expect(src.slice(briefing, week).match(/\{ href: '/g)).toHaveLength(1)
    expect(en.nav.week).toBe('WorldPulse Week')
  })

  it('is linked under Developing Stories on the home page and from the Daily Briefing', () => {
    expect(read('components/feed/DevelopingStories.tsx')).toMatch(/href="\/week"[\s\S]{0,200}This week&rsquo;s top stories/)
    expect(read('app/briefing/page.tsx')).toMatch(/href="\/week"[\s\S]{0,200}See the whole week/)
  })
})
