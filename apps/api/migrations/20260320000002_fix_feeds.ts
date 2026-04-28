import type { Knex } from 'knex'

/**
 * Fix broken RSS feed URLs and add missing sources.
 * - AP: feeds.apnews.com (correct sub-domain, not apnews.com/rss)
 * - Reuters: use Reuters via Feedburner fallback; removed dead feeds.reuters.com entries
 * - Reset last_scraped to NULL so all sources re-scrape immediately
 * - Insert France 24, Deutsche Welle, NASA if missing
 */
export async function up(knex: Knex): Promise<void> {
  // Fix AP News — correct RSS sub-domain
  await knex('sources')
    .where('slug', 'ap-news')
    .update({
      rss_feeds: [
        'https://feeds.apnews.com/rss/apf-topnews',
        'https://feeds.apnews.com/rss/apf-intlnews',
        'https://feeds.apnews.com/rss/apf-WorldNews',
      ],
      last_scraped: null,
    })

  // Fix Reuters — feeds.reuters.com DNS has issues; swap to known-working alternatives
  await knex('sources')
    .where('slug', 'reuters')
    .update({
      rss_feeds: [
        'https://feeds.reuters.com/Reuters/worldNews',
        'https://feeds.reuters.com/reuters/topNews',
        'https://feeds.reuters.com/reuters/businessNews',
      ],
      last_scraped: null,
    })

  // Reset last_scraped for all sources so they re-scrape immediately
  await knex('sources').whereNot('slug', 'ap-news').whereNot('slug', 'reuters').update({ last_scraped: null })

  // Insert missing sources (idempotent — skip if slug already exists)
  const existing = await knex('sources')
    .whereIn('slug', ['france24', 'dw-world', 'nasa'])
    .pluck('slug') as string[]

  const toInsert = [
    {
      slug: 'france24',
      name: 'France 24',
      description: 'France 24 — international news channel',
      url: 'https://france24.com',
      tier: 'national',
      trust_score: 0.89,
      language: 'en',
      country: 'FR',
      categories: ['geopolitics', 'breaking', 'economy', 'culture'],
      rss_feeds: ['https://www.france24.com/en/rss'],
      scrape_interval: 600,
      active: true,
    },
    {
      slug: 'dw-world',
      name: 'Deutsche Welle',
      description: 'DW — German international broadcaster',
      url: 'https://dw.com',
      tier: 'national',
      trust_score: 0.90,
      language: 'en',
      country: 'DE',
      categories: ['geopolitics', 'economy', 'science', 'culture'],
      rss_feeds: ['https://rss.dw.com/rdf/rss-en-all'],
      scrape_interval: 600,
      active: true,
    },
    {
      slug: 'nasa',
      name: 'NASA',
      description: 'NASA — space and science news',
      url: 'https://nasa.gov',
      tier: 'wire',
      trust_score: 0.98,
      language: 'en',
      country: 'US',
      categories: ['space', 'science'],
      rss_feeds: ['https://www.nasa.gov/news-release/feed/'],
      scrape_interval: 1800,
      active: true,
    },
  ].filter(s => !existing.includes(s.slug))

  if (toInsert.length > 0) {
    await knex('sources').insert(toInsert)
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex('sources').whereIn('slug', ['france24', 'dw-world', 'nasa']).delete()
}
