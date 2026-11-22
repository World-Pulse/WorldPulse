/**
 * The AI tools page (/ai/tools; Nov 22, 2026, from the listing kit's plan: "a page listing all 100 tools, each with
 * one example question, so searches like 'news MCP server' or 'AI tool for ship tracking' find WorldPulse"). The
 * groups are tool_guide's kinds of question (apps/api/src/routes/mcp.ts TOOL_GUIDE), in its order; each tool has
 * its title as the server gives it and one question a person would ask an assistant that has WorldPulse added.
 */

export interface AiTool {
  /** The tool's name on the MCP server */
  name: string
  title: string
  /** A question it answers */
  ask: string
}

export interface AiToolGroup {
  id: string
  title: string
  tools: AiTool[]
}

const t = (name: string, title: string, ask: string): AiTool => ({ name, title, ask })

export const AI_TOOL_GROUPS: AiToolGroup[] = [
  {
    id: 'news-now', title: 'The news now', tools: [
      t('world_today', 'The world today in one answer', 'Give me the world in the last 24 hours in one answer.'),
      t('top_stories', 'Top stories now', 'What are the top verified world stories right now?'),
      t('breaking', 'Breaking now', "What's breaking in world news right now?"),
      t('rising_stories', 'New stories spreading fast', 'Which new stories are spreading fastest in the last six hours?'),
      t('whats_new_today', 'What is new since yesterday', "What's in today's news that wasn't there yesterday?"),
      t('most_global_stories', 'The stories the whole world is reporting', 'Which stories are newsrooms in the most countries reporting?'),
      t('long_running_stories', 'The longest-running stories now', 'Which of today’s stories have been running the longest?'),
      t('trending', 'Who and what is in the news', 'Who and what is in the news most today?'),
      t('daily_brief', "Today's briefing", "Give me WorldPulse's daily briefing."),
      t('day', "One day's top stories", 'What were the top stories on November 15?'),
      t('week', "A week's top stories", "What were last week's top stories?"),
      t('news_volume', 'How much news WorldPulse is reading', 'How much news is WorldPulse reading right now?'),
      t('news_by_hour', 'The news hour by hour', 'How did the news flow hour by hour today?'),
      t('news_by_day', 'The news day by day', 'How much news was there each day over the last two weeks?'),
      t('search_reports', 'Search reports by meaning', 'Find reports about drought in the Horn of Africa.'),
    ],
  },
  {
    id: 'one-story', title: 'One story', tools: [
      t('story', 'One story with every outlet', 'Show me every outlet that reported this story.'),
      t('how_verified', 'How a story was checked', 'How was this story verified?'),
      t('story_timeline', 'How a story spread', 'Who reported this story first, and how did it spread?'),
      t('story_by_country', 'One story, country by country', "Which countries' newsrooms carry this story, and how do they headline it?"),
      t('story_numbers', "A story's numbers, counted", 'How many people were killed, according to each outlet?'),
      t('story_languages', 'The languages a story is reported in', 'In which languages is this story reported?'),
      t('outlet_mix', 'What kinds of newsroom carry a story', 'Is this story carried by news agencies, local papers or state media?'),
      t('similar_reports', 'Reports like this one', 'Find reports like this one.'),
      t('story_compare', 'Two stories side by side', 'Compare the coverage of these two stories.'),
      t('report_entities', 'Who and what a report names', 'Who and what does this report name?'),
      t('reader_flags', 'What readers flagged on a report', 'Have readers flagged this report as inaccurate?'),
      t('numbers_differ', 'Top stories whose outlets give different numbers', 'Which top stories have outlets giving different death tolls?'),
    ],
  },
  {
    id: 'places', title: 'A country or a region', tools: [
      t('country', 'A country right now', "What's happening in Sudan right now?"),
      t('country_rank', 'Where a country stands in the news', 'Where does Brazil rank in the world’s news today?'),
      t('country_compare', 'Two countries side by side', 'Compare the news from India and Pakistan this week.'),
      t('country_topics', "What a country's news is about", "What is Nigeria's news about today?"),
      t('country_languages', "The languages a country's news comes in", 'What languages does the news from Switzerland come in?'),
      t('who_reports_on', 'Who reports on a country', 'Which outlets report the most on Ukraine?'),
      t('busiest_countries', 'The countries with the most news now', 'Which countries have the most news right now?'),
      t('rising_countries', 'The countries whose news is rising', "Which countries' news is rising fastest today?"),
      t('region_snapshot', 'A region right now', 'Give me a snapshot of Africa right now.'),
      t('region_top_stories', "A region's top stories", "What are Europe's top stories today?"),
      t('region_topics', "What a region's news is about", 'What is the news in the Middle East about today?'),
      t('compare_regions', 'Two regions side by side', 'Compare the news from Asia and the Americas today.'),
      t('near', 'Reports near a place', 'What verified reports are pinned near Kharkiv?'),
      t('local_press', 'Covered abroad, quiet at home', "Is this story covered by the country's own press, or mostly from abroad?"),
      t('local_only_stories', "Stories only a country's own press reports", 'Which stories is only the Kenyan press reporting?'),
      t('quiet_places', 'Where news goes unconfirmed', 'Where does news most rarely get confirmed by a second outlet?'),
      t('thin_coverage', 'The places WorldPulse reads few newsrooms in', 'In which countries does WorldPulse read the fewest newsrooms?'),
      t('serious_places', 'The countries with the most serious news', 'Which countries have the most serious news right now?'),
      t('hotspots', 'Where the news meets', 'Where are conflict, disaster and unrest reports meeting today?'),
      t('trend', 'How coverage changed', 'How has coverage of Venezuela changed this week?'),
    ],
  },
  {
    id: 'topics', title: 'A topic', tools: [
      t('topic_top_stories', "One topic's top stories", "What are today's top technology stories?"),
      t('topic_countries', "Where one topic's news is", "Where is today's health news coming from?"),
      t('topic_trend', 'One topic day by day', 'How has election news changed over the last two weeks?'),
      t('topics_today', 'The topics of the news now', 'What topics is the news about today?'),
      t('latest', 'The latest verified reports', 'What are the latest verified reports on the economy?'),
      t('conflicts', 'Where fighting is reported', 'Where is fighting being reported?'),
      t('protests', 'Protests and unrest', 'Where are protests and strikes happening?'),
      t('outbreaks', 'Disease outbreaks', 'Are any disease outbreaks in the news?'),
      t('displacement', 'Refugees and displacement', 'Where are refugees and displaced people in the news?'),
      t('elections_watch', 'Elections in the news', "Which countries' elections are in the news this week?"),
      t('disaster_news', 'Disasters in the news', 'What disasters are in the news this week?'),
      t('cyber_attacks', 'Cyber attacks in the news', 'Which countries are in the news for cyber attacks?'),
      t('under_reported', 'Under-reported crises', 'Which crises are getting the least coverage this week?'),
    ],
  },
  {
    id: 'names', title: 'People, organisations and places by name', tools: [
      t('entity', 'Who or what is in the news', "What's in the news about the WHO?"),
      t('entity_compare', 'Two people, organisations or places side by side', 'Compare the news coverage of NATO and the EU.'),
      t('connections', 'Who and what is in the news together', 'Who is in the news together with Elon Musk?'),
    ],
  },
  {
    id: 'outlets', title: 'Outlets', tools: [
      t('outlet', 'What an outlet is', 'Is reuters.com a news agency, and where is it based?'),
      t('find_outlet', 'Find a news outlet by name', 'Find the outlet called Daily Nation.'),
      t('outlet_profile', 'What an outlet reports about', 'What does Al Jazeera mostly report about?'),
      t('outlet_reports', "One outlet's newest reports", 'What has bbc.co.uk reported most recently?'),
      t('outlet_compare', 'Two outlets side by side', 'Compare what The Guardian and Fox News report about.'),
      t('busiest_outlets', 'The outlets with the most reports now', 'Which outlets is WorldPulse reading the most from today?'),
      t('first_reporters', 'The outlets that report first', 'Which outlets most often report a story first?'),
      t('state_media_outlets', 'The state-run outlets WorldPulse reads', 'Which state-run outlets does WorldPulse read?'),
      t('state_media_stories', 'Top stories carried by state media', "How much of today's top stories comes from state media?"),
      t('outlet_languages', 'The languages of the newsrooms WorldPulse reads', 'In which languages do the newsrooms WorldPulse reads write?'),
      t('who_covers', 'The newsrooms WorldPulse reads in a country', 'Which newsrooms does WorldPulse read in Peru?'),
      t('coverage_stats', 'How much of the world WorldPulse reads', 'How many newsrooms, countries and languages does WorldPulse cover?'),
      t('site_check', 'Is this site a content farm?', 'Is this website an AI content farm?'),
    ],
  },
  {
    id: 'checking', title: 'Checking a link, a claim or a lead', tools: [
      t('check_link', 'Check a link', 'How many outlets reported this? (paste a news link)'),
      t('check_claim', 'Check a claim against the newsrooms', 'Do several newsrooms report that an earthquake hit Japan this week, or just one?'),
      t('unconfirmed', 'Reports waiting for a second outlet', "Which serious reports haven't been confirmed by a second outlet yet?"),
      t('newly_verified', 'Just verified', 'Which reports were just verified?'),
      t('verification_speed', 'How fast stories get verified', 'How fast are stories getting verified today?'),
      t('verified_in_languages', 'Just verified, in other languages', 'Which stories were just verified in languages other than English?'),
      t('missed_in_english', 'Verified, but not in English', 'Which stories are verified in other languages but missing in English?'),
      t('languages_today', 'The languages the news came in', "What languages did today's news come in?"),
    ],
  },
  {
    id: 'live', title: 'Live layers', tools: [
      t('military_aircraft', 'Military aircraft in the air now', 'Which military aircraft are flying near Taiwan right now?'),
      t('emergency_flights', 'Aircraft squawking an emergency now', 'Is any aircraft squawking an emergency right now?'),
      t('shipping', 'Ships, ports, straits and navies', 'What is the news on shipping near the Strait of Hormuz?'),
      t('chokepoints_news', 'The shipping chokepoints in the news', 'Which shipping chokepoints are in the news?'),
      t('carrier_groups', "Where the US Navy's carriers are", "Where are the US Navy's aircraft carriers?"),
      t('hazards', 'Earthquakes, volcanoes, tsunamis and wildfires', 'Have there been any big earthquakes in the last two days?'),
      t('space_weather', 'Space weather alerts', 'Is there a geomagnetic storm alert today?'),
      t('internet_outages', 'Internet outages', 'Where are internet outages happening right now?'),
      t('live_cameras', 'Public live cameras near a place', 'Are there live traffic cameras near London Bridge?'),
    ],
  },
  {
    id: 'government', title: 'Government feeds', tools: [
      t('sanctions_actions', 'New sanctions actions', 'What new sanctions did the US Treasury and the EU announce?'),
      t('us_weather_alerts', 'US severe weather alerts', 'Are there tornado warnings in Texas right now?'),
      t('exploited_vulnerabilities', 'Software flaws attackers are using', 'Which software flaws are attackers exploiting this month?'),
      t('travel_advice', 'Travel advice for a country', 'What do the US and UK advise about travel to Haiti?'),
    ],
  },
  {
    id: 'worldpulse', title: 'WorldPulse itself', tools: [
      t('how_worldpulse_counts', 'How WorldPulse counts and verifies', 'How does WorldPulse count outlets and verify stories?'),
      t('worldpulse_status', 'Is WorldPulse up and reading the news', 'Is WorldPulse up right now?'),
      t('tool_guide', 'Which WorldPulse tool to use', 'Which WorldPulse tool should I use for my question?'),
    ],
  },
]

export const AI_TOOLS: AiTool[] = AI_TOOL_GROUPS.flatMap(g => g.tools)

/** A description's first sentence ("(e.g. Sudan)" doesn't end one), at most 240 characters */
export function firstSentence(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim()
  const re = /[.!?](?=\s|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const before = s.slice(Math.max(0, m.index - 4), m.index + 1).toLowerCase()
    if (/(e\.g\.|i\.e\.|\bvs\.|\bno\.)$/.test(before)) continue
    const out = s.slice(0, m.index + 1)
    return out.length > 240 ? `${out.slice(0, 239).trimEnd()}…` : out
  }
  return s.length > 240 ? `${s.slice(0, 239).trimEnd()}…` : s
}
