import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { pageMetadata } from '@/lib/page-metadata'
import { fetchCountry, fetchMap, fetchOverview, fetchPrices } from '@/lib/commodities-fetch'
import { CommodityWatchView } from '@/components/commodities/CommodityWatchView'

// The commodity watch (Oct 23, 2026): /commodities, /commodities?commodity=coffee,
// /commodities?country=BR. The flags' links in the feed come here.

type Search = Promise<Record<string, string | string[] | undefined>>

function read(q: Record<string, string | string[] | undefined>): { commodity?: string; country?: string } {
  const commodity = typeof q.commodity === 'string' && /^[a-z0-9-]{2,40}$/.test(q.commodity) ? q.commodity : undefined
  const country = typeof q.country === 'string' && /^[A-Za-z]{2}$/.test(q.country) ? q.country.toUpperCase() : undefined
  return { commodity, country }
}

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const { commodity, country } = read(await searchParams)
  const description = "Supply risk for every crop USDA forecasts and every country that matters for it: USDA's outlook, the weather over the growing regions, trade, prices, hedge funds and the news, with a flag when a real risk isn't in the news."
  if (country) {
    const data = await fetchCountry(country)
    if (data && data.available) return pageMetadata({ path: `/commodities?country=${country}`, title: `${data.country}: commodities and supply risk`, description })
  }
  if (commodity) {
    const overview = await fetchOverview()
    const name = overview && overview.available ? overview.commodities.find(c => c.key === commodity)?.name : undefined
    if (name) return pageMetadata({ path: `/commodities?commodity=${commodity}`, title: `${name}: supply risk by country`, description })
  }
  return pageMetadata({ path: '/commodities', title: 'Commodity watch: supply risks not in the news', description })
}

export default async function Page({ searchParams }: { searchParams: Search }) {
  const { commodity, country } = read(await searchParams)
  const [overview, prices, map, countryData] = await Promise.all([
    fetchOverview(),
    fetchPrices(),
    commodity && !country ? fetchMap(commodity) : Promise.resolve(null),
    country ? fetchCountry(country) : Promise.resolve(null),
  ])
  if (country && countryData === null) notFound()
  if (commodity && !country && map === null) notFound()
  return (
    <CommodityWatchView
      overview={overview && overview.available ? overview : null}
      prices={prices && prices.available ? prices : null}
      commodity={commodity && map && map.available ? { key: commodity, rows: map.rows } : null}
      country={countryData && countryData.available ? countryData : null}
    />
  )
}
