/**
 * Use from outside on /admin (Oct 22, 2026): the API and MCP server used by
 * anyone but the website, a day at a time (components/admin/OutsideUseAdmin.tsx).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { OutsideUseView, weekTotals, weekLine, topLine, dayLabel, type UseDay } from '@/components/admin/OutsideUseAdmin'

const day = (d: string, over: Partial<UseDay> = {}): UseDay => ({
  day: d, total: 0, withKey: 0, ai: 0, bots: 0, clients: 0, own: 0, routes: {}, mcp: { total: 0, tools: {} }, ...over,
})

const days: UseDay[] = [
  day('2026-10-22', { total: 14, ai: 4, clients: 10, withKey: 2, own: 31, routes: { 'GET /api/v1/stories': 5, 'GET /api/v1/coverage-gap': 9 }, mcp: { total: 3, tools: { story: 2, under_reported: 1 } } }),
  ...Array.from({ length: 6 }, (_, i) => day(`2026-10-${String(21 - i).padStart(2, '0')}`)),
  day('2026-10-15', { total: 1200, bots: 1200 }),
]

describe('use from outside on /admin', () => {
  it('adds up a week, this one and the one before', () => {
    expect(weekTotals(days)).toEqual({ calls: 14, ai: 4, bots: 0, clients: 10, withKey: 2, tools: 3 })
    expect(weekTotals(days, 7)).toMatchObject({ calls: 1200, bots: 1200 })
  })

  it('says it in a line', () => {
    expect(weekLine(weekTotals(days))).toBe('14 calls from outside (AI agents 4 · crawlers 0 · scripts and apps 10; 2 with an API key) · 3 AI-assistant tool calls')
    expect(weekLine(weekTotals([]))).toBe('No calls from outside yet.')
    expect(weekLine({ calls: 1, ai: 0, bots: 0, clients: 1, withKey: 0, tools: 1 })).toBe('1 call from outside (AI agents 0 · crawlers 0 · scripts and apps 1) · 1 AI-assistant tool call')
    expect(weekLine(weekTotals(days, 7))).toContain('1,200 calls')
  })

  it('names the busiest routes and tools first', () => {
    expect(topLine(days[0].routes)).toBe('GET /api/v1/coverage-gap 9 · GET /api/v1/stories 5')
    expect(topLine({ a: 1, b: 2, c: 3 }, 2)).toBe('c 3 · b 2')
    expect(dayLabel('2026-10-22')).toBe('Oct 22')
  })

  it('shows the days, today first, and what is left out', () => {
    const html = renderToStaticMarkup(<OutsideUseView days={days} />)
    expect(html).toContain('Last 7 days: 14 calls from outside')
    expect(html).toContain('The 7 days before: 1,200 calls · 0 tool calls.')
    expect(html.indexOf('Oct 22')).toBeLessThan(html.indexOf('Oct 21'))
    expect(html).toContain('Most used today: GET /api/v1/coverage-gap 9 · GET /api/v1/stories 5')
    expect(html).toContain('AI-assistant tools today: story 2 · under_reported 1')
    expect(html).toContain('own checks (31 today)')
  })

  it('is on the admin page, and only there', () => {
    const page = readFileSync(join(__dirname, '../app/admin/page.tsx'), 'utf8')
    expect(page).toContain('<OutsideUseAdmin token={token} />')
  })
})
