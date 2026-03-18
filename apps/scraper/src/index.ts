/**
 * WorldPulse Signal Scraper
 * 
 * The intelligence pipeline: fetches from all configured sources,
 * normalizes, deduplicates, and publishes to Kafka for verification.
 */

import Parser from 'rss-parser'
import { Kafka, Producer, Consumer } from 'kafkajs'
import { redis } from './lib/redis'
import { db } from './lib/postgres'
import { logger } from './lib/logger'
import { verifySignal } from './pipeline/verify'
import { classifyContent } from './pipeline/classify'
import { extractGeo } from './pipeline/geo'
import { dedup } from './pipeline/dedup'
import { computeTrending } from './pipeline/trending'
import type { Source } from '@worldpulse/types'

const SCRAPE_INTERVAL_MS = Number(process.env.SCRAPE_INTERVAL_MS ?? 30_000)
const kafka = new Kafka({
  clientId: 'wp-scraper',
  brokers:  (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  retry: { retries: 5, initialRetryTime: 300 },
})

let producer: Producer
let verifyConsumer: Consumer

// ─── BOOTSTRAP ────────────────────────────────────────────────────────────
async function bootstrap() {
  logger.info('🛰️  WorldPulse Scraper starting...')

  producer = kafka.producer({ allowAutoTopicCreation: true })
  verifyConsumer = kafka.consumer({ groupId: 'scraper-verify' })
  
  await producer.connect()
  await verifyConsumer.connect()

  // Create topics if needed
  const admin = kafka.admin()
  await admin.connect()
  await admin.createTopics({
    topics: [
      { topic: 'signals.raw',      numPartitions: 4, replicationFactor: 1 },
      { topic: 'signals.verified', numPartitions: 4, replicationFactor: 1 },
      { topic: 'signals.trending', numPartitions: 1, replicationFactor: 1 },
      { topic: 'articles.raw',     numPartitions: 8, replicationFactor: 1 },
    ],
  })
  await admin.disconnect()

  // Start verification consumer
  await startVerificationConsumer()

  // Start main scrape loop
  await scrapeAll()
  setInterval(scrapeAll, SCRAPE_INTERVAL_MS)

  // Trending recalculation every 5 min
  setInterval(updateTrending, 5 * 60_000)

  logger.info(`✅ Scraper running — interval: ${SCRAPE_INTERVAL_MS / 1000}s`)
}

// ─── MAIN SCRAPE LOOP ─────────────────────────────────────────────────────
async function scrapeAll() {
  const sources = await db<Source>('sources')
    .where('active', true)
    .whereRaw("last_scraped IS NULL OR last_scraped < NOW() - (scrape_interval || ' seconds')::INTERVAL")

  logger.info({ count: sources.length }, 'Starting scrape cycle')

  const results = await Promise.allSettled(
    sources.map(source => scrapeSource(source))
  )

  const succeeded = results.filter(r => r.status === 'fulfilled').length
  const failed    = results.filter(r => r.status === 'rejected').length
  logger.info({ succeeded, failed, total: sources.length }, 'Scrape cycle complete')
}

// ─── SCRAPE SINGLE SOURCE ─────────────────────────────────────────────────
async function scrapeSource(source: Source & { rss_feeds: string[]; last_scraped: Date | null }) {
  if (!source.rss_feeds?.length && !source.api_endpoint) return

  const parser = new Parser({
    timeout:   15_000,
    headers:   { 'User-Agent': 'WorldPulse/0.1 (open-source; https://worldpulse.io)' },
    customFields: { item: ['media:content', 'content:encoded', 'dc:creator'] },
  })

  let newCount = 0

  for (const feedUrl of (source.rss_feeds ?? [])) {
    try {
      const feed = await parser.parseURL(feedUrl)
      
      for (const item of feed.items ?? []) {
        const url = item.link ?? item.guid
        if (!url) continue

        // Dedup check
        const isDup = await dedup.check(url, source.id)
        if (isDup) continue

        // Save raw article
        const [article] = await db('raw_articles')
          .insert({
            source_id:    source.id,
            url,
            title:        item.title?.trim(),
            body:         item.contentSnippet ?? item.content ?? item['content:encoded'],
            author:       item.creator ?? item['dc:creator'],
            published_at: item.pubDate ? new Date(item.pubDate) : null,
            hash:         dedup.hash(url + (item.title ?? '')),
          })
          .onConflict('url')
          .ignore()
          .returning('id')

        if (!article) continue
        
        // Publish to Kafka for async processing
        await producer.send({
          topic: 'articles.raw',
          messages: [{
            key:   source.id,
            value: JSON.stringify({
              articleId: article.id,
              sourceId:  source.id,
              url,
              title:     item.title,
              body:      item.contentSnippet ?? item.content,
              publishedAt: item.pubDate,
              sourceTier: source.tier,
              sourceTrust: source.trustScore,
            }),
          }],
        })

        newCount++
      }
    } catch (err) {
      logger.warn({ feedUrl, sourceId: source.id, err }, 'Feed parse error')
    }
  }

  // Update last_scraped
  await db('sources').where('id', source.id).update({ last_scraped: new Date() })
  
  if (newCount > 0) {
    logger.debug({ source: source.slug, newCount }, 'Articles scraped')
  }
}

// ─── VERIFICATION PIPELINE ───────────────────────────────────────────────
async function startVerificationConsumer() {
  await verifyConsumer.subscribe({ topic: 'articles.raw', fromBeginning: false })

  await verifyConsumer.run({
    eachBatch: async ({ batch }) => {
      const articles = batch.messages.map(m => JSON.parse(m.value!.toString()))
      
      // Group by topic to find cross-source corroboration
      const grouped = groupByTopic(articles)
      
      for (const [topicHash, group] of grouped) {
        if (group.length === 0) continue

        try {
          await processArticleGroup(topicHash, group)
        } catch (err) {
          logger.error({ topicHash, err }, 'Article group processing failed')
        }
      }
    },
  })
}

async function processArticleGroup(
  topicHash: string,
  articles: Array<{
    articleId: string
    sourceId:  string
    url:       string
    title:     string
    body:      string
    publishedAt: string
    sourceTier:  string
    sourceTrust: number
  }>
) {
  // Check if we already have a signal for this topic
  const existing = await redis.get(`signal:topic:${topicHash}`)
  
  if (existing) {
    // Update existing signal with new source
    const signalId = JSON.parse(existing).id
    const article = articles[0]
    
    await db('signals')
      .where('id', signalId)
      .update({
        source_count: db.raw('source_count + ?', [articles.length]),
        source_ids:   db.raw(`source_ids || ARRAY[?]::uuid[]`, [article.sourceId]),
        last_updated: new Date(),
      })

    await db('raw_articles')
      .whereIn('id', articles.map(a => a.articleId))
      .update({ processed: true, signal_id: signalId })

    return
  }

  // Representative article (highest trust source)
  const primary = articles.sort((a, b) => b.sourceTrust - a.sourceTrust)[0]

  // AI classification
  const classification = await classifyContent(primary.title, primary.body)
  const geo = await extractGeo(primary.title + ' ' + (primary.body ?? ''))
  const reliability = computeReliability(articles)

  // Create signal
  const [signal] = await db('signals')
    .insert({
      title:            primary.title,
      summary:          classification.summary,
      category:         classification.category,
      severity:         classification.severity,
      status:           reliability > 0.85 ? 'verified' : 'pending',
      reliability_score: reliability,
      source_count:     articles.length,
      source_ids:       articles.map(a => a.sourceId),
      original_urls:    articles.map(a => a.url),
      location:         geo.point ? db.raw(`ST_MakePoint(?, ?)`, [geo.lng, geo.lat]) : null,
      location_name:    geo.name,
      country_code:     geo.countryCode,
      region:           geo.region,
      tags:             classification.tags,
      language:         classification.language ?? 'en',
      event_time:       primary.publishedAt ? new Date(primary.publishedAt) : null,
    })
    .returning('*')

  // Cache topic → signal mapping
  await redis.setex(`signal:topic:${topicHash}`, 86400, JSON.stringify({ id: signal.id }))

  // Mark articles processed
  await db('raw_articles')
    .whereIn('id', articles.map(a => a.articleId))
    .update({ processed: true, signal_id: signal.id })

  // Run verification
  const verificationResult = await verifySignal(signal, articles)
  if (verificationResult.status !== signal.status) {
    await db('signals').where('id', signal.id).update({
      status:            verificationResult.status,
      reliability_score: verificationResult.score,
      verified_at:       verificationResult.status === 'verified' ? new Date() : null,
    })
    signal.status = verificationResult.status
    signal.reliability_score = verificationResult.score
  }

  // Publish to Kafka → WebSocket broadcast
  await producer.send({
    topic: 'signals.verified',
    messages: [{
      key:   signal.category,
      value: JSON.stringify({
        event:   'signal.new',
        payload: signal,
        filter:  { category: signal.category, severity: signal.severity },
      }),
    }],
  })

  logger.info({
    signalId: signal.id,
    title:    signal.title.slice(0, 60),
    category: signal.category,
    severity: signal.severity,
    sources:  articles.length,
    reliability: reliability.toFixed(2),
  }, 'Signal created')
}

// ─── TRENDING ────────────────────────────────────────────────────────────
async function updateTrending() {
  for (const window of ['1h', '6h', '24h'] as const) {
    try {
      const topics = await computeTrending(window)
      
      await db.transaction(async trx => {
        // Clear old snapshot for this window
        await trx('trending_topics')
          .where('window', window)
          .where('snapshot_at', '<', db.raw("NOW() - INTERVAL '3 hours'"))
          .delete()

        if (topics.length > 0) {
          await trx('trending_topics').insert(topics.map(t => ({ ...t, window, snapshot_at: new Date() })))
        }
      })

      // Publish to Redis for WS broadcast
      await redis.publish('wp:trending.update', JSON.stringify({
        event:   'trending.update',
        payload: { topics, window },
      }))
    } catch (err) {
      logger.error({ window, err }, 'Trending update failed')
    }
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────
function groupByTopic(articles: Array<{ title: string; sourceId: string; articleId: string; sourceTrust: number; url: string; body: string; publishedAt: string; sourceTier: string }>) {
  // Simple grouping by title similarity (real impl would use semantic embeddings)
  const groups = new Map<string, typeof articles>()
  
  for (const article of articles) {
    const key = computeTopicHash(article.title)
    const group = groups.get(key) ?? []
    group.push(article)
    groups.set(key, group)
  }
  
  return groups
}

function computeTopicHash(title: string): string {
  // Normalize title to a topic fingerprint
  const normalized = title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3)
    .slice(0, 5)
    .sort()
    .join('_')
  return normalized
}

function computeReliability(articles: Array<{ sourceTrust: number; sourceTier: string }>): number {
  if (articles.length === 0) return 0
  
  // Base score from source count
  const countScore = Math.min(articles.length / 3, 1) * 0.4
  
  // Trust score average
  const avgTrust = articles.reduce((s, a) => s + a.sourceTrust, 0) / articles.length
  const trustScore = avgTrust * 0.4
  
  // Wire service bonus
  const hasWire = articles.some(a => a.sourceTier === 'wire')
  const wireBonus = hasWire ? 0.2 : 0
  
  return Math.min(countScore + trustScore + wireBonus, 1)
}

bootstrap().catch(err => {
  logger.error(err, 'Scraper fatal error')
  process.exit(1)
})
