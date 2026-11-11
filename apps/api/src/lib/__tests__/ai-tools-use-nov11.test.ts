/**
 * AI tool use in public (Devon, Nov 11, 2026: "Yes, ai tools can be public now that we have 100"):
 * lib/outside-use.ts aiToolsUse and readMcpUse, and GET /api/v1/public/ai-tools (routes/mcp.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const h = vi.hoisted(() => ({ hashes: new Map<string, Record<string, string>>(), reads: [] as string[] }))
vi.mock('../../db/redis', () => ({
  redis: {
    hgetall: vi.fn(async (k: string) => { h.reads.push(k); return h.hashes.get(k) ?? {} }),
  },
}))

const { aiToolsUse, readMcpUse, mcpUseKey, AI_TOOLS_DAYS_MAX } = await import('../outside-use')
const { registerAiToolsUseRoute, TOOLS } = await import('../../routes/mcp')

const NOW = new Date('2026-11-11T16:00:00Z')
const dayAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

beforeEach(() => { h.hashes.clear(); h.reads = [] })

describe('aiToolsUse', () => {
  const byDay = [
    { day: '2026-11-11', mcp: { total: '12', top_stories: '7', country_brief: '5' } },
    { day: '2026-11-10', mcp: { total: '30', top_stories: '20', check_link: '10' } },
    { day: '2026-11-09', mcp: null },
    { day: '2026-11-04', mcp: { total: '4', old_tool: '4' } },
  ]

  it('counts today, the last 7 days and all the days, oldest first', () => {
    const u = aiToolsUse(byDay, 100)
    expect(u.offered).toBe(100)
    expect(u.today).toBe(12)
    expect(u.total).toBe(46)
    expect(u.days).toEqual([
      { day: '2026-11-04', calls: 4 }, { day: '2026-11-09', calls: 0 }, { day: '2026-11-10', calls: 30 }, { day: '2026-11-11', calls: 12 },
    ])
    expect(u.toolsUsed).toBe(4)
  })

  it('names the most called tools of the last 7 days, most first', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ day: `d${i}`, mcp: i === 8 ? { total: '50', tool_far_back: '50' } : { total: '3', [`tool_${i}`]: '2', top_stories: '1' } }))
    const u = aiToolsUse([...byDay.slice(0, 2), ...many], 100)
    expect(u.topTools[0]).toEqual({ tool: 'top_stories', calls: 32 })
    // the last 7 days only: a tool used 8 days back isn't among them
    expect(u.topTools.map(t => t.tool)).not.toContain('tool_far_back')
    expect(u.topTools.length).toBeLessThanOrEqual(10)
  })

  it('reads nothing as zero, and no field is a question or an address', () => {
    const u = aiToolsUse([{ day: '2026-11-11', mcp: { total: 'x' } }], 100)
    expect(u).toMatchObject({ today: 0, total: 0, toolsUsed: 0, topTools: [] })
    expect(Object.keys(u).sort()).toEqual(['days', 'last7Days', 'offered', 'today', 'toolsUsed', 'topTools', 'total'])
  })
})

describe('readMcpUse', () => {
  it("reads each UTC day's counts, today first, at most 45 days", async () => {
    h.hashes.set(mcpUseKey(NOW), { total: '3' })
    const r = await readMcpUse({ hgetall: async (k: string) => h.hashes.get(k) ?? {} } as never, 3, NOW)
    expect(r.map(d => d.day)).toEqual(['2026-11-11', '2026-11-10', '2026-11-09'])
    expect(r[0]!.mcp).toEqual({ total: '3' })
    expect((await readMcpUse({ hgetall: async () => ({}) } as never, 500, NOW)).length).toBe(AI_TOOLS_DAYS_MAX)
  })
})

describe('GET /api/v1/public/ai-tools', () => {
  async function app() {
    const a = Fastify({ logger: false })
    await a.register(registerAiToolsUseRoute, { prefix: '/api/v1/public/ai-tools' })
    return a
  }

  it('answers in public with the counts and the number of tools offered', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    try {
      h.hashes.set(mcpUseKey(NOW), { total: '9', top_stories: '9' })
      h.hashes.set(mcpUseKey(dayAgo(1)), { total: '6', country_brief: '6' })
      const a = await app()
      const res = await a.inject({ method: 'GET', url: '/api/v1/public/ai-tools?days=7' })
      expect(res.statusCode).toBe(200)
      expect(res.headers['access-control-allow-origin']).toBe('*')
      const d = res.json().data
      expect(d).toMatchObject({ offered: TOOLS.length, today: 9, last7Days: 15, total: 15, toolsUsed: 2 })
      expect(d.days).toHaveLength(7)
      expect(d.days.at(-1)).toEqual({ day: '2026-11-11', calls: 9 })
      expect(d.topTools).toEqual([{ tool: 'top_stories', calls: 9 }, { tool: 'country_brief', calls: 6 }])
      expect(d.readAt).toBe(NOW.toISOString())
    } finally {
      vi.useRealTimers()
    }
  })

  it('30 days unless 1 to 45 are asked for, and kept a minute', async () => {
    const a = await app()
    expect((await a.inject({ method: 'GET', url: '/api/v1/public/ai-tools' })).json().data.days).toHaveLength(30)
    const reads = h.reads.length
    await a.inject({ method: 'GET', url: '/api/v1/public/ai-tools' })
    expect(h.reads.length).toBe(reads)   // the minute's answer again
    expect((await a.inject({ method: 'GET', url: '/api/v1/public/ai-tools?days=999' })).json().data.days).toHaveLength(30)
    expect((await a.inject({ method: 'GET', url: '/api/v1/public/ai-tools?days=45' })).json().data.days).toHaveLength(45)
  })
})
