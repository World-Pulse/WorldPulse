import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/page-metadata'

/**
 * world-pulse.io/robots.txt (plan G2, Oct 11, 2026): until then the address
 * fell through to the profile page ([handle]) and answered with HTML. Search
 * engines and AI assistants may read every public page; account, admin,
 * embed and search-result pages stay out of search results. ("/developer$"
 * is the API-key page only: a plain "/developer" would also block /developers.)
 *
 * Oct 19, 2026 (Devon: "Ask AionBot to stop, only if there isn't a way to
 * monetize them"): AionBot is asked to stay away. It read 4,616 pages by noon
 * that day, more than any other bot; nobody names who runs it (Udger: "Unknown
 * Author", a web scraper on Oracle Cloud since Aug 2026), it isn't in any
 * pay-to-crawl marketplace and it sends no readers, so there is no one to
 * charge. Crawler directories say it obeys robots.txt. Every other bot reads
 * as before; machines that want the stories in bulk have the API (/llms.txt
 * points there).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/admin', '/settings', '/auth/', '/onboarding', '/embed', '/developer$', '/developer/', '/alerts', '/search'],
      },
      { userAgent: 'AionBot', disallow: '/' },
    ],
    sitemap: [`${SITE_URL}/sitemap.xml`, `${SITE_URL}/news-sitemap.xml`],
    host: SITE_URL,
  }
}
