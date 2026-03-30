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
import { withRetry, RetryExhaustedError } from './lib/retry'
import { isCircuitOpen, getCircuitState, acquireProbeSlot, cbSuccess, cbFailure, CircuitStatus } from './lib/circuit-breaker'
import { acquireRateLimit } from './lib/rate-limiter'
import { pushDLQ, drainDLQ } from './lib/dlq'
import { verifySignal } from './pipeline/verify'
import { classifyContent } from './pipeline/classify'
import { extractGeo } from './pipeline/geo'
import { dedup } from './pipeline/dedup'
import { correlateSignal } from './pipeline/correlate'
import type { CorrelationCandidate } from './pipeline/correlate'
import { computeTrending } from './pipeline/trending'
import { backfillUnprocessed } from './backfill'
import { recordSuccess, recordFailure, recordCycleThroughput, logHealthSummary, detectDeadSources } from './health'
import { createSemaphore } from './lib/concurrency'
import { startSpan, startRootSpan } from './lib/tracer'
import { startOsintPollers } from './sources/index'
import type { OsintCleanupFn } from './sources/index'
import type { Source } from '@worldpulse/types'
import { enrichSignalWithGemini, geminiEnabled } from './lib/gemini'
import { extractMediaFromContent } from './pipeline/media-extractor'
import { startHeartbeat, stopHeartbeat, registerCrashHandlers } from './lib/process-health.js'
import { runStabilityCheck, recordUnhandledException } from './lib/stability-tracker'
import { startKafkaLagMonitor } from './lib/kafka-lag-monitor'
import { checkGlobalCircuitHealth } from './lib/global-circuit-guard'

// DB row has extra columns not present in the shared Source interface
type ScraperSource = Source & {
  rss_feeds:       string[]
  api_endpoint:    string | null
  last_scraped:    Date | null
  scrape_interval: number | null   // seconds; used for adaptive polling offset
}

const SCRAPE_INTERVAL_MS    = Number(process.env.SCRAPE_INTERVAL_MS    ?? 30_000)
const SCRAPER_CONCURRENCY   = Math.max(1, Number(process.env.SCRAPER_CONCURRENCY ?? 10))
const DLQ_RETRY_INTERVAL_MS = Number(process.env.DLQ_RETRY_INTERVAL_MS ?? 5 * 60_000)
const DLQ_RETRY_BATCH_SIZE  = Number(process.env.DLQ_RETRY_BATCH_SIZE  ?? 10)
/** Discard DLQ items that have been retried this many times in total. */
const DLQ_MAX_ATTEMPTS      = 20

// Tier priority: lower index = higher priority (processed first)
const TIER_PRIORITY: Record<string, number> = {
  wire:        0,
  breaking:    1,
  institutional: 2,
  regional:    3,
  community:   4,
}

// High-activity threshold: sources producing this many articles per cycle get
// their next poll accelerated (last_scraped backdated by half the interval).
const HIGH_VELOCITY_THRESHOLD = 5
const ADAPTIVE_ACCELERATION_FACTOR = 0.5  // poll at 50% of configured interval

const kafka = new Kafka({
  clientId: 'wp-scraper',
  brokers:  (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  retry: { retries: 3, initialRetryTime: 300 },
})

let producer: Producer | null = null
let verifyConsumer: Consumer | null = null
let kafkaReady = false
let stopOsintPollers: OsintCleanupFn | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

async function connectKafka(): Promise<boolean> {
  try {
    const p = kafka.producer({ allowAutoTopicCreation: true })
    const c = kafka.consumer({ groupId: 'scraper-verify' })
    await p.connect()
    await c.connect()

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

    producer = p
    verifyConsumer = c
    kafkaReady = true
    logger.info('✅ Kafka connected')
    return true
  } catch (err) {
    logger.warn({ err }, 'Kafka unavailable — running in direct mode (no Kafka required)')
    return false
  }
}

// ─── BOOTSTRAP ────────────────────────────────────────────────────────────
async function bootstrap() {
  // Register crash handlers before any connections so crashes are always recorded
  registerCrashHandlers()

  logger.info('🛰️  WorldPulse Scraper starting...')

  // Try Kafka — non-fatal if unavailable
  await connectKafka()

  // If Kafka connected, start async verification consumer
  if (kafkaReady && verifyConsumer) {
    await startVerificationConsumer()
  }

  // Backfill any articles that were scraped but never turned into signals
  backfillUnprocessed(processArticleGroup).catch(err =>
    logger.warn({ err }, 'Backfill failed (non-fatal)')
  )

  // Start main scrape loop (works with or without Kafka)
  await scrapeAll()
  setInterval(scrapeAll, SCRAPE_INTERVAL_MS)

  // Start process heartbeat now that the scraper is running
  heartbeatTimer = startHeartbeat()

  // Start OSINT pollers — GDELT, ADS-B, AIS (each handles its own interval)
  stopOsintPollers = startOsintPollers(db, redis, producer)

  // Trending recalculation every 5 min
  setInterval(updateTrending, 5 * 60_000)

  // Health summary log + dead-source detection every 5 min
  setInterval(() => { logHealthSummary().catch(err => logger.error({ err }, 'Health summary failed')) }, 5 * 60_000)
  setInterval(() => { detectDeadSources().catch(err => logger.error({ err }, 'Dead source detection failed')) }, 5 * 60_000)
  setInterval(() => { checkGlobalCircuitHealth().catch(err => logger.error({ err }, 'Global circuit guard failed')) }, 5 * 60_000)

  // DLQ retry worker — re-attempt failed feeds on a configurable interval
  setInterval(() => { retryDlqBatch().catch(err => logger.error({ err }, 'DLQ retry worker failed')) }, DLQ_RETRY_INTERVAL_MS)

  // Gate 1 stability clock — evaluate clean-hour criteria every 60 minutes
  // Target: 336 consecutive clean hours (14 days) before launch gate clears
  setInterval(() => {
    runStabilityCheck().catch(err => logger.error({ err }, '[STABILITY] Check failed'))
  }, 60 * 60_000)

  // Kafka consumer group lag monitor — checks every 5 minutes, logs summary + warns on critical lag
  startKafkaLagMonitor()

  // Record process-level exceptions for the stability tracker's unhandled-exception check.
  // These listeners run alongside any existing crash handlers and are non-fatal.
  process.on('uncaughtException', (err) => {
    recordUnhandledException(err.message ?? String(err)).catch(() => {})
  })
  process.on('unhandledRejection', (reason) => {
    recordUnhandledException(String(reason)).catch(() => {})
  })

  // Retry Kafka connection every 60s if not connected
  if (!kafkaReady) {
    const kafkaRetry = setInterval(async () => {
      const ok = await connectKafka()
      if (ok && verifyConsumer) {
        await startVerificationConsumer()
        clearInterval(kafkaRetry)
      }
    }, 60_000)
  }

  logger.info(`✅ Scraper running — interval: ${SCRAPE_INTERVAL_MS / 1000}s — kafka: ${kafkaReady}`)

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Graceful shutdown initiated')
    if (heartbeatTimer) stopHeartbeat(heartbeatTimer)
    if (stopOsintPollers) stopOsintPollers()
    void producer?.disconnect()
    void verifyConsumer?.disconnect()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT',  shutdown)
}

// ─── DLQ RETRY WORKER ─────────────────────────────────────────────────────
/**
 * Periodically drains a batch of DLQ items and re-fetches each feed URL.
 *
 * On recovery: resets the source circuit breaker (so the source is eligible
 * for the next normal scrape cycle).
 * On continued failure: pushes the item back to the DLQ with an incremented
 * attempt count; items exceeding DLQ_MAX_ATTEMPTS are discarded.
 */
async function retryDlqBatch(): Promise<void> {
  const items = await drainDLQ(DLQ_RETRY_BATCH_SIZE)
  if (items.length === 0) return

  logger.info({ count: items.length }, 'DLQ retry worker: processing batch')

  const parser = new Parser({
    timeout: 15_000,
    headers: { 'User-Agent': 'WorldPulse/0.1 (open-source; https://worldpulse.io)' },
  })

  for (const item of items) {
    if (item.attempts >= DLQ_MAX_ATTEMPTS) {
      logger.warn(
        { feedUrl: item.feedUrl, sourceId: item.sourceId, attempts: item.attempts },
        'DLQ item exceeded max attempts — discarding',
      )
      continue
    }

    try {
      // Rate-limit and retry with a shorter schedule (2 retries: 2 s, 10 s)
      await acquireRateLimit(item.feedUrl)
      await withRetry(() => parser.parseURL(item.feedUrl), { delays: [2_000, 10_000] })

      // Feed is responsive again — reset the circuit breaker so the normal
      // scrape cycle will re-include this source on its next pass.
      await cbSuccess(item.sourceId)
      logger.info(
        { feedUrl: item.feedUrl, sourceId: item.sourceId, attempts: item.attempts },
        'DLQ item recovered — circuit reset',
      )
    } catch (err) {
      // Still failing — re-queue with incremented count and updated error
      const dlqError = err instanceof RetryExhaustedError && err.cause instanceof Error
        ? err.cause.message
        : err instanceof Error ? err.message : String(err)
      await pushDLQ({
        ...item,
        error:    dlqError,
        attempts: item.attempts + (err instanceof RetryExhaustedError ? err.attempts : 1),
        failedAt: new Date().toISOString(),
      })
      logger.debug(
        { feedUrl: item.feedUrl, newAttempts: item.attempts + 1 },
        'DLQ item re-queued after retry failure',
      )
    }
  }
}

// ─── MAIN SCRAPE LOOP ─────────────────────────────────────────────────────
async function scrapeAll() {
  await startRootSpan('scraper.cycle', async (cycleSpan) => {
    const rawSources = await db<ScraperSource>('sources')
      .where('active', true)
      .whereRaw("last_scraped IS NULL OR last_scraped < NOW() - (scrape_interval || ' seconds')::INTERVAL")

    // Sort by tier priority — wire/breaking sources processed first
    const sources = [...rawSources].sort((a, b) => {
      const pa = TIER_PRIORITY[a.tier] ?? 5
      const pb = TIER_PRIORITY[b.tier] ?? 5
      return pa - pb
    })

    cycleSpan.attributes['sources.count'] = sources.length
    cycleSpan.attributes['concurrency']   = SCRAPER_CONCURRENCY

    logger.info({ count: sources.length, concurrency: SCRAPER_CONCURRENCY }, 'Starting scrape cycle')

    const cycleStart = Date.now()
    let cycleTotalArticles = 0

    const limit = createSemaphore(SCRAPER_CONCURRENCY)

    const results = await Promise.allSettled(
      sources.map(source =>
        limit(async () => {
          const count = await scrapeSource(source)
          cycleTotalArticles += count
          return count
        })
      )
    )

    const cycleDurationMs = Date.now() - cycleStart
    const succeeded = results.filter(r => r.status === 'fulfilled').length
    const failed    = results.filter(r => r.status === 'rejected').length

    cycleSpan.attributes['articles.total']  = cycleTotalArticles
    cycleSpan.attributes['sources.success'] = succeeded
    cycleSpan.attributes['sources.failed']  = failed

    await recordCycleThroughput(cycleTotalArticles, cycleDurationMs).catch(() => {})

    logger.info(
      { succeeded, failed, total: sources.length, articles: cycleTotalArticles, durationMs: cycleDurationMs },
      'Scrape cycle complete',
    )
  })
}

// ─── SCRAPE SINGLE SOURCE ─────────────────────────────────────────────────
async function scrapeSource(source: ScraperSource): Promise<number> {
  if (!source.rss_feeds?.length && !source.api_endpoint) return 0

  // ── Circuit breaker check ─────────────────────────────────────────────
  if (await isCircuitOpen(source.id)) {
    logger.info({ sourceId: source.id, source: source.slug }, 'Circuit open — skipping source')
    return 0
  }

  // ── HALF_OPEN: allow exactly one probe request ─────────────────────────
  // isCircuitOpen returns false once openUntil has passed (HALF_OPEN state),
  // so multiple concurrent scrapers would all attempt the probe without this gate.
  const circuitState = await getCircuitState(source.id)
  if (circuitState.status === CircuitStatus.HALF_OPEN) {
    const probeAcquired = await acquireProbeSlot(source.id)
    if (!probeAcquired) {
      logger.debug({ sourceId: source.id, source: source.slug }, 'Circuit HALF_OPEN — probe slot taken, skipping cycle')
      return 0
    }
    logger.info({ sourceId: source.id, source: source.slug }, 'Circuit HALF_OPEN — probe request allowed')
  }

  const parser = new Parser({
    timeout:   15_000,
    headers:   { 'User-Agent': 'WorldPulse/0.1 (open-source; https://worldpulse.io)' },
    customFields: { item: ['media:content', 'content:encoded', 'dc:creator'] },
  })

  let newCount = 0
  let feedSuccesses = 0
  let feedErrors = 0
  let totalLatencyMs = 0

  for (const feedUrl of (source.rss_feeds ?? [])) {
    try {
      // ── Rate limit per domain ───────────────────────────────────────────
      await acquireRateLimit(feedUrl)

      // ── Fetch with exponential backoff (1 s, 5 s, 30 s) ────────────────
      const fetchStart = Date.now()
      const feed = await withRetry(() => parser.parseURL(feedUrl))
      totalLatencyMs += Date.now() - fetchStart
      feedSuccesses++

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

        const articlePayload = {
          articleId:   article.id,
          sourceId:    source.id,
          url,
          title:       item.title ?? '',
          body:        item.contentSnippet ?? item.content ?? '',
          publishedAt: item.pubDate ?? new Date().toISOString(),
          sourceTier:  source.tier,
          sourceTrust: Number(source.trustScore) || 0.5,
        }

        if (kafkaReady && producer) {
          // Publish to Kafka for async processing
          await producer.send({
            topic: 'articles.raw',
            messages: [{ key: source.id, value: JSON.stringify(articlePayload) }],
          })
        } else {
          // Direct mode — process inline without Kafka
          const topicHash = computeTopicHash(articlePayload.title)
          const group = [articlePayload]
          processArticleGroup(topicHash, group).catch(err =>
            logger.warn({ err, url }, 'Direct article processing failed')
          )
        }

        newCount++
      }
    } catch (err) {
      feedErrors++
      logger.warn({ feedUrl, sourceId: source.id, err }, 'Feed parse error after retries')

      // ── Record circuit breaker failure ─────────────────────────────────
      await cbFailure(source.id, source.name)

      // ── Push to dead-letter queue ──────────────────────────────────────
      // Unwrap RetryExhaustedError to surface the root cause message and
      // record the actual attempt count rather than a hardcoded constant.
      const dlqError = err instanceof RetryExhaustedError && err.cause instanceof Error
        ? err.cause.message
        : err instanceof Error ? err.message : String(err)
      const dlqAttempts = err instanceof RetryExhaustedError ? err.attempts : 1
      await pushDLQ({
        feedUrl,
        sourceId:   source.id,
        sourceName: source.name,
        error:      dlqError,
        attempts:   dlqAttempts,
        failedAt:   new Date().toISOString(),
      })

      continue
    }
  }

  // Reset circuit breaker on any success
  if (feedSuccesses > 0) {
    await cbSuccess(source.id)
  }

  // ── Adaptive polling — high-activity sources are backdated so they are
  //    eligible sooner in the next scrape cycle (no DB schema change needed).
  const adaptiveOffsetSec = newCount >= HIGH_VELOCITY_THRESHOLD
    ? Math.round((source.scrape_interval ?? 30) * ADAPTIVE_ACCELERATION_FACTOR)
    : 0

  if (adaptiveOffsetSec > 0) {
    await db('sources').where('id', source.id).update({
      last_scraped: db.raw(`NOW() - INTERVAL '${adaptiveOffsetSec} seconds'`),
    })
    logger.debug({ source: source.slug, newCount, adaptiveOffsetSec }, 'Adaptive polling: accelerated next cycle')
  } else {
    await db('sources').where('id', source.id).update({ last_scraped: new Date() })
  }

  // Record source health with throughput
  if (feedSuccesses === 0 && feedErrors > 0) {
    await recordFailure(source.id, source.name, source.slug, `All ${feedErrors} feed(s) failed to parse`)
  } else {
    const avgLatencyMs = feedSuccesses > 0 ? Math.round(totalLatencyMs / feedSuccesses) : undefined
    await recordSuccess(source.id, source.name, source.slug, avgLatencyMs, newCount)
  }

  if (newCount > 0) {
    logger.debug({ source: source.slug, newCount }, 'Articles scraped')
  }

  return newCount
}

// ─── VERIFICATION PIPELINE ───────────────────────────────────────────────
async function startVerificationConsumer() {
  if (!verifyConsumer) return

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

  // AI classification — traced
  const classification = await startSpan('pipeline.classify', async (span) => {
    span.attributes['article.url'] = primary.url
    return classifyContent(primary.title, primary.body)
  })

  // Geo extraction — traced
  const geo = await startSpan('pipeline.geo', async (span) => {
    span.attributes['title'] = primary.title.slice(0, 80)
    return extractGeo(primary.title + ' ' + (primary.body ?? ''))
  })

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

  // ── Gemini intelligence enrichment (async, non-blocking) ──
  if (geminiEnabled) {
    enrichSignalWithGemini(signal.title, primary.body ?? primary.title, signal.location_name)
      .then(async enrichment => {
        if (!enrichment) return
        await db('signals').where('id', signal.id).update({
          summary:           enrichment.enhancedSummary || signal.summary,
          tags:              enrichment.keyEntities.slice(0, 8),
          gemini_enriched:   true,
          gemini_context:    enrichment.geopoliticalContext,
          gemini_confidence: enrichment.confidence,
          // Upgrade severity if Gemini flags as critical/high and current is lower
          ...(enrichment.threatLevel === 'critical' && signal.severity !== 'critical' ? { severity: 'critical' } : {}),
          ...(enrichment.threatLevel === 'high' && signal.severity === 'medium' ? { severity: 'high' } : {}),
        }).catch(() => {}) // non-fatal
      })
      .catch(() => {})
  }

  // ── Multimedia media extraction (async, non-blocking) ──
  // Extract YouTube / podcast URLs from the article and store in signal_media.
  // Failures here must never fail signal ingestion.
  ;(async () => {
    try {
      const mediaItems = extractMediaFromContent(primary.url, primary.body, primary.url)
      if (mediaItems.length > 0) {
        await db('signal_media').insert(
          mediaItems.map(item => ({
            signal_id:   signal.id,
            media_type:  item.type,
            url:         item.url,
            embed_id:    item.embedId   ?? null,
            title:       item.title     ?? null,
            source_name: item.sourceName ?? null,
          })),
        )
        logger.info({ signalId: signal.id, count: mediaItems.length }, '[MEDIA] signal %s: %d media items extracted', signal.id, mediaItems.length)
      }
    } catch (err) {
      logger.warn({ err, signalId: signal.id }, '[MEDIA] media extraction failed (non-fatal)')
    }
  })()

  // Cache topic → signal mapping
  await redis.setex(`signal:topic:${topicHash}`, 86400, JSON.stringify({ id: signal.id }))

  // Mark articles processed
  await db('raw_articles')
    .whereIn('id', articles.map(a => a.articleId))
    .update({ processed: true, signal_id: signal.id })

  // Run verification — traced
  const verificationResult = await startSpan('pipeline.verify', async (span) => {
    span.attributes['signal.id']       = String(signal.id)
    span.attributes['articles.count']  = articles.length
    return verifySignal(signal, articles)
  })
  if (verificationResult.status !== signal.status) {
    await db('signals').where('id', signal.id).update({
      status:            verificationResult.status,
      reliability_score: verificationResult.score,
      verified_at:       verificationResult.status === 'verified' ? new Date() : null,
    })
    signal.status = verificationResult.status
    signal.reliability_score = verificationResult.score
  }

  // ── Cross-source event correlation (async, non-blocking) ──
  // Detect when multiple OSINT feeds report on the same underlying event
  try {
    const candidate: CorrelationCandidate = {
      id:               String(signal.id),
      title:            signal.title,
      category:         signal.category,
      severity:         signal.severity,
      source_id:        primary.sourceId,
      location_name:    signal.location_name ?? null,
      lat:              geo.lat ?? null,
      lng:              geo.lng ?? null,
      published_at:     primary.publishedAt ? new Date(primary.publishedAt) : new Date(),
      reliability_score: signal.reliability_score,
      tags:             signal.tags ?? [],
    }

    const cluster = await correlateSignal(candidate)

    if (cluster) {
      logger.info({
        signalId:     signal.id,
        clusterId:    cluster.cluster_id,
        clusterSize:  cluster.signal_ids.length,
        corrType:     cluster.correlation_type,
        corrScore:    cluster.correlation_score.toFixed(2),
      }, 'Signal correlated into event cluster')
    }
  } catch (err) {
    // Correlation is non-fatal — signal was already persisted
    logger.warn({ err, signalId: signal.id }, 'Correlation failed (non-fatal)')
  }

  // Auto-create a post so the global feed shows real content
  try {
    const botUser = await db('users')
      .where('account_type', 'official')
      .orWhere('account_type', 'ai')
      .first('id')

    if (botUser) {
      const content = signal.summary
        ? `${signal.title}\n\n${signal.summary}`.slice(0, 2000)
        : signal.title.slice(0, 2000)

      const sourceName = await db('sources').where('id', primary.sourceId).first('name')

      // Only create if no post already exists for this signal
      const existingPost = await db('posts').where('signal_id', signal.id).first('id')
      if (!existingPost) {
        const [autoPost] = await db('posts').insert({
          author_id:        botUser.id,
          post_type:        'signal',
          content,
          signal_id:        signal.id,
          source_url:       primary.url,
          source_name:      sourceName?.name ?? null,
          tags:             signal.tags ?? [],
          location_name:    signal.location_name ?? null,
          reliability_score: signal.reliability_score,
          language:         signal.language ?? 'en',
        }).returning('id')

        // Notify the API search consumer so the auto-post is indexed
        if (kafkaReady && producer && autoPost) {
          await producer.send({
            topic: 'posts.created',
            messages: [{ value: JSON.stringify({ id: autoPost.id }) }],
          }).catch(() => {})
        }
      }
    }
  } catch (err) {
    logger.warn({ err, signalId: signal.id }, 'Auto-post creation failed (non-fatal)')
  }

  // Publish to Kafka → WebSocket broadcast (optional)
  if (kafkaReady && producer) {
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
  }

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

function computeReliability(articles: Array<{ sourceTrust: number | string; sourceTier: string }>): number {
  if (articles.length === 0) return 0

  const countScore = Math.min(articles.length / 3, 1) * 0.4
  const avgTrust = articles.reduce((s, a) => s + Number(a.sourceTrust || 0), 0) / articles.length
  const trustScore = (isNaN(avgTrust) ? 0 : avgTrust) * 0.4
  const hasWire = articles.some(a => a.sourceTier === 'wire')
  const wireBonus = hasWire ? 0.2 : 0

  const result = countScore + trustScore + wireBonus
  return isNaN(result) ? 0.1 : Math.min(Math.max(result, 0), 1)
}

bootstrap().catch(err => {
  logger.error(err, 'Scraper fatal error')
  process.exit(1)
})
