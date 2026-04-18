import type { Knex } from 'knex'

/**
 * Migration: Add premium finance sources
 *
 * Adds 9 high-quality finance/markets RSS sources to complement the existing
 * Tier 4 finance feeds (Bloomberg Markets, Reuters Business, FT, MarketWatch,
 * CoinDesk, The Block, ECB, Federal Reserve).
 *
 *   Barron's, CNBC Markets, CNN Business, TheStreet Markets,
 *   Investing.com, WSJ Markets, Forbes Money, Bloomberg Businessweek,
 *   Reuters Markets Wire
 *
 * Uses INSERT ... ON CONFLICT DO NOTHING (idempotent — safe to re-run).
 */

export async function up(knex: Knex): Promise<void> {
  const sources = [
    {
      slug:            'barrons-markets',
      name:            "Barron's",
      description:     'Dow Jones financial weekly — market analysis, investment ideas, stock picks, fund ratings',
      url:             'https://www.barrons.com',
      tier:            'premium',
      trust_score:     0.86,
      language:        'en',
      country:         'US',
      categories:      JSON.stringify(['finance', 'markets', 'investing']),
      rss_feeds:       JSON.stringify(['https://www.barrons.com/feed']),
      scrape_interval: 1800,
      active:          true,
    },
    {
      slug:            'cnbc-markets',
      name:            'CNBC Markets',
      description:     'NBCUniversal financial news — US & global markets, earnings, IPOs, economic data',
      url:             'https://www.cnbc.com/markets/',
      tier:            'premium',
      trust_score:     0.82,
      language:        'en',
      country:         'US',
      categories:      JSON.stringify(['finance', 'markets', 'business']),
      rss_feeds:       JSON.stringify(['https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258']),
      scrape_interval: 1800,
      active:          true,
    },
    {
      slug:            'cnn-business',
      name:            'CNN Business',
      description:     'CNN financial coverage — markets, economy, tech business, personal finance',
      url:             'https://www.cnn.com/markets',
      tier:            'major',
      trust_score:     0.80,
      language:        'en',
      country:         'US',
      categories:      JSON.stringify(['finance', 'markets', 'economy']),
      rss_feeds:       JSON.stringify(['http://rss.cnn.com/rss/money_latest.rss']),
      scrape_interval: 1800,
      active:          true,
    },
    {
      slug:            'thestreet-markets',
      name:            'TheStreet Markets',
      description:     'Jim Cramer-founded financial media — stock analysis, market commentary, investing strategies',
      url:             'https://www.thestreet.com/markets',
      tier:            'major',
      trust_score:     0.78,
      language:        'en',
      country:         'US',
      categories:      JSON.stringify(['finance', 'markets', 'stocks']),
      rss_feeds:       JSON.stringify(['https://www.thestreet.com/feeds/rss/markets']),
      scrape_interval: 1800,
      active:          true,
    },
    {
      slug:            'investing-com-news',
      name:            'Investing.com',
      description:     'Global financial portal — real-time quotes, charts, forex, commodities, crypto news',
      url:             'https://www.investing.com/markets/',
      tier:            'major',
      trust_score:     0.76,
      language:        'en',
      country:         'CY',
      categories:      JSON.stringify(['finance', 'markets', 'forex', 'commodities']),
      rss_feeds:       JSON.stringify(['https://www.investing.com/rss/news.rss']),
      scrape_interval: 1800,
      active:          true,
    },
    {
      slug:            'wsj-markets',
      name:            'Wall Street Journal — Markets',
      description:     'Dow Jones flagship — market data, corporate finance, economic policy, global trade',
      url:             'https://www.wsj.com/finance',
      tier:            'premium',
      trust_score:     0.88,
      language:        'en',
      country:         'US',
      categories:      JSON.stringify(['finance', 'markets', 'business', 'economy']),
      rss_feeds:       JSON.stringify(['https://feeds.a.dj.com/rss/RSSMarketsMain.xml']),
      scrape_interval: 1800,
      active:          true,
    },
    {
      slug:            'forbes-money',
      name:            'Forbes Money',
      description:     'Forbes finance vertical — personal finance, investing, taxes, wealth management',
      url:             'https://www.forbes.com/money/',
      tier:            'major',
      trust_score:     0.80,
      language:        'en',
      country:         'US',
      categories:      JSON.stringify(['finance', 'personal-finance', 'investing']),
      rss_feeds:       JSON.stringify(['https://www.forbes.com/money/feed/']),
      scrape_interval: 1800,
      active:          true,
    },
    {
      slug:            'bloomberg-businessweek',
      name:            'Bloomberg Businessweek',
      description:     'Bloomberg long-form business journalism — corporate strategy, global economics, tech industry',
      url:             'https://www.bloomberg.com/businessweek',
      tier:            'premium',
      trust_score:     0.87,
      language:        'en',
      country:         'US',
      categories:      JSON.stringify(['finance', 'business', 'economy']),
      rss_feeds:       JSON.stringify(['https://feeds.bloomberg.com/businessweek/news.rss']),
      scrape_interval: 1800,
      active:          true,
    },
    {
      slug:            'reuters-markets-wire',
      name:            'Reuters Markets Wire',
      description:     'Reuters company & markets wire — earnings, M&A, corporate governance, sector analysis',
      url:             'https://www.reuters.com/markets/',
      tier:            'premium',
      trust_score:     0.90,
      language:        'en',
      country:         'GB',
      categories:      JSON.stringify(['finance', 'markets', 'corporate']),
      rss_feeds:       JSON.stringify(['https://feeds.reuters.com/reuters/companyNews']),
      scrape_interval: 1800,
      active:          true,
    },
  ]

  for (const source of sources) {
    await knex('sources')
      .insert(source)
      .onConflict('slug')
      .ignore()
  }
}

export async function down(knex: Knex): Promise<void> {
  const slugs = [
    'barrons-markets',
    'cnbc-markets',
    'cnn-business',
    'thestreet-markets',
    'investing-com-news',
    'wsj-markets',
    'forbes-money',
    'bloomberg-businessweek',
    'reuters-markets-wire',
  ]

  await knex('sources').whereIn('slug', slugs).del()
}
