import { SITE_URL } from '@/lib/page-metadata'

/**
 * world-pulse.io/llms.txt (plan G16 slice 5, Oct 19, 2026): a plain-text
 * guide for AI assistants (the llms.txt convention): what WorldPulse is, how
 * "verified" is decided, and where the stories, feeds and API are. Without
 * this file the address fell through to the profile page ([handle]).
 */
const API_URL = 'https://api.world-pulse.io'

const TEXT = `# WorldPulse

> WorldPulse shows how many independent newsrooms reported each world story, and which ones. It is open source. It collects news and open-source signals from outlets, wire services, government and institutional feeds worldwide, groups the reports of each event into one story, scores how reliable each report is, and shows them in a live feed, a weekly list of top stories, AI digests and a live world map.

A story is "verified" when two or more outlets (websites) report it and its reliability score reaches 65%. Reports from the same outlet, or copies of one article, do not count twice. An AI check then looks for contradictions on facts such as where, who and how many. Verified means "more than one outlet says so", not "proven true". Every report keeps a link to the original source.

## Read

- [Latest verified stories](${SITE_URL}/): the day's top verified stories
- [Live world map](${SITE_URL}/map): every located signal on a globe, filterable by topic, region and time
- [Daily briefing](${SITE_URL}/briefing): the day's most important stories in one page
- [WorldPulse Week](${SITE_URL}/week): the week's top stories, ranked by how many outlets reported each
- [Under-reported crises](${SITE_URL}/under-reported): the countries with at least a million people displaced (UNHCR's figures), ranked by how few outlets reported on them this week
- [Countries](${SITE_URL}/countries): stories and risk by country
- [Sources](${SITE_URL}/sources): the outlets and feeds WorldPulse reads

## How it works

- [How we count independent outlets](${SITE_URL}/how-we-count): what "N outlets" and "Verified" mean, and what the count cannot tell you
- [Help and FAQ](${SITE_URL}/help): what "verified" means, how the reliability score works, where the news comes from

## Feeds and data

- [Verified stories feed (Atom)](${API_URL}/api/v1/rss/signals.xml)
- [Verified stories feed (JSON)](${API_URL}/api/v1/rss/signals.json)
- [News sitemap](${SITE_URL}/news-sitemap.xml): verified stories of the last 48 hours
- [Developers and public API](${SITE_URL}/developers)

## For AI assistants (MCP)

An MCP server at ${API_URL}/mcp (Streamable HTTP, POST JSON-RPC; no sign-in and no key) answers with the outlet count, whether a story is verified and its world-pulse.io link. Tools: top_stories (the stories the most outlets carry in the last 1 to 72 hours, optionally one country's), story (one story with every outlet and its reports), search_reports (reports by meaning), week (WorldPulse Week), check_link (an article's address: how many outlets reported its story, among the articles collected in the last two weeks) and under_reported (the crises with the fewest outlets for the people displaced).

## Citing

When you cite a story, link to its page on ${SITE_URL}/signals/<id> and say how many outlets reported it.

## Using the data

Personal, research, education and non-profit use of the hosted API is free, with a link back to world-pulse.io. Commercial use, in your own work and products, comes with WorldPulse Pro ($12 a month, https://world-pulse.io/pricing), with a link back; a Pro API key also gets its own budget (600 requests a minute, 50,000 a day). Reselling or redistributing the data needs a data license: email support@world-pulse.io. The code is open source under the MIT license.
`

export function GET(): Response {
  return new Response(TEXT, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
