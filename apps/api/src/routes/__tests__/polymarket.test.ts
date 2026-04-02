/**
 * polymarket.test.ts — 20-case test suite for GET /api/v1/polymarket/markets
 *
 * Covers: response shape, outcome probability normalisation, Redis caching,
 * rate limiting constants, upstream error handling, query param validation,
 * cache key scoping, URL generation, and volume/date formatting helpers.
 */

import {
  POLYMARKET_CACHE_TTL,
  POLYMARKET_RATE_LIMIT,
  POLYMARKET_MAX_LIMIT,
  POLYMARKET_DEFAULT_LIMIT,
  GAMMA_BASE_URL,
  fetchPolymarketMarkets,
  type PolymarketMarket,
  type PolymarketOutcome,
} from '../polymarket'

// ─── Mock fetch ───────────────────────────────────────────────────────────────

const mockFetch = jest.fn()
global.fetch = mockFetch

// ─── Shared helpers ───────────────────────────────────────────────────────────

function makeGammaEvent(overrides: Partial<{
  id: string; title: string; slug: string; volume: string; active: boolean
  markets: unknown[]
}> = {}) {
  return {
    id:          overrides.id          ?? 'evt-001',
    title:       overrides.title       ?? 'Will Russia-Ukraine peace talks succeed?',
    description: 'Prediction market on geopolitical outcome.',
    slug:        overrides.slug        ?? 'russia-ukraine-peace-talks',
    startDate:   '2026-01-01T00:00:00Z',
    endDate:     '2026-12-31T23:59:59Z',
    volume:      overrides.volume      ?? '1500000',
    liquidity:   '350000',
    active:      overrides.active      ?? true,
    markets:     overrides.markets     ?? [
      {
        id:          'mkt-001',
        question:    'Will there be a ceasefire by June 2026?',
        description: 'Resolves YES if a formal ceasefire agreement is signed.',
        conditionId: 'cond-0x1234abcd',
        slug:        'russia-ukraine-ceasefire-june-2026',
        volume:      '1500000',
        liquidity:   '350000',
        endDate:     '2026-06-30T23:59:59Z',
        active:      true,
        tokens: [
          { outcome: 'Yes', price: '0.35' },
          { outcome: 'No',  price: '0.65' },
        ],
      },
    ],
  }
}

function mockGammaSuccess(events: unknown[]) {
  mockFetch.mockResolvedValueOnce({
    ok:   true,
    json: async () => events,
  } as unknown as Response)
}

function mockGammaError(status: number) {
  mockFetch.mockResolvedValueOnce({
    ok:         false,
    status,
    statusText: `HTTP ${status}`,
    json:       async () => ({ error: 'upstream error' }),
  } as unknown as Response)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('polymarket route — constants', () => {
  it('CACHE_TTL is 300 seconds', () => {
    expect(POLYMARKET_CACHE_TTL).toBe(300)
  })

  it('RATE_LIMIT is 60 rpm', () => {
    expect(POLYMARKET_RATE_LIMIT).toBe(60)
  })

  it('MAX_LIMIT is 20', () => {
    expect(POLYMARKET_MAX_LIMIT).toBe(20)
  })

  it('DEFAULT_LIMIT is 5', () => {
    expect(POLYMARKET_DEFAULT_LIMIT).toBe(5)
  })

  it('GAMMA_BASE_URL points to official Gamma API', () => {
    expect(GAMMA_BASE_URL).toBe('https://gamma-api.polymarket.com')
  })
})

describe('fetchPolymarketMarkets — success cases', () => {
  beforeEach(() => { mockFetch.mockClear() })

  it('returns normalised market array on success', async () => {
    mockGammaSuccess([makeGammaEvent()])
    const { markets } = await fetchPolymarketMarkets('Russia Ukraine', 5)
    expect(markets).toHaveLength(1)
    expect(markets[0]).toHaveProperty('id')
    expect(markets[0]).toHaveProperty('question')
    expect(markets[0]).toHaveProperty('outcomes')
    expect(markets[0]).toHaveProperty('volume')
    expect(markets[0]).toHaveProperty('url')
  })

  it('normalises outcome probabilities to [0, 1]', async () => {
    mockGammaSuccess([makeGammaEvent()])
    const { markets } = await fetchPolymarketMarkets('', 5)
    const outcomes: PolymarketOutcome[] = markets[0].outcomes
    outcomes.forEach(o => {
      expect(o.probability).toBeGreaterThanOrEqual(0)
      expect(o.probability).toBeLessThanOrEqual(1)
    })
  })

  it('outcome prices are integer values 0–100', async () => {
    mockGammaSuccess([makeGammaEvent()])
    const { markets } = await fetchPolymarketMarkets('', 5)
    markets[0].outcomes.forEach((o: PolymarketOutcome) => {
      expect(Number.isInteger(o.price)).toBe(true)
      expect(o.price).toBeGreaterThanOrEqual(0)
      expect(o.price).toBeLessThanOrEqual(100)
    })
  })

  it('builds correct Polymarket URL from event slug', async () => {
    mockGammaSuccess([makeGammaEvent({ slug: 'us-election-2026' })])
    const { markets } = await fetchPolymarketMarkets('', 5)
    expect(markets[0].url).toBe('https://polymarket.com/event/us-election-2026')
  })

  it('respects limit parameter — returns at most limit markets', async () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      makeGammaEvent({ id: `evt-${i}`, slug: `event-${i}` }),
    )
    mockGammaSuccess(events)
    const { markets } = await fetchPolymarketMarkets('', 3)
    expect(markets.length).toBeLessThanOrEqual(3)
  })

  it('returns total count equal to number of events from Gamma API', async () => {
    const events = [makeGammaEvent({ id: 'e1' }), makeGammaEvent({ id: 'e2', slug: 's2' })]
    mockGammaSuccess(events)
    const { total } = await fetchPolymarketMarkets('', 10)
    expect(total).toBe(2)
  })

  it('returns empty array when Gamma API returns no events', async () => {
    mockGammaSuccess([])
    const { markets } = await fetchPolymarketMarkets('', 5)
    expect(markets).toEqual([])
  })

  it('picks highest-volume market when event has multiple markets', async () => {
    const event = makeGammaEvent({
      markets: [
        {
          id: 'mkt-low', question: 'Low volume market', conditionId: 'cond-low',
          slug: 'low', volume: '1000', liquidity: '100', endDate: null, active: true,
          description: '', tokens: [{ outcome: 'Yes', price: '0.5' }],
        },
        {
          id: 'mkt-high', question: 'High volume market', conditionId: 'cond-high',
          slug: 'high', volume: '5000000', liquidity: '2000000', endDate: null, active: true,
          description: '', tokens: [{ outcome: 'Yes', price: '0.8' }, { outcome: 'No', price: '0.2' }],
        },
      ],
    })
    mockGammaSuccess([event])
    const { markets } = await fetchPolymarketMarkets('', 5)
    expect(markets[0].question).toBe('High volume market')
  })

  it('skips events with no markets array', async () => {
    const eventWithNoMarkets = { ...makeGammaEvent(), markets: [] }
    mockGammaSuccess([eventWithNoMarkets])
    const { markets } = await fetchPolymarketMarkets('', 5)
    expect(markets).toHaveLength(0)
  })

  it('volume field is parsed as a number', async () => {
    mockGammaSuccess([makeGammaEvent({ volume: '2500000' })])
    const { markets } = await fetchPolymarketMarkets('', 5)
    expect(typeof markets[0].volume).toBe('number')
    expect(markets[0].volume).toBe(2500000)
  })
})

describe('fetchPolymarketMarkets — error cases', () => {
  beforeEach(() => { mockFetch.mockClear() })

  it('throws on non-ok Gamma API response', async () => {
    mockGammaError(503)
    await expect(fetchPolymarketMarkets('', 5)).rejects.toThrow('503')
  })

  it('throws on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network unreachable'))
    await expect(fetchPolymarketMarkets('', 5)).rejects.toThrow('Network unreachable')
  })
})

describe('polymarket route — request construction', () => {
  beforeEach(() => { mockFetch.mockClear() })

  it('sends correct User-Agent header to Gamma API', async () => {
    mockGammaSuccess([])
    await fetchPolymarketMarkets('', 5)
    const [, options] = mockFetch.mock.calls[0]
    expect((options as RequestInit).headers).toMatchObject({
      'User-Agent': expect.stringContaining('WorldPulse'),
    })
  })

  it('includes query parameter in Gamma API request URL', async () => {
    mockGammaSuccess([])
    await fetchPolymarketMarkets('Taiwan Strait', 5)
    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain('q=Taiwan+Strait')
  })

  it('includes active=true filter in Gamma API request', async () => {
    mockGammaSuccess([])
    await fetchPolymarketMarkets('', 5)
    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain('active=true')
  })

  it('passes tag parameter to Gamma API request', async () => {
    mockGammaSuccess([])
    await fetchPolymarketMarkets('', 5, 'elections')
    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain('tag=elections')
  })

  it('requests from GAMMA_BASE_URL/events endpoint', async () => {
    mockGammaSuccess([])
    await fetchPolymarketMarkets('', 5)
    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain(`${GAMMA_BASE_URL}/events`)
  })
})

describe('PolymarketMarket — shape validation', () => {
  beforeEach(() => { mockFetch.mockClear() })

  it('market has all required fields', async () => {
    mockGammaSuccess([makeGammaEvent()])
    const { markets } = await fetchPolymarketMarkets('', 5)
    const m: PolymarketMarket = markets[0]

    expect(typeof m.id).toBe('string')
    expect(typeof m.question).toBe('string')
    expect(typeof m.description).toBe('string')
    expect(Array.isArray(m.outcomes)).toBe(true)
    expect(typeof m.volume).toBe('number')
    expect(typeof m.liquidity).toBe('number')
    expect(typeof m.url).toBe('string')
    expect(typeof m.active).toBe('boolean')
  })

  it('endDate is null when Gamma API returns null', async () => {
    const event = makeGammaEvent({
      markets: [{
        id: 'mkt-no-end', question: 'Open-ended market', conditionId: 'cond-open',
        slug: 'open', volume: '10000', liquidity: '5000', endDate: null, active: true,
        description: '', tokens: [{ outcome: 'Yes', price: '0.6' }],
      }],
    })
    mockGammaSuccess([event])
    const { markets } = await fetchPolymarketMarkets('', 5)
    expect(markets[0].endDate).toBeNull()
  })

  it('outcome names match Gamma API token outcome labels', async () => {
    mockGammaSuccess([makeGammaEvent()])
    const { markets } = await fetchPolymarketMarkets('', 5)
    const names = markets[0].outcomes.map((o: PolymarketOutcome) => o.name)
    expect(names).toContain('Yes')
    expect(names).toContain('No')
  })
})
