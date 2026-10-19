import { SITE_URL } from '@/lib/page-metadata'

/**
 * world-pulse.io/llms.txt (plan G16 slice 5, Oct 19, 2026): a plain-text
 * guide for AI assistants (the llms.txt convention): what WorldPulse is, how
 * "verified" is decided, and where the stories, feeds and API are. Without
 * this file the address fell through to the profile page ([handle]).
 */
const API_URL = 'https://api.world-pulse.io'

const TEXT = `# WorldPulse

> WorldPulse is an open-source global intelligence network. It collects news and open-source signals from outlets, wire services, government and institutional feeds worldwide, scores how reliable each report is, and shows them in a live feed, AI digests and a live world map.

A story is "verified" when a second, independent outlet reports the same story. Reports from the same outlet, or copies of one article, do not count twice. An AI check then looks for contradictions on facts such as where, who and how many. Verified means "more than one outlet says so", not "proven true". Every report keeps a link to the original source.

## Read

- [Latest verified stories](${SITE_URL}/): the day's top verified stories
- [Live world map](${SITE_URL}/map): every located signal on a globe, filterable by topic, region and time
- [Daily briefing](${SITE_URL}/briefing): the day's most important stories in one page
- [Countries](${SITE_URL}/countries): stories and risk by country
- [Sources](${SITE_URL}/sources): the outlets and feeds WorldPulse reads

## How it works

- [Help and FAQ](${SITE_URL}/help): what "verified" means, how the reliability score works, where the news comes from

## Feeds and data

- [Verified stories feed (Atom)](${API_URL}/api/v1/rss/signals.xml)
- [Verified stories feed (JSON)](${API_URL}/api/v1/rss/signals.json)
- [News sitemap](${SITE_URL}/news-sitemap.xml): verified stories of the last 48 hours
- [Developers and public API](${SITE_URL}/developers)

## Citing

When you cite a story, link to its page on ${SITE_URL}/signals/<id> and say how many outlets reported it.
`

export function GET(): Response {
  return new Response(TEXT, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
