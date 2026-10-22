'use client'

/**
 * Use from outside on /admin (Oct 22, 2026): the API and the MCP server used by
 * anyone but WorldPulse's own website, a day at a time, the number to watch
 * now that WorldPulse aims to be the counted, sourced layer other tools and AI
 * assistants build on (GET /api/v1/admin/outside-use, apps/api/src/lib/outside-use.ts).
 * Counting started on Oct 22, 2026: the days before show nothing.
 */

import { useEffect, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

/** One day, as the API counts it */
export interface UseDay {
  day: string
  total: number
  withKey: number
  ai: number
  bots: number
  clients: number
  /** WorldPulse's own checks, left out of the total */
  own: number
  routes: Record<string, number>
  mcp: { total: number; tools: Record<string, number> }
}

export interface UseWeek {
  calls: number
  ai: number
  bots: number
  clients: number
  withKey: number
  tools: number
}

/** The totals of the days from `from` (0 is today) for `count` days */
export function weekTotals(days: readonly UseDay[], from = 0, count = 7): UseWeek {
  const w: UseWeek = { calls: 0, ai: 0, bots: 0, clients: 0, withKey: 0, tools: 0 }
  for (const d of days.slice(from, from + count)) {
    w.calls += d.total
    w.ai += d.ai
    w.bots += d.bots
    w.clients += d.clients
    w.withKey += d.withKey
    w.tools += d.mcp.total
  }
  return w
}

const n = (x: number) => x.toLocaleString('en-US')

/** "1,234 calls from outside (AI agents 120 · crawlers 300 · scripts and apps 814; 12 with an API key) · 56 AI-assistant tool calls" */
export function weekLine(w: UseWeek): string {
  if (w.calls === 0 && w.tools === 0) return 'No calls from outside yet.'
  const who = `AI agents ${n(w.ai)} · crawlers ${n(w.bots)} · scripts and apps ${n(w.clients)}`
  const key = w.withKey ? `; ${n(w.withKey)} with an API key` : ''
  return `${n(w.calls)} call${w.calls === 1 ? '' : 's'} from outside (${who}${key}) · ${n(w.tools)} AI-assistant tool call${w.tools === 1 ? '' : 's'}`
}

/** "GET /api/v1/coverage-gap 9 · GET /api/v1/stories 5" (the busiest first, `max` at most) */
export function topLine(counts: Record<string, number>, max = 5): string {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([what, calls]) => `${what} ${n(calls)}`)
    .join(' · ')
}

/** "Oct 22" from "2026-10-22" */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** The card's content, given the days (today first) */
export function OutsideUseView({ days }: { days: readonly UseDay[] }) {
  const thisWeek = weekTotals(days, 0)
  const lastWeek = weekTotals(days, 7)
  const today = days[0]
  const busiest = today ? topLine(today.routes) : ''
  const tools = today ? topLine(today.mcp.tools) : ''
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-wp-text">Last 7 days: {weekLine(thisWeek)}.</p>
      <p className="text-[12px] text-wp-text3">
        The 7 days before: {n(lastWeek.calls)} call{lastWeek.calls === 1 ? '' : 's'} · {n(lastWeek.tools)} tool call{lastWeek.tools === 1 ? '' : 's'}.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] font-mono tabular-nums">
          <thead>
            <tr className="text-wp-text3 text-left">
              <th className="py-1 pr-3 font-normal">Day (UTC)</th>
              <th className="py-1 pr-3 font-normal text-right">Calls</th>
              <th className="py-1 pr-3 font-normal text-right">AI agents</th>
              <th className="py-1 pr-3 font-normal text-right">Crawlers</th>
              <th className="py-1 pr-3 font-normal text-right">Scripts, apps</th>
              <th className="py-1 pr-3 font-normal text-right">With a key</th>
              <th className="py-1 font-normal text-right">MCP tools</th>
            </tr>
          </thead>
          <tbody>
            {days.map(d => (
              <tr key={d.day} className="border-t border-white/5 text-wp-text2">
                <td className="py-1 pr-3">{dayLabel(d.day)}</td>
                <td className="py-1 pr-3 text-right text-wp-text">{n(d.total)}</td>
                <td className="py-1 pr-3 text-right">{n(d.ai)}</td>
                <td className="py-1 pr-3 text-right">{n(d.bots)}</td>
                <td className="py-1 pr-3 text-right">{n(d.clients)}</td>
                <td className="py-1 pr-3 text-right">{n(d.withKey)}</td>
                <td className="py-1 text-right">{n(d.mcp.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {busiest && <p className="text-[12px] text-wp-text2">Most used today: {busiest}</p>}
      {tools && <p className="text-[12px] text-wp-text2">AI-assistant tools today: {tools}</p>}
      <p className="text-[12px] text-wp-text3">
        Counted since Oct 22, 2026. Not counted: the website itself, readers&apos; browsers on world-pulse.io pages, account,
        payment and admin routes, and WorldPulse&apos;s own checks{today?.own ? ` (${n(today.own)} today)` : ''}.
      </p>
    </div>
  )
}

export function OutsideUseAdmin({ token }: { token: string | null }) {
  const [days, setDays] = useState<UseDay[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    fetch(`${API_URL}/api/v1/admin/outside-use?days=14`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const json = await r.json() as { data?: { days?: UseDay[] } }
        setDays(json.data?.days ?? [])
      })
      .catch(err => setError(`Couldn't load the counts (${String(err instanceof Error ? err.message : err)})`))
  }, [token])

  return (
    <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl px-5 py-4">
      <h2 className="text-[12px] font-mono text-wp-text3 uppercase tracking-widest mb-3">Use from outside</h2>
      {error ? (
        <p className="text-[13px] text-wp-red">{error}</p>
      ) : !days ? (
        <p className="text-[13px] text-wp-text3">Loading…</p>
      ) : (
        <OutsideUseView days={days} />
      )}
    </div>
  )
}
