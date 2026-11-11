import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The developer page lists the MCP server (plan 15, Oct 20, 2026: it was live
// with no page mentioning it), with the tools the server really has

const page = readFileSync(join(__dirname, '..', 'app', 'developers', 'page.tsx'), 'utf8')
const server = readFileSync(join(__dirname, '..', '..', '..', 'api', 'src', 'routes', 'mcp.ts'), 'utf8')

/** The TOOLS array of routes/mcp.ts (its starter prompts, after it, have names too) */
const toolsBlock = (src: string) => src.slice(src.indexOf('export const TOOLS'), src.indexOf('export const PROMPTS'))

describe('the developer page on the MCP server', () => {
  it('gives its address and says it needs no key', () => {
    expect(page).toContain('https://api.world-pulse.io/mcp')
    expect(page).toMatch(/no sign-up, no key/)
    expect(page).toContain('id="mcp"')
  })

  it("gives Claude's own steps (support.claude.com: Customize, Connectors, Add custom connector)", () => {
    expect(page).toContain('Customize, Connectors, &ldquo;+ Add&rdquo;, &ldquo;Add custom connector&rdquo;')
    expect(page).not.toContain('(Settings, Connectors)')
  })

  it("lists exactly the server's tools", () => {
    const served = [...toolsBlock(server).matchAll(/^\s{4}name: '([a-z_]+)',$/gm)].map(m => m[1]).sort()
    const listed = [...page.matchAll(/\{ name: '([a-z_]+)', what:/g)].map(m => m[1]).sort()
    expect(served).toEqual(['breaking', 'busiest_countries', 'check_claim', 'check_link', 'chokepoints_news', 'conflicts', 'connections', 'country', 'country_compare', 'daily_brief', 'day', 'displacement', 'emergency_flights', 'entity', 'exploited_vulnerabilities', 'first_reporters', 'hazards', 'hotspots', 'how_verified', 'internet_outages', 'languages_today', 'latest', 'live_cameras', 'local_press', 'military_aircraft', 'missed_in_english', 'near', 'newly_verified', 'news_volume', 'outbreaks', 'outlet', 'outlet_mix', 'outlet_reports', 'protests', 'quiet_places', 'reader_flags', 'region_top_stories', 'rising_stories', 'search_reports', 'shipping', 'similar_reports', 'site_check', 'space_weather', 'story', 'story_by_country', 'story_languages', 'story_numbers', 'story_timeline', 'thin_coverage', 'top_stories', 'topics_today', 'travel_advice', 'trend', 'trending', 'unconfirmed', 'under_reported', 'verification_speed', 'verified_in_languages', 'week', 'who_covers'])
    expect(listed).toEqual(served)
  })
})
