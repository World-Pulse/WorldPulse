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

An MCP server at ${API_URL}/mcp (Streamable HTTP, POST JSON-RPC; no sign-in and no key) answers with the outlet count, whether a story is verified and its world-pulse.io link. Tools: top_stories (the stories the most outlets carry in the last 1 to 72 hours, optionally one country's), story (one story with every outlet and its reports), search_reports (reports by meaning), week (WorldPulse Week), check_link (an article's address: how many outlets reported its story, among the articles collected in the last two weeks), under_reported (the crises with the fewest outlets for the people displaced), story_numbers (a story's figures, such as the dead, each with how many outlets give it), outlet (what a news website is: its country, its kind, state media or not), near (the reports pinned near a place), country (a country right now), daily_brief (the Daily Briefing), entity (a person, organisation or place in the news), trend (how coverage of a country or an entity changed, day by day), check_claim (what the newsrooms report about a claim, with their counts; it rules nothing true or false), breaking (the urgent reports of the last few hours), trending (who and what is in the news most), hotspots (where serious reports of several kinds meet), story_by_country (one story country by country: whose newsrooms carry it and how they headline it), shipping (ships, ports, straits and navies, near a chokepoint), hazards (earthquakes, volcanoes, tsunamis, wildfires), latest (the newest verified reports, of one subject or country), how_verified (how a story was checked: its outlets, then each comparison of what they report), story_timeline (who reported a story first and how it spread), conflicts (where conflict and military news is reported), internet_outages (internet outages, from IODA), connections (who and what a person, organisation or place is named with, or the stories naming two of them), protests, outbreaks and displacement (the map's protest, outbreak and refugee reports, place by place), who_covers (the newsrooms WorldPulse reads in a country), day (one day's top stories, from the last 30 days), unconfirmed (serious reports no second outlet has confirmed yet: leads, not facts), newly_verified (reports that just found their second outlet), local_press (stories the world reports while their own country's press barely appears among the outlets), site_check (whether a website is a known AI content farm, and its reliability score), quiet_places (the places whose news most rarely finds a second outlet), story_languages (the languages a story is reported in, with its outlets in each), verified_in_languages (the newest reports in other languages than English that turned verified), languages_today (the languages the news came in, with their reports and verified share), missed_in_english (stories verified in other languages with no English report found), military_aircraft (military aircraft in the air now, from adsb.lol), emergency_flights (aircraft squawking an emergency code now), live_cameras (public traffic and weather cameras near a place), busiest_countries (the countries with the most news in the last 24 hours), news_volume (how much news WorldPulse is reading), similar_reports (the reports closest in meaning to one report), reader_flags (what readers flagged on a report), outlet_mix (what kinds of newsroom carry a story, state media among them), country_compare (two countries side by side) and space_weather (NOAA's space weather alerts). Starter prompts: morning_brief, check_this_link, country_deep_dive.

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
