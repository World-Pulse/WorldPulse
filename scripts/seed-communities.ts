#!/usr/bin/env tsx
/**
 * WorldPulse — Community Seed Script
 *
 * Populates the communities table with 8 launch communities covering the
 * core WorldPulse intelligence verticals.
 *
 * Usage (from monorepo root):
 *   DATABASE_URL=postgres://... tsx scripts/seed-communities.ts
 *
 *   — or —
 *
 *   cp apps/api/.env .env && tsx scripts/seed-communities.ts
 *
 * Safe to re-run: uses INSERT ... ON CONFLICT(slug) DO NOTHING (idempotent).
 */

import 'dotenv/config'
import Knex from 'knex'

// ─── DB connection ────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('[seed-communities] ERROR: DATABASE_URL environment variable is not set.')
  console.error('  Set it directly or copy apps/api/.env to the monorepo root.')
  process.exit(1)
}

const db = Knex({
  client: 'pg',
  connection: {
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  },
})

// ─── Community definitions ────────────────────────────────────────────────────

interface CommunityDef {
  slug:         string
  name:         string
  description:  string
  categories:   string[]
  member_count: number
  post_count:   number
}

const COMMUNITIES: CommunityDef[] = [
  {
    slug:         'osint-analysts',
    name:         'OSINT Analysts',
    description:  'Open-source intelligence practitioners tracking global events. Share signal leads, verify sources, and collaborate on geo-located evidence across breaking situations.',
    categories:   ['security', 'geopolitics'],
    member_count: 4_821,
    post_count:   12_304,
  },
  {
    slug:         'climate-watchers',
    name:         'Climate Watchers',
    description:  'Real-time tracking of climate signals, extreme weather events, and environmental tipping points. Monitor droughts, floods, wildfires, and policy shifts globally.',
    categories:   ['climate', 'disaster'],
    member_count: 3_547,
    post_count:   8_892,
  },
  {
    slug:         'conflict-monitors',
    name:         'Conflict Monitors',
    description:  'Ground-truth analysis of active conflicts worldwide. Verified frontline reports, displacement tracking, and ceasefire monitoring by regional specialists.',
    categories:   ['conflict', 'geopolitics'],
    member_count: 6_203,
    post_count:   21_445,
  },
  {
    slug:         'maritime-intelligence',
    name:         'Maritime Intelligence',
    description:  'Global shipping, chokepoint disruptions, and undersea infrastructure. Track AIS anomalies, port closures, and naval activity affecting trade routes.',
    categories:   ['geopolitics', 'economy'],
    member_count: 2_198,
    post_count:   5_617,
  },
  {
    slug:         'tech-and-cyber',
    name:         'Tech & Cyber',
    description:  'Cybersecurity incidents, zero-days, infrastructure attacks, and AI policy signals. Early warnings on ransomware campaigns, state-sponsored intrusions, and tech geopolitics.',
    categories:   ['technology', 'security'],
    member_count: 5_084,
    post_count:   15_238,
  },
  {
    slug:         'elections-watch',
    name:         'Elections Watch',
    description:  'Electoral integrity monitoring across 60+ countries. Track campaign signals, disinformation operations, results disputes, and democracy backsliding in real time.',
    categories:   ['elections', 'geopolitics'],
    member_count: 3_912,
    post_count:   9_771,
  },
  {
    slug:         'health-and-pandemic',
    name:         'Health & Pandemic Intel',
    description:  'Outbreak detection, WHO alerts, vaccine supply disruptions, and emerging pathogen tracking. Powered by ProMED feeds, ECDC bulletins, and crowdsourced regional signals.',
    categories:   ['health', 'science'],
    member_count: 2_734,
    post_count:   7_103,
  },
  {
    slug:         'economic-intelligence',
    name:         'Economic Intelligence',
    description:  'Macro signals, sanctions trackers, central bank moves, and supply chain disruptions. Connecting financial intelligence to the geopolitical events driving markets.',
    categories:   ['economy', 'geopolitics'],
    member_count: 4_155,
    post_count:   11_062,
  },
]

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[seed-communities] Starting community seed...\n')

  let inserted = 0
  let skipped  = 0

  for (const community of COMMUNITIES) {
    try {
      const result = await db('communities')
        .insert({
          slug:         community.slug,
          name:         community.name,
          description:  community.description,
          categories:   JSON.stringify(community.categories),
          member_count: community.member_count,
          post_count:   community.post_count,
          is_demo:      false,
          public:       true,
          avatar_url:   null,
          banner_url:   null,
          created_by:   null,
        })
        .onConflict('slug')
        .ignore()
        .returning('id')

      if (result.length > 0) {
        console.log(`  ✅ Inserted: ${community.name} (${community.slug})`)
        inserted++
      } else {
        console.log(`  ⏭  Skipped (already exists): ${community.name}`)
        skipped++
      }
    } catch (err) {
      console.error(`  ❌ Error inserting "${community.name}":`, err)
    }
  }

  console.log(`\n[seed-communities] Done: ${inserted} inserted, ${skipped} already existed.`)
  await db.destroy()
}

main().catch((err) => {
  console.error('[seed-communities] Fatal error:', err)
  process.exit(1)
})
