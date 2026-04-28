/**
 * trending-entities-ui.test.tsx
 *
 * Unit tests for the TrendingEntities sidebar widget and analytics page tab.
 * Uses Vitest + React Testing Library.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { TrendingEntities } from '@/components/analytics/TrendingEntities'

// ── Mock fetch ────────────────────────────────────────────────────────────────

const MOCK_RESPONSE = {
  success:                true,
  window:                 '24h',
  total_signals_analyzed: 423,
  unique_entities:        38,
  entities: [
    {
      entity:          'Russia',
      type:            'country',
      count:           42,
      severity:        { critical: 5, high: 12, medium: 18, low: 6, info: 1 },
      top_categories:  [{ name: 'conflict', count: 20 }, { name: 'military', count: 12 }],
      top_countries:   [{ code: 'UA', count: 18 }, { code: 'US', count: 8 }],
    },
    {
      entity:          'NATO',
      type:            'org',
      count:           28,
      severity:        { critical: 0, high: 8, medium: 14, low: 6, info: 0 },
      top_categories:  [{ name: 'military', count: 15 }],
      top_countries:   [{ code: 'US', count: 10 }],
    },
    {
      entity:          'sanctions',
      type:            'topic',
      count:           19,
      severity:        { critical: 0, high: 5, medium: 10, low: 4, info: 0 },
      top_categories:  [{ name: 'economy', count: 12 }],
      top_countries:   [],
    },
    {
      entity:          'Zelensky',
      type:            'actor',
      count:           14,
      severity:        { critical: 2, high: 6, medium: 6, low: 0, info: 0 },
      top_categories:  [{ name: 'conflict', count: 10 }],
      top_countries:   [{ code: 'UA', count: 12 }],
    },
  ],
  generated_at: '2026-03-26T12:00:00.000Z',
}

function mockFetchSuccess(data = MOCK_RESPONSE) {
  global.fetch = vi.fn().mockResolvedValue({
    ok:   true,
    json: async () => data,
  } as unknown as Response)
}

function mockFetchFailure() {
  global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TrendingEntities', () => {

  it('shows skeleton loading state initially', () => {
    mockFetchSuccess()
    render(<TrendingEntities />)
    // Should show animated skeleton rows before data arrives
    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('renders entity list after successful fetch', async () => {
    mockFetchSuccess()
    render(<TrendingEntities />)

    await waitFor(() => {
      expect(screen.getByText('Russia')).toBeInTheDocument()
    })
    expect(screen.getByText('NATO')).toBeInTheDocument()
    expect(screen.getByText('sanctions')).toBeInTheDocument()
    expect(screen.getByText('Zelensky')).toBeInTheDocument()
  })

  it('shows correct signal count in header', async () => {
    mockFetchSuccess()
    render(<TrendingEntities />)

    await waitFor(() => {
      expect(screen.getByText('423 signals')).toBeInTheDocument()
    })
  })

  it('shows correct unique entity count in footer', async () => {
    mockFetchSuccess()
    render(<TrendingEntities />)

    await waitFor(() => {
      expect(screen.getByText('38 unique entities')).toBeInTheDocument()
    })
  })

  it('displays type badges for each entity type', async () => {
    mockFetchSuccess()
    render(<TrendingEntities />)

    await waitFor(() => {
      expect(screen.getByText('CTY')).toBeInTheDocument()  // country
      expect(screen.getByText('ORG')).toBeInTheDocument()  // org
      expect(screen.getByText('TAG')).toBeInTheDocument()  // topic
      expect(screen.getByText('ACT')).toBeInTheDocument()  // actor
    })
  })

  it('shows entity counts in the list', async () => {
    mockFetchSuccess()
    render(<TrendingEntities />)

    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument()  // Russia count
      expect(screen.getByText('28')).toBeInTheDocument()  // NATO count
    })
  })

  it('shows error state and retry button on fetch failure', async () => {
    mockFetchFailure()
    render(<TrendingEntities />)

    await waitFor(() => {
      expect(screen.getByText(/unable to load/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    })
  })

  it('retries fetch when Retry button is clicked', async () => {
    mockFetchFailure()
    render(<TrendingEntities />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    })

    // Switch to success mode
    mockFetchSuccess()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => {
      expect(screen.getByText('Russia')).toBeInTheDocument()
    })
  })

  it('refetches when window selector changes', async () => {
    mockFetchSuccess()
    render(<TrendingEntities />)

    await waitFor(() => {
      expect(screen.getByText('Russia')).toBeInTheDocument()
    })

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    const prevCallCount = fetchMock.mock.calls.length

    // Click 7D window
    fireEvent.click(screen.getByText('7D'))

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(prevCallCount)
    })

    // URL should contain window=7d
    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
    expect(String(lastCall[0])).toContain('window=7d')
  })

  it('renders link to full analytics view', async () => {
    mockFetchSuccess()
    render(<TrendingEntities />)

    await waitFor(() => {
      const link = screen.getByRole('link', { name: /full view/i })
      expect(link).toHaveAttribute('href', '/analytics?tab=entities')
    })
  })

  it('auto-refreshes every 5 minutes', async () => {
    mockFetchSuccess()
    render(<TrendingEntities />)

    await waitFor(() => {
      expect(screen.getByText('Russia')).toBeInTheDocument()
    })

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    const callsBefore = fetchMock.mock.calls.length

    // Advance 5 minutes
    vi.advanceTimersByTime(5 * 60 * 1000)

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  it('shows empty state when no entities returned', async () => {
    mockFetchSuccess({ ...MOCK_RESPONSE, entities: [], unique_entities: 0 })
    render(<TrendingEntities />)

    await waitFor(() => {
      expect(screen.getByText(/no entities in this window/i)).toBeInTheDocument()
    })
  })

})
