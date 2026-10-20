/**
 * What search engines and share previews read about a page (plan G2,
 * Oct 11, 2026). Until then every page said it was the home page: nginx sent
 * `Link: <https://world-pulse.io>; rel="canonical"` on every response and the
 * root layout set og:url to the home page, and only story pages had a title
 * of their own.
 *
 * Next merges metadata shallowly: a page's `openGraph` or `twitter` replaces
 * the root layout's whole object, so the site name and picture are repeated
 * here, and pages give their own address as canonical and og:url.
 */

import type { Metadata } from 'next'

/** The live site (as the root layout's metadataBase) */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://world-pulse.io').replace(/\/+$/, '')

export const SITE_NAME = 'WorldPulse'

/** The site's own share picture, for pages without one of their own */
export const SITE_IMAGE = { url: '/og-image.png', width: 1200, height: 630, alt: 'WorldPulse' }

export interface PageMetadataInput {
  /** The page's own address, from the site root ("/map") */
  path: string
  /** The page's title; " — WorldPulse" is added */
  title: string
  description: string
  /**
   * A picture for share previews (default: the site's). null for a page with
   * its own picture files (opengraph-image.tsx, twitter-image.tsx): a picture
   * named here would be announced instead of them (Oct 20, 2026: /week showed
   * the site's picture, not its card)
   */
  image?: { url: string; width?: number; height?: number; alt?: string } | null
  type?: 'website' | 'article'
}

/**
 * A description short enough for search results and share cards (they show
 * about 160 characters; story summaries run to 600), cut at a word
 */
export function metaDescription(text: string, max = 200): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/u, '')}…`
}

/** Title, description, canonical address and share preview for one page */
export function pageMetadata({ path, title, description, image = SITE_IMAGE, type = 'website' }: PageMetadataInput): Metadata {
  const full = `${title} — ${SITE_NAME}`
  return {
    title: full,
    description,
    alternates: { canonical: path },
    openGraph: { title: full, description, url: path, siteName: SITE_NAME, type, ...(image ? { images: [image] } : {}) },
    twitter: { card: 'summary_large_image', site: '@WorldPulse_io', title: full, description, ...(image ? { images: [image.url] } : {}) },
  }
}

/** Search-engine-readable facts about a story page (schema.org NewsArticle) */
export function newsArticleJsonLd(s: {
  id: string
  title: string
  description: string
  published?: string | null
  modified?: string | null
  place?: string | null
  image?: string
}): Record<string, unknown> {
  const url = `${SITE_URL}/signals/${s.id}`
  const published = s.published ?? undefined
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: s.title.length > 110 ? `${s.title.slice(0, 109)}…` : s.title,
    description: s.description,
    url,
    mainEntityOfPage: url,
    image: [s.image ?? `${SITE_URL}${SITE_IMAGE.url}`],
    ...(published ? { datePublished: published } : {}),
    ...(s.modified || published ? { dateModified: s.modified ?? published } : {}),
    ...(s.place ? { contentLocation: { '@type': 'Place', name: s.place } } : {}),
    author: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
      logo: { '@type': 'ImageObject', url: `${SITE_URL}${SITE_IMAGE.url}` },
    },
  }
}

/**
 * JSON-LD as script text: "<" written as < so a headline can't close the
 * script tag (as Next's JSON-LD guide advises)
 */
export function jsonLdText(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
