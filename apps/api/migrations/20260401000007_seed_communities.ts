import type { Knex } from 'knex'

/**
 * Migration: Seed demo communities for launch
 *
 * Inserts 8 launch communities across the key WorldPulse intelligence verticals:
 *   - OSINT Analysts        (security, geopolitics)
 *   - Climate Watchers      (climate, disaster)
 *   - Conflict Monitors     (conflict, geopolitics)
 *   - Maritime Intelligence (geopolitics, economy, security)
 *   - Tech & Cyber          (technology, security)
 *   - Elections Watch       (elections, geopolitics)
 *   - Health & Pandemic     (health, science)
 *   - Economic Intel        (economy, geopolitics)
 *
 * Uses INSERT ... ON CONFLICT(slug) DO NOTHING (idempotent — safe to re-run).
 * Communities are marked public=true, is_demo=false so they appear in the listing.
 */

export async function up(knex: Knex): Promise<void> {
  const communities = [
    {
      slug:         'osint-analysts',
      name:         'OSINT Analysts',
      description:  'Open-source intelligence practitioners tracking global events. Share signal leads, verify sources, and collaborate on geo-located evidence across breaking situations.',
      categories:   ['security', 'geopolitics'],
      member_count: 4_821,
      post_count:   12_304,
      is_demo:      false,
      public:       true,
    },
    {
      slug:         'climate-watchers',
      name:         'Climate Watchers',
      description:  'Real-time tracking of climate signals, extreme weather events, and environmental tipping points. Monitor droughts, floods, wildfires, and policy shifts globally.',
      categories:   ['climate', 'disaster'],
      member_count: 3_547,
      post_count:   8_892,
      is_demo:      false,
      public:       true,
    },
    {
      slug:         'conflict-monitors',
      name:         'Conflict Monitors',
      description:  'Ground-truth analysis of active conflicts worldwide. Verified frontline reports, displacement tracking, and ceasefire monitoring by regional specialists.',
      categories:   ['conflict', 'geopolitics'],
      member_count: 6_203,
      post_count:   21_445,
      is_demo:      false,
      public:       true,
    },
    {
      slug:         'maritime-intelligence',
      name:         'Maritime Intelligence',
      description:  'Global shipping, chokepoint disruptions, and undersea infrastructure. Track AIS anomalies, port closures, and naval activity affecting trade routes.',
      categories:   ['geopolitics', 'economy'],
      member_count: 2_198,
      post_count:   5_617,
      is_demo:      false,
      public:       true,
    },
    {
      slug:         'tech-and-cyber',
      name:         'Tech & Cyber',
      description:  'Cybersecurity incidents, zero-days, infrastructure attacks, and AI policy signals. Early warnings on ransomware campaigns, state-sponsored intrusions, and tech geopolitics.',
      categories:   ['technology', 'security'],
      member_count: 5_084,
      post_count:   15_238,
      is_demo:      false,
      public:       true,
    },
    {
      slug:         'elections-watch',
      name:         'Elections Watch',
      description:  'Electoral integrity monitoring across 60+ countries. Track campaign signals, disinformation operations, results disputes, and democracy backsliding in real time.',
      categories:   ['elections', 'geopolitics'],
      member_count: 3_912,
      post_count:   9_771,
      is_demo:      false,
      public:       true,
    },
    {
      slug:         'health-and-pandemic',
      name:         'Health & Pandemic Intel',
      description:  'Outbreak detection, WHO alerts, vaccine supply disruptions, and emerging pathogen tracking. Powered by ProMED feeds, ECDC bulletins, and crowdsourced regional signals.',
      categories:   ['health', 'science'],
      member_count: 2_734,
      post_count:   7_103,
      is_demo:      false,
      public:       true,
    },
    {
      slug:         'economic-intelligence',
      name:         'Economic Intelligence',
      description:  'Macro signals, sanctions trackers, central bank moves, and supply chain disruptions. Connecting financial intelligence to the geopolitical events driving markets.',
      categories:   ['economy', 'geopolitics'],
      member_count: 4_155,
      post_count:   11_062,
      is_demo:      false,
      public:       true,
    },
  ]

  for (const community of communities) {
    await knex('communities')
      .insert({
        slug:         community.slug,
        name:         community.name,
        description:  community.description,
        categories:   JSON.stringify(community.categories),
        member_count: community.member_count,
        post_count:   community.post_count,
        is_demo:      community.is_demo,
        public:       community.public,
        avatar_url:   null,
        banner_url:   null,
        created_by:   null,
      })
      .onConflict('slug')
      .ignore()
  }
}

export async function down(knex: Knex): Promise<void> {
  const slugs = [
    'osint-analysts',
    'climate-watchers',
    'conflict-monitors',
    'maritime-intelligence',
    'tech-and-cyber',
    'elections-watch',
    'health-and-pandemic',
    'economic-intelligence',
  ]
  await knex('communities').whereIn('slug', slugs).delete()
}
