import Link from 'next/link'
import { CommodityCardView, ScoreBadge } from './CommodityCardView'
import { CREDITS, LEVEL_COLOR, baciCredit, dollarsK, monthLabel, partnersText, signedPct, type CommodityOverview, type CountryCommodities, type MapRow, type PricesData, type PriceSeries, type TradeLine } from '@/lib/commodities'

// The commodity watch's page (Oct 23, 2026; Devon: the commodity, weather and trade layer): supply
// risks our sources aren't covering, every commodity's countries, a country's commodities, the
// World Bank's monthly prices, and the watch's record against USDA. Server-rendered: plain links.

const API_ORIGIN = 'https://api.world-pulse.io'

/** The World Bank's series in its file's order, under its own headings */
const PRICE_GROUPS: Array<[string, (key: string) => boolean]> = [
  ['Energy', k => /^(crude-oil|coal|natural-gas|liquefied)/.test(k)],
  ['Beverages', k => /^(cocoa|coffee|tea)/.test(k)],
  ['Food', k => /^(coconut|groundnut|fish-meal|palm|soybean|rapeseed|sunflower|barley|maize|sorghum|rice|wheat|banana|orange|beef|chicken|lamb|shrimp|sugar)/.test(k)],
  ['Raw materials', k => /^(tobacco|logs|sawnwood|plywood|cotton|rubber)/.test(k)],
  ['Fertilizers', k => /^(phosphate|dap|tsp|urea|potassium)/.test(k)],
  ['Metals and minerals', k => /^(aluminum|iron-ore|copper|lead|tin|nickel|zinc)/.test(k)],
  ['Precious metals', k => /^(gold|platinum|silver)/.test(k)],
]

function PriceRow({ s, month }: { s: PriceSeries; month: string | null }) {
  const stale = s.month !== month
  return (
    <tr className="border-t border-white/[0.05]">
      <td className="py-1.5 pr-3 text-wp-text2">{s.name}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums text-wp-text whitespace-nowrap">
        {s.value === null ? '—' : s.value.toLocaleString('en-US')} <span className="text-wp-text3 text-[11px]">{s.unit}</span>
        {stale && s.month && <span className="block text-[10px] text-wp-text3">{monthLabel(s.month)}</span>}
      </td>
      <td className={`py-1.5 pr-3 text-right tabular-nums ${s.change_month_pct !== null && s.change_month_pct < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{stale ? '—' : signedPct(s.change_month_pct)}</td>
      <td className={`py-1.5 text-right tabular-nums ${s.change_year_pct !== null && s.change_year_pct < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{stale ? '—' : signedPct(s.change_year_pct)}</td>
    </tr>
  )
}

function TradeTable({ title, note, lines }: { title: string; note: string; lines: TradeLine[] }) {
  return (
    <div className="mt-6">
      <h2 className="text-base font-semibold text-wp-text">{title}</h2>
      <p className="text-[12px] text-wp-text3 mt-1">{note}</p>
      <ul className="mt-2 divide-y divide-white/[0.05]">
        {lines.map(l => (
          <li key={l.commodity} className="py-1.5 text-[13px] sm:flex sm:gap-3">
            <span className="text-wp-text sm:w-[170px] flex-none">{l.name} <span className="text-wp-text3 tabular-nums text-[12px]">{dollarsK(l.value)}</span></span>
            <span className="text-wp-text2 min-w-0">{partnersText(l, 4)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CommodityRows({ rows }: { rows: MapRow[] }) {
  return (
    <ol className="mt-3 space-y-2">
      {rows.map(r => (
        <li key={r.iso} className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <Link href={`/commodities?country=${r.iso}`} className="text-[14px] font-semibold text-wp-text hover:text-wp-amber">{r.country}</Link>
            <ScoreBadge score={r.score} call={r.call} />
          </div>
          <p className="mt-1 text-[12.5px] text-wp-text2 leading-snug">
            {r.weather_level !== null && <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: LEVEL_COLOR[r.weather_level] ?? LEVEL_COLOR[0] }} aria-hidden="true" />}
            {r.flag && <span className="font-mono text-[9.5px] tracking-[1px] uppercase text-red-300 mr-1.5">Not in the news</span>}
            {r.headline}
          </p>
        </li>
      ))}
    </ol>
  )
}

export function CommodityWatchView({ overview, prices, commodity, country }: {
  overview: CommodityOverview | null
  prices: PricesData | null
  commodity?: { key: string; rows: MapRow[] } | null
  country?: CountryCommodities | null
}) {
  const updated = overview ? new Date(overview.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' }) : null
  const commodityName = commodity ? (overview?.commodities.find(c => c.key === commodity.key)?.name ?? commodity.key) : null
  const groups = new Map<string, CommodityOverview['commodities']>()
  for (const c of overview?.commodities ?? []) {
    const list = groups.get(c.group)
    if (list) list.push(c); else groups.set(c.group, [c])
  }
  const record = overview?.scorecard
  return (
    <div className="min-h-screen bg-wp-bg text-wp-text">
      <main className="max-w-3xl mx-auto px-4 py-10">
        <p className="font-mono text-[11px] tracking-widest uppercase text-wp-text3">Commodity watch{updated ? ` · updated ${updated}` : ''}</p>
        <h1 className="text-2xl font-bold text-wp-text mt-2">
          {country ? `${country.country}: commodities` : commodityName ? `${commodityName}: supply risk by country` : 'Commodity watch'}
        </h1>
        <p className="text-sm text-wp-text2 mt-2 leading-relaxed">
          For every crop USDA forecasts and every country that matters for it: USDA&apos;s crop outlook, the weather forecast over
          the main growing regions at the crop&apos;s stage, trade, prices and hedge funds&apos; bets, and how much our sources are
          saying about it. A plain score from 0 to 100 says how much the supply looks at risk, and when the risk is real but the
          news is quiet, the watch raises a flag.
          {overview && <> Now: {overview.counts.cards.toLocaleString('en-US')} cards for {overview.counts.commodities} commodities, {overview.counts.flags} flagged.</>}
        </p>
        <nav className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {(country || commodity) && <Link href="/commodities" className="text-wp-amber underline">All commodities</Link>}
          <Link href="/map#@15,0,1.8|l=commodities" className="text-wp-amber underline">On the map</Link>
          <a href="#prices" className="text-wp-amber underline">Prices</a>
          <a href="#record" className="text-wp-amber underline">The record</a>
        </nav>

        {!overview && (
          <p className="mt-8 text-[13px] text-wp-text3">The commodity watch hasn&apos;t run yet: it reads USDA&apos;s, the World Bank&apos;s and the weather&apos;s data a few minutes after the data service starts, then every 6 hours.</p>
        )}

        {country && (
          <section className="mt-8">
            {country.flags > 0 && <p className="text-[13px] text-red-200">{country.flags} supply risk{country.flags === 1 ? '' : 's'} our sources aren&apos;t covering.</p>}
            <div className="mt-3 space-y-3">
              {country.cards.map(c => <CommodityCardView key={c.commodity} card={c} />)}
            </div>
            {country.us && country.us.purchases.length > 0 && (
              <div className="mt-6">
                <h2 className="text-base font-semibold text-wp-text">Bought from the US</h2>
                <p className="text-[12px] text-wp-text3 mt-1">USDA&apos;s weekly export sales, the week to {new Date(`${country.us.week_ending}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}: new sales less cancellations, and this marketing year&apos;s shipments.</p>
                <table className="mt-2 w-full text-[13px]">
                  <thead><tr className="text-left font-mono text-[10px] uppercase tracking-[1px] text-wp-text3"><th className="py-1 pr-3 font-normal">Commodity</th><th className="py-1 pr-3 font-normal text-right">This week</th><th className="py-1 font-normal text-right">Shipped this year</th></tr></thead>
                  <tbody>
                    {country.us.purchases.map(p => (
                      <tr key={p.commodity} className="border-t border-white/[0.05]">
                        <td className="py-1.5 pr-3 text-wp-text2 capitalize">{p.name}</td>
                        <td className={`py-1.5 pr-3 text-right tabular-nums ${p.net_sales < 0 ? 'text-red-300' : 'text-wp-text'}`}>{p.net_sales.toLocaleString('en-US')} {p.unit}</td>
                        <td className="py-1.5 text-right tabular-nums text-wp-text2">{p.accumulated.toLocaleString('en-US')} {p.unit}<span className="block text-[10.5px] text-wp-text3">a year earlier {p.prev_year_accumulated.toLocaleString('en-US')}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {country.partners && country.partners.exports.length > 0 && (
              <TradeTable title="Who buys its commodities" note={`Its biggest commodity exports (farm, energy, metals) in ${country.partners.year} and their main buyers, by value (${baciCredit(country.partners)}, from UN trade statistics; Etalab Open Licence 2.0).`} lines={country.partners.exports} />
            )}
            {country.partners && country.partners.imports.length > 0 && (
              <TradeTable title="Where its commodities come from" note={`Its biggest commodity imports in ${country.partners.year} and where they come from, by value.`} lines={country.partners.imports} />
            )}
            <p className="mt-4 text-[12px] text-wp-text3"><Link href={`/countries/${country.iso.toLowerCase()}`} className="text-wp-amber underline">{country.country}&apos;s country page</Link></p>
          </section>
        )}

        {commodity && (
          <section className="mt-8">
            <h2 className="text-base font-semibold text-wp-text">Countries, most at risk first</h2>
            <CommodityRows rows={commodity.rows} />
          </section>
        )}

        {!country && !commodity && overview && (
          <>
            <section className="mt-8">
              <h2 className="text-base font-semibold text-wp-text">Supply risks not in the news</h2>
              {overview.flags.length === 0
                ? <p className="text-[13px] text-wp-text3 mt-2">None right now: where the forecast threatens a crop that matters, our sources are covering it.</p>
                : (
                  <ul className="mt-3 space-y-2">
                    {overview.flags.map(f => (
                      <li key={`${f.commodity}:${f.iso}`} className="rounded-xl border border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.05)] px-3.5 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <Link href={`/commodities?country=${f.iso}`} className="text-[14px] font-semibold text-wp-text hover:text-wp-amber">{f.commodity_name} · {f.country}</Link>
                          <ScoreBadge score={f.score} call={null} />
                        </div>
                        <p className="mt-1 text-[12.5px] text-wp-text2 leading-snug">{f.text}</p>
                      </li>
                    ))}
                  </ul>
                )}
            </section>

            <section className="mt-10">
              <h2 className="text-base font-semibold text-wp-text">Every commodity</h2>
              <div className="mt-3 space-y-5">
                {[...groups].map(([group, list]) => (
                  <div key={group}>
                    <h3 className="font-mono text-[10px] tracking-[1.5px] uppercase text-wp-text3">{group}</h3>
                    <ul className="mt-1.5 grid sm:grid-cols-2 gap-x-6">
                      {list.map(c => (
                        <li key={c.key} className="flex items-center justify-between gap-2 py-1 border-b border-white/[0.04] text-[13px]">
                          <Link href={`/commodities?commodity=${encodeURIComponent(c.key)}`} className="text-wp-text2 hover:text-wp-amber truncate">{c.name}</Link>
                          <span className="flex-none font-mono text-[11px] tabular-nums text-wp-text3">
                            {c.flags > 0 && <span className="text-red-300 mr-2">{c.flags} flag{c.flags === 1 ? '' : 's'}</span>}
                            {c.countries} {c.countries === 1 ? 'country' : 'countries'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {prices && (
          <section id="prices" className="mt-10">
            <h2 className="text-base font-semibold text-wp-text">Prices, {monthLabel(prices.month)}</h2>
            <p className="text-[12px] text-wp-text3 mt-1">The World Bank&apos;s monthly averages in US dollars (the Pink Sheet{prices.updated ? `, updated ${new Date(`${prices.updated}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })}` : ''}), against the month before and a year before. Licensed CC BY 4.0.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr className="text-left font-mono text-[10px] uppercase tracking-[1px] text-wp-text3"><th className="py-1 pr-3 font-normal">Commodity</th><th className="py-1 pr-3 font-normal text-right">Price</th><th className="py-1 pr-3 font-normal text-right">Month</th><th className="py-1 font-normal text-right">Year</th></tr></thead>
                {PRICE_GROUPS.map(([title, test]) => {
                  const list = prices.series.filter(s => test(s.key))
                  return list.length ? (
                    <tbody key={title}>
                      <tr><td colSpan={4} className="pt-3 pb-1 font-mono text-[10px] tracking-[1.5px] uppercase text-wp-text3">{title}</td></tr>
                      {list.map(s => <PriceRow key={s.key} s={s} month={prices.month} />)}
                    </tbody>
                  ) : null
                })}
              </table>
            </div>
          </section>
        )}

        <section id="record" className="mt-10 text-[13px] text-wp-text2 leading-relaxed space-y-2">
          <h2 className="text-base font-semibold text-wp-text">The record</h2>
          <p>
            Each card&apos;s score calls USDA&apos;s next revision of the country&apos;s crop: 50 or more &ldquo;cut likely&rdquo;, 30 to 49
            &ldquo;cut possible&rdquo;, under 30 &ldquo;no cut expected&rdquo;. When USDA revises (grains, oilseeds and cotton every month,
            about the 10th; coffee and sugar twice a year), the last call before it is checked against what USDA did.
          </p>
          {record && Object.keys(record.by_call).length > 0 ? (
            <table className="w-full text-[13px] mt-2">
              <thead><tr className="text-left font-mono text-[10px] uppercase tracking-[1px] text-wp-text3"><th className="py-1 font-normal">Call</th><th className="py-1 font-normal text-right">Calls</th><th className="py-1 font-normal text-right">USDA cut</th><th className="py-1 font-normal text-right">Raised</th><th className="py-1 font-normal text-right">Unchanged</th></tr></thead>
              <tbody>
                {Object.entries(record.by_call).map(([call, r]) => (
                  <tr key={call} className="border-t border-white/[0.05] tabular-nums">
                    <td className="py-1.5 capitalize">{call}</td><td className="py-1.5 text-right">{r.calls}</td><td className="py-1.5 text-right">{r.cut}</td><td className="py-1.5 text-right">{r.raised}</td><td className="py-1.5 text-right">{r.unchanged}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-wp-text3">No revisions checked yet{record ? `: ${record.pending.toLocaleString('en-US')} calls are waiting for USDA` : ''}.</p>
          )}
        </section>

        <section className="mt-10 text-[12px] text-wp-text3 leading-relaxed space-y-2">
          <h2 className="text-[13px] font-semibold text-wp-text2">Sources</h2>
          <p>{CREDITS} Crop calendars after USDA FAS&apos;s; growing regions are the main ones of each main producer.</p>
          <p>The same readings as data, free: <a href={`${API_ORIGIN}/api/v1/commodities`} className="text-wp-amber underline break-all">GET /api/v1/commodities</a> (and /map, /country/&#123;code&#125;, /prices, /weather, /scorecard).</p>
        </section>
      </main>
    </div>
  )
}
