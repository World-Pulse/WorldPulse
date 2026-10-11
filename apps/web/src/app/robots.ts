import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/page-metadata'

/**
 * world-pulse.io/robots.txt (plan G2, Oct 11, 2026): until then the address
 * fell through to the profile page ([handle]) and answered with HTML. Search
 * engines and AI assistants may read every public page; account, admin,
 * embed and search-result pages stay out of search results. ("/developer$"
 * is the API-key page only: a plain "/developer" would also block /developers.)
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/admin', '/settings', '/auth/', '/onboarding', '/embed', '/developer$', '/developer/', '/alerts', '/search'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
