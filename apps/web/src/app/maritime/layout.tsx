import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'

// The page is a client component, so its title, description and address for
// search engines and share previews live here (H-0023, Oct 20, 2026: about 25
// pages showed the site-wide title, so search engines saw them as one page)
export const metadata: Metadata = pageMetadata({
  path: '/maritime',
  title: 'Maritime: ships, straits and sea news',
  description: 'Ship, port and strait news from the main sea lanes, Hormuz, Bab el-Mandeb, Suez, Malacca and the Black Sea among them, with naval activity and shipping alerts.',
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
