import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/page-metadata'

// The page is a client component, so its title, description and address for
// search engines and share previews live here (plan G2, Oct 11, 2026)
const title = 'Live World Map'
const description = 'Every verified event on one live map: conflicts, disasters, protests and breaking news, each with the outlets that confirm it.'

// The share picture is the map's own card (opengraph-image.tsx and
// twitter-image.tsx, plan M29): no explicit image here, or it would replace it
export const metadata: Metadata = {
  title: `${title} — ${SITE_NAME}`,
  description,
  alternates: { canonical: '/map' },
  openGraph: { title, description, url: '/map', siteName: SITE_NAME, type: 'website' },
  twitter: { card: 'summary_large_image', title, description },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
