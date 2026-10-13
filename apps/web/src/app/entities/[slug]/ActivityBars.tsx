/**
 * Reports naming an entity per day, 30 bars, drawn on the server (no chart
 * library): one scale for every bar, the busiest day labelled, today's bar
 * paler because the day isn't over.
 */
export function ActivityBars({ name, daily }: { name: string; daily: Array<{ day: string; n: number }> }) {
  const max = Math.max(1, ...daily.map(d => d.n))
  const busiest = daily.reduce((b, d) => (d.n > b.n ? d : b), daily[0] ?? { day: '', n: 0 })
  const total = daily.reduce((n, d) => n + d.n, 0)
  const W = 300, H = 64, gap = 2
  const bw = daily.length > 0 ? (W - gap * (daily.length - 1)) / daily.length : W
  const label = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const summary = total === 0
    ? `No reports named ${name} in the last 30 days.`
    : `Reports naming ${name} per day for the last 30 days: ${total.toLocaleString('en-US')} in all, most on ${label(busiest.day)} (${busiest.n}).`

  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" role="img" aria-label={summary} preserveAspectRatio="none">
        {daily.map((d, i) => {
          const h = d.n === 0 ? 1 : Math.max(2, (d.n / max) * (H - 2))
          const today = i === daily.length - 1
          return (
            <rect key={d.day} x={i * (bw + gap)} y={H - h} width={bw} height={h} rx={1}
              fill={d.n === 0 ? 'rgba(255,255,255,0.08)' : '#f5a623'} opacity={today ? 0.55 : 1}>
              <title>{`${label(d.day)}: ${d.n} report${d.n === 1 ? '' : 's'}${today ? ' so far' : ''}`}</title>
            </rect>
          )
        })}
      </svg>
      <figcaption className="flex justify-between font-mono text-[10px] text-wp-text3 tabular-nums">
        <span>{daily[0] ? label(daily[0].day) : ''}</span>
        {total > 0 && <span>Busiest: {label(busiest.day)} · {busiest.n}</span>}
        <span>Today</span>
      </figcaption>
    </figure>
  )
}
