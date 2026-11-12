import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import MapPage from '../../page'
import { SITE_NAME } from '@/lib/page-metadata'
import { dayDescription, dayTitle, parseDay } from '@/lib/map-day-card'
import { fetchDayCard } from '@/lib/map-day-card-image'

// A morning video's own link (Nov 12, 2026): the live map, under an address whose share picture is that
// day's video card (opengraph-image.tsx here), so the picture under the video says the video's numbers
// and X can't show a copy saved on another day. Search engines are pointed at /map.
export async function generateMetadata({ params }: { params: Promise<{ date: string }> }): Promise<Metadata> {
  const { date } = await params
  const day = parseDay(date)
  if (!day) return { title: `Live World Map — ${SITE_NAME}`, robots: { index: false, follow: true } }
  const title = dayTitle(day)
  const description = dayDescription(await fetchDayCard(day))
  return {
    title: `${title} — ${SITE_NAME}`,
    description,
    alternates: { canonical: '/map' },
    robots: { index: false, follow: true },
    openGraph: { title, description, url: `/map/day/${day}`, siteName: SITE_NAME, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function MapDayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params
  if (!parseDay(date)) notFound()
  return <MapPage />
}
