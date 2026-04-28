/**
 * Financial Signal Classifier
 *
 * Classifies a signal (title + summary) into one of five finance subcategories
 * using keyword matching, with precedence ordering to resolve ambiguity.
 *
 * Subcategories (in precedence order):
 *   central_bank  > crypto  > sanctions  > market_move  > corporate
 *
 * Also extracts ticker symbols (1–5 uppercase letters) found adjacent to
 * financial keywords in the text.
 */

import type { FinanceSubcategory } from '@worldpulse/types'

// ─── Keyword Banks ────────────────────────────────────────────────────────────

const CENTRAL_BANK_KW = [
  'federal reserve', 'fed ', ' fed,', ' fed.', 'the fed',
  'ecb', 'bank of england', 'boe', 'bank of japan', 'boj',
  'reserve bank', 'interest rate decision', 'fomc',
  'quantitative easing', ' qe ', 'tapering', 'rate hike', 'rate cut',
  'monetary policy', 'central bank', 'basis points', 'bps',
  'forward guidance',
]

const CRYPTO_KW = [
  'bitcoin', ' btc', 'btc ', 'ethereum', ' eth ', 'eth,', 'eth.',
  'crypto', 'blockchain', 'defi', 'stablecoin', 'usdt', 'usdc',
  'altcoin', 'nft', 'web3', 'binance', 'coinbase', 'solana',
  'ripple', 'xrp', 'cardano', 'ada', 'dogecoin', 'doge',
  'decentralized', 'token launch', 'memecoin',
]

const SANCTIONS_KW = [
  'sanctions', 'sanction', 'ofac', 'treasury department', 'asset freeze',
  'blacklist', 'sdn list', 'sanctioned entity', 'export controls',
  'embargo', 'financial penalty', 'fined', 'blocked assets',
]

const MARKET_MOVE_KW = [
  's&p 500', 's&p500', 'dow jones', 'nasdaq', 'ftse', 'dax',
  'nikkei', 'hang seng', 'cac 40', 'euro stoxx', 'russell 2000',
  '% gain', '% drop', '% rise', '% fall', '% surge', '% plunge',
  'yield', 'bond yield', 'treasury yield', 'oil price', 'gold price',
  'crude oil', 'brent', 'wti', 'commodit', 'equity market',
  'stock market', 'market rally', 'market sell-off', 'volatility',
  'vix', 'bear market', 'bull market', 'correction', 'circuit breaker',
]

const CORPORATE_KW = [
  'earnings', 'quarterly results', 'revenue', 'profit warning',
  ' ipo', 'initial public offering', 'merger', 'acquisition',
  'takeover', 'bankruptcy', 'chapter 11', 'layoffs', 'restructuring',
  'dividend', 'share buyback', 'ceo', 'cfo', 'annual report',
  'guidance', 'revenue miss', 'revenue beat', 'eps',
]

// ─── Ticker extraction ────────────────────────────────────────────────────────

/** Matches 1–5 uppercase letter sequences surrounded by word boundaries */
const TICKER_RE = /\b([A-Z]{1,5})\b/g

/**
 * Extract likely ticker symbols from text. Filters out common English
 * uppercase abbreviations that aren't tickers.
 */
export function extractTickers(text: string): string[] {
  const NOISE = new Set([
    'A', 'I', 'US', 'UK', 'EU', 'UN', 'AI', 'TV', 'CEO', 'CFO', 'IPO',
    'GDP', 'CPI', 'FED', 'ECB', 'BOE', 'BOJ', 'IMF', 'WTO', 'NATO',
    'WHO', 'FBI', 'CIA', 'NSA', 'FTC', 'SEC', 'DOJ', 'IRS', 'EPS',
    'VIX', 'QE', 'BPS', 'WTI', 'NFT', 'DeFi', 'USDT', 'USDC',
  ])
  const tickers: string[] = []
  let m: RegExpExecArray | null
  while ((m = TICKER_RE.exec(text)) !== null) {
    const sym = m[1]
    if (!NOISE.has(sym) && sym.length >= 2) tickers.push(sym)
  }
  // reset lastIndex for reuse
  TICKER_RE.lastIndex = 0
  return [...new Set(tickers)]
}

// ─── Classifier ───────────────────────────────────────────────────────────────

export interface FinanceClassification {
  isFinance:        boolean
  subcategory:      FinanceSubcategory | null
  financialEntities: string[]
}

/**
 * Classify a signal into a finance subcategory.
 *
 * Combines title and summary into a single text for matching.
 * Returns isFinance=false and subcategory=null when no finance keywords match.
 *
 * Precedence: central_bank > crypto > sanctions > market_move > corporate
 */
export function classifyFinanceSignal(title: string, summary: string): FinanceClassification {
  const combined = `${title} ${summary}`
  const lower    = combined.toLowerCase()

  let subcategory: FinanceSubcategory | null = null
  if (CENTRAL_BANK_KW.some(kw => lower.includes(kw))) subcategory = 'central_bank'
  else if (CRYPTO_KW.some(kw  => lower.includes(kw))) subcategory = 'crypto'
  else if (SANCTIONS_KW.some(kw => lower.includes(kw))) subcategory = 'sanctions'
  else if (MARKET_MOVE_KW.some(kw => lower.includes(kw))) subcategory = 'market_move'
  else if (CORPORATE_KW.some(kw => lower.includes(kw))) subcategory = 'corporate'

  return {
    isFinance:         subcategory !== null,
    subcategory,
    financialEntities: subcategory !== null ? extractTickers(combined) : [],
  }
}

/** Returns true when the signal contains any finance keyword (any subcategory). */
export function isFinanceSignal(title: string, summary: string): boolean {
  return classifyFinanceSignal(title, summary).isFinance
}
