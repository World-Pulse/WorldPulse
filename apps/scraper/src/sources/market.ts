/**
 * Economic & Market Intelligence Signal Source
 *
 * Polls Yahoo Finance unofficial chart API every 15 minutes for key
 * market stress indicators. Generates WorldPulse signals when significant
 * moves or fear spikes occur — not on every poll.
 *
 * Indicators tracked:
 *   - ^VIX  — CBOE Volatility Index ('Fear Index') — absolute level
 *   - ^GSPC — S&P 500 Index — daily % change
 *   - ^IXIC — NASDAQ Composite — daily % change
 *   - BTC-USD — Bitcoin USD — daily % change
 *   - CL=F  — Crude Oil WTI Futures — daily % change
 *
 * API: https://query1.finance.yahoo.com/v8/finance/chart/{symbol}
 * Free, no API key required. Uses standard User-Agent header.
 *
 * Counters Crucix's 'Live market tickers (Yahoo Finance), VIX/credit risk gauges' feature.
 */

import https from 'node:https'
import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'

const log = rootLogger.child({ module: 'market-source' })

// NYSE/Financial district location (signals are economy-category, geo = Wall Street)
const NYSE_LAT = 40.7069
const NYSE_LNG = -74.0089

// Poll interval: 15 minutes
const DEFAULT_INTERVAL_MS = 15 * 60_000

// Redis dedup TTL: 24 hours
const DEDUP_TTL_S = 24 * 3_600

// ─── YAHOO FINANCE API TYPES ─────────────────────────────────────────────────

interface YFMeta {
  symbol:                   string
  shortName?:               string
  longName?:                string
  regularMarketPrice:       number
  chartPreviousClose:       number
  regularMarketChangePercent?: number
  previousClose?:           number
  regularMarketVolume?:     number
}

interface YFChart {
  chart: {
    result: Array<{ meta: YFMeta }> | null
    error:  { code: string; description: string } | null
  }
}

// ─── INDICATOR CONFIG ────────────────────────────────────────────────────────

export interface MarketIndicator {
  symbol:    string
  name:      string
  type:      'vix' | 'index' | 'crypto' | 'commodity'
  sourceUrl: string
}

export const MARKET_INDICATORS: MarketIndicator[] = [
  { symbol: '^VIX',    name: 'VIX Fear Index',         type: 'vix',       sourceUrl: 'https://finance.yahoo.com/quote/%5EVIX' },
  { symbol: '^GSPC',   name: 'S&P 500',                type: 'index',     sourceUrl: 'https://finance.yahoo.com/quote/%5EGSPC' },
  { symbol: '^IXIC',   name: 'NASDAQ Composite',       type: 'index',     sourceUrl: 'https://finance.yahoo.com/quote/%5EIXIC' },
  { symbol: 'BTC-USD', name: 'Bitcoin',                type: 'crypto',    sourceUrl: 'https://finance.yahoo.com/quote/BTC-USD' },
  { symbol: 'CL=F',    name: 'Crude Oil WTI Futures',  type: 'commodity', sourceUrl: 'https://finance.yahoo.com/quote/CL%3DF' },
]

// ─── HTTP HELPER ─────────────────────────────────────────────────────────────

export function buildYFUrl(symbol: string): string {
  const encoded = encodeURIComponent(symbol)
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=1d&interval=5m&includePrePost=false`
}

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 15_000,
      headers: {
        'User-Agent': 'WorldPulse/0.1 (open-source; https://worldpulse.io)',
        'Accept':     'application/json',
      },
    }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { data += chunk })
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error(`YF request timeout: ${url}`)) })
  })
}

// ─── SEVERITY MAPPING ────────────────────────────────────────────────────────

/**
 * VIX severity: based on absolute level (fear index).
 * VIX >= 40 = extreme fear (market crash territory)
 * VIX >= 30 = high fear
 * VIX >= 25 = elevated fear
 */
export function vixSeverity(vix: number): SignalSeverity {
  if (vix >= 40) return 'critical'
  if (vix >= 30) return 'high'
  if (vix >= 25) return 'medium'
  return 'low'
}

/**
 * Percent change severity for indices/commodities/crypto.
 * absChange = Math.abs(percentChange)
 */
export function percentChangeSeverity(
  absChange: number,
  type: 'index' | 'crypto' | 'commodity',
): SignalSeverity {
  if (type === 'index') {
    if (absChange >= 6)  return 'critical'
    if (absChange >= 4)  return 'high'
    if (absChange >= 2)  return 'medium'
    return 'low'
  }
  if (type === 'crypto') {
    if (absChange >= 20) return 'high'
    if (absChange >= 10) return 'medium'
    return 'low'
  }
  // commodity (oil, etc.)
  if (absChange >= 10) return 'high'
  if (absChange >= 5)  return 'medium'
  return 'low'
}

// ─── EMIT GUARD ──────────────────────────────────────────────────────────────

/**
 * Returns true if this indicator's current reading warrants a signal.
 * Filters out normal market fluctuations — only fire on meaningful events.
 */
export function shouldEmitMarketSignal(
  indicator: MarketIndicator,
  price: number,
  changePercent: number,
): boolean {
  const absChange = Math.abs(changePercent)

  if (indicator.type === 'vix') {
    // Only emit when VIX reaches a notable threshold
    return price >= 25
  }
  if (indicator.type === 'index') {
    return absChange >= 2
  }
  if (indicator.type === 'crypto') {
    return absChange >= 10
  }
  if (indicator.type === 'commodity') {
    return absChange >= 5
  }
  return false
}

// ─── TITLE / CONTENT FORMATTERS ──────────────────────────────────────────────

export function formatMarketTitle(
  indicator: MarketIndicator,
  price: number,
  changePercent: number,
): string {
  const sign    = changePercent >= 0 ? '+' : ''
  const changeFmt = `${sign}${changePercent.toFixed(1)}%`

  if (indicator.type === 'vix') {
    const mood =
      price >= 40 ? 'Extreme Fear — Market Crash Territory' :
      price >= 30 ? 'High Stress — Elevated Fear' :
                    'Elevated Volatility'
    return `VIX Fear Index at ${price.toFixed(1)} — ${mood}`
  }

  const direction =
    changePercent > 0 ? 'Rallies' : 'Drops'
  return `${indicator.name} ${direction} ${changeFmt} — Market ${changePercent > 0 ? 'Surge' : 'Selloff'}`
}

export function formatMarketContent(
  indicator: MarketIndicator,
  price: number,
  changePercent: number,
  prevClose: number,
): string {
  const sign = changePercent >= 0 ? '+' : ''
  const changeFmt = `${sign}${changePercent.toFixed(2)}%`
  const priceChange = price - prevClose
  const priceChangeFmt = `${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}`

  if (indicator.type === 'vix') {
    return (
      `CBOE Volatility Index (VIX) reading: ${price.toFixed(2)} (${changeFmt} from previous close ${prevClose.toFixed(2)}). ` +
      `The VIX measures market expectations of near-term volatility. ` +
      `Readings above 25 signal elevated investor anxiety; above 30 indicates high fear; above 40 suggests extreme market stress. ` +
      `Source: CBOE / Yahoo Finance.`
    )
  }

  return (
    `${indicator.name} is trading at ${price.toFixed(2)} (${changeFmt}, ${priceChangeFmt} from previous close ${prevClose.toFixed(2)}). ` +
    `This represents a significant intraday move warranting attention. ` +
    `Source: Yahoo Finance.`
  )
}

// ─── DEDUP KEY ────────────────────────────────────────────────────────────────

export function marketDedupKey(
  symbol: string,
  directionTag: string,
  date: string,
): string {
  return `osint:market:${symbol}:${directionTag}:${date}`
}

function buildDirectionTag(indicator: MarketIndicator, price: number, changePercent: number): string {
  if (indicator.type === 'vix') {
    if (price >= 40) return 'extreme-fear'
    if (price >= 30) return 'high-fear'
    return 'elevated'
  }
  return changePercent >= 0 ? 'surge' : 'plunge'
}

// ─── MAIN POLLER ──────────────────────────────────────────────────────────────

export function startMarketPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  const INTERVAL_MS = Number(process.env.MARKET_INTERVAL_MS ?? DEFAULT_INTERVAL_MS)

  async function pollIndicator(indicator: MarketIndicator): Promise<void> {
    try {
      const url  = buildYFUrl(indicator.symbol)
      const raw  = await httpsGet(url)
      const data = JSON.parse(raw) as YFChart

      if (data.chart.error) {
        log.warn({ symbol: indicator.symbol, err: data.chart.error }, 'YF API error')
        return
      }

      const result = data.chart.result?.[0]
      if (!result) {
        log.debug({ symbol: indicator.symbol }, 'No chart result for symbol')
        return
      }

      const meta = result.meta
      const price = meta.regularMarketPrice
      const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price
      const changePercent = meta.regularMarketChangePercent ??
        (prevClose !== 0 ? ((price - prevClose) / prevClose) * 100 : 0)

      if (!shouldEmitMarketSignal(indicator, price, changePercent)) {
        log.debug({ symbol: indicator.symbol, price, changePercent }, 'Market signal below threshold, skipping')
        return
      }

      const today        = new Date().toISOString().split('T')[0] ?? 'unknown'
      const directionTag = buildDirectionTag(indicator, price, changePercent)
      const dedupKey     = marketDedupKey(indicator.symbol, directionTag, today)
      const seen         = await redis.get(dedupKey)
      if (seen) {
        log.debug({ symbol: indicator.symbol, dedupKey }, 'Market signal already emitted today, skipping')
        return
      }

      const severity =
        indicator.type === 'vix'
          ? vixSeverity(price)
          : percentChangeSeverity(Math.abs(changePercent), indicator.type)

      const title   = formatMarketTitle(indicator, price, changePercent).slice(0, 500)
      const content = formatMarketContent(indicator, price, changePercent, prevClose).slice(0, 1000)

      try {
        const signal = await insertAndCorrelate({
          title,
          summary:           content,
          category:          'economy',
          severity,
          status:            'pending',
          reliability_score: 0.90,
          source_count:      1,
          source_ids:        [],
          original_urls:     [indicator.sourceUrl],
          location:          db.raw('ST_MakePoint(?, ?)', [NYSE_LNG, NYSE_LAT]),
          location_name:     'New York, US',
          country_code:      'US',
          region:            'Americas',
          tags:              ['osint', 'market', 'economy', indicator.type, indicator.symbol.replace(/[^a-z0-9]/gi, '').toLowerCase()],
          language:          'en',
          event_time:        new Date(),
        }, { lat: NYSE_LAT, lng: NYSE_LNG, sourceId: 'market' })

        await redis.setex(dedupKey, DEDUP_TTL_S, '1')

        log.info(
          { symbol: indicator.symbol, price, changePercent, severity, title },
          'Market signal created',
        )

        if (signal && producer) {
          await producer.send({
            topic: 'signals.verified',
            messages: [{
              key:   'economy',
              value: JSON.stringify({
                event:   'signal.new',
                payload: signal,
                filter:  { category: 'economy', severity },
              }),
            }],
          }).catch(() => {}) // non-fatal
        }
      } catch (err) {
        log.debug({ err, symbol: indicator.symbol }, 'Market signal insert skipped (likely duplicate)')
      }
    } catch (err) {
      log.warn({ err, symbol: indicator.symbol }, 'Market indicator poll error (non-fatal)')
    }
  }

  async function poll(): Promise<void> {
    log.debug('Polling market indicators...')
    // Sequential polls to be gentle on Yahoo Finance rate limits
    for (const indicator of MARKET_INDICATORS) {
      await pollIndicator(indicator)
      // Small delay between symbols to avoid rate limiting
      await new Promise(r => setTimeout(r, 500))
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), INTERVAL_MS)

  log.info({ intervalMs: INTERVAL_MS, indicators: MARKET_INDICATORS.length }, 'Market intelligence poller started (Yahoo Finance: VIX + S&P500 + NASDAQ + BTC + Oil)')

  return () => {
    clearInterval(timer)
    log.info('Market intelligence poller stopped')
  }
}
