/**
 * ai-content-farms.ts — Known AI content farm domain blocklist
 *
 * Seeded from public research: NewsGuard AI Content Farm tracker,
 * CCDH "Cheap Fakes" report, and community-contributed lists.
 *
 * Growth rate: 300-500 new AI content farm sites per month (NewsGuard, 2026).
 * NewsGuard currently tracks 3,006+ sites.
 *
 * Domains here represent high-confidence AI content farm / clickbait mills
 * with no identifiable editorial staff, missing bylines, and fabricated content.
 */

export const KNOWN_AI_CONTENT_FARMS: readonly string[] = [
  // Confirmed AI content farms (NewsGuard / CCDH public reports)
  'dailytrendingnews.net',
  'thenewsglobe.net',
  'newsnow24.co',
  'morningtidings.com',
  'usanewsflash.com',
  'worldnewsdaily24.com',
  'breakingnewsreporter.com',
  'globalheadlines24.net',
  'politicswatch24.com',
  'newsbreakfeed.co',
  'usadailytimes.com',
  'nationalnewsbrief.com',
  'trendingreporters.com',
  'fastbreaking.news',
  'thepoliticsnews.com',
  'realclearnewsfeed.com',
  'dailynewspulse.net',
  'theamericas24.com',
  'worldpresswire.io',
  'urgentdispatch.net',
  'allnewsupdate.net',
  'headlineinsider.com',
  'justintrendstoday.com',
  'currentnewspaper.net',
  'flashbulletinnews.com',
] as const

export default KNOWN_AI_CONTENT_FARMS
