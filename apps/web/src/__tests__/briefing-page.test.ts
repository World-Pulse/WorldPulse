import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The Daily Briefing page waited for its overnight card before showing anything (Oct 30, 2026: made fresh for a
// time zone nobody had asked for lately, GET /api/v1/pulse/briefing took 2 to 7 s)

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('the Daily Briefing page', () => {
  it("doesn't wait for the overnight card", () => {
    const src = read('app/briefing/page.tsx')
    const all = src.slice(src.indexOf('await Promise.all(['), src.indexOf('])', src.indexOf('await Promise.all([')))
    expect(all).toContain('/api/v1/briefing/daily')
    expect(all).not.toContain('/api/v1/pulse/briefing')
    expect(src).toMatch(/fetch\(`\$\{apiBase\}\/api\/v1\/pulse\/briefing\?tz=[^`]*`\)\s*\.then\([\s\S]{0,200}setMorningBriefing/)
  })
})
