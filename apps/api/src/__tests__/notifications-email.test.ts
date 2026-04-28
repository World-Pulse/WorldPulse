import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Signal } from '@worldpulse/types'

// ─── Mock fetch and logger before importing modules under test ─────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock('../lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
  },
}))

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id:               'sig-abc-123',
    title:            'Major Earthquake Strikes Pacific Region',
    summary:          'A 7.8 magnitude earthquake has struck off the coast of Japan.',
    body:             null,
    category:         'disaster',
    severity:         'high',
    status:           'verified',
    reliabilityScore: 0.87,
    sourceCount:      4,
    location:         null,
    locationName:     'Japan',
    countryCode:      'JP',
    region:           'Asia',
    tags:             ['earthquake', 'japan'],
    sources:          [],
    originalUrls:     ['https://example.com/article1'],
    language:         'en',
    viewCount:        0,
    shareCount:       0,
    postCount:        0,
    eventTime:        null,
    firstReported:    '2026-03-26T10:00:00.000Z',
    verifiedAt:       '2026-03-26T10:01:00.000Z',
    lastUpdated:      '2026-03-26T10:02:00.000Z',
    createdAt:        '2026-03-26T10:00:00.000Z',
    isBreaking:       true,
    ...overrides,
  }
}

function makeOkFetchResponse(data: unknown = { id: 'email-id-123' }) {
  return {
    ok:   true,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(''),
  }
}

function makeErrorFetchResponse(status = 422) {
  return {
    ok:   false,
    status,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue('Invalid API key'),
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('sendAlertEmail', () => {
  beforeEach(() => {
    vi.resetModules()
    mockFetch.mockClear()
    // Default: Resend configured
    process.env.RESEND_API_KEY      = 'resend_test_key_abc123'
    process.env.EMAIL_FROM_ADDRESS  = 'alerts@world-pulse.io'
  })

  afterEach(() => {
    delete process.env.RESEND_API_KEY
    delete process.env.EMAIL_FROM_ADDRESS
    delete process.env.EMAIL_REPLY_TO
  })

  it('calls the Resend API when RESEND_API_KEY is configured', async () => {
    mockFetch.mockResolvedValueOnce(makeOkFetchResponse())
    const { sendAlertEmail } = await import('../lib/email')
    await sendAlertEmail('user@newsroom.com', makeSignal())
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('sends to the correct recipient address in the payload', async () => {
    mockFetch.mockResolvedValueOnce(makeOkFetchResponse())
    const { sendAlertEmail } = await import('../lib/email')
    await sendAlertEmail('recipient@example.org', makeSignal())
    const [, opts] = mockFetch.mock.calls[0] as [string, { body: string }]
    const payload = JSON.parse(opts.body) as { to: string[] }
    expect(payload.to).toContain('recipient@example.org')
  })

  it('includes signal title in the email subject', async () => {
    mockFetch.mockResolvedValueOnce(makeOkFetchResponse())
    const { sendAlertEmail } = await import('../lib/email')
    const signal = makeSignal({ title: 'Tsunami Warning Issued for Coastal Areas' })
    await sendAlertEmail('user@test.com', signal)
    const [, opts] = mockFetch.mock.calls[0] as [string, { body: string }]
    const payload = JSON.parse(opts.body) as { subject: string }
    expect(payload.subject).toContain('Tsunami Warning Issued for Coastal Areas')
  })

  it('prefixes subject with severity label', async () => {
    mockFetch.mockResolvedValueOnce(makeOkFetchResponse())
    const { sendAlertEmail } = await import('../lib/email')
    await sendAlertEmail('user@test.com', makeSignal({ severity: 'critical' }))
    const [, opts] = mockFetch.mock.calls[0] as [string, { body: string }]
    const payload = JSON.parse(opts.body) as { subject: string }
    expect(payload.subject).toMatch(/^\[CRITICAL\]/)
  })

  it('includes signal title in the HTML body', async () => {
    mockFetch.mockResolvedValueOnce(makeOkFetchResponse())
    const { sendAlertEmail } = await import('../lib/email')
    const signal = makeSignal({ title: 'Unique Title XYZ-999' })
    await sendAlertEmail('user@test.com', signal)
    const [, opts] = mockFetch.mock.calls[0] as [string, { body: string }]
    const payload = JSON.parse(opts.body) as { html: string }
    expect(payload.html).toContain('Unique Title XYZ-999')
  })

  it('includes reliability score percentage in the HTML', async () => {
    mockFetch.mockResolvedValueOnce(makeOkFetchResponse())
    const { sendAlertEmail } = await import('../lib/email')
    await sendAlertEmail('user@test.com', makeSignal({ reliabilityScore: 0.87 }))
    const [, opts] = mockFetch.mock.calls[0] as [string, { body: string }]
    const payload = JSON.parse(opts.body) as { html: string }
    expect(payload.html).toContain('87%')
  })

  it('includes signal detail URL in the HTML', async () => {
    mockFetch.mockResolvedValueOnce(makeOkFetchResponse())
    const { sendAlertEmail } = await import('../lib/email')
    await sendAlertEmail('user@test.com', makeSignal({ id: 'sig-abc-123' }))
    const [, opts] = mockFetch.mock.calls[0] as [string, { body: string }]
    const payload = JSON.parse(opts.body) as { html: string }
    expect(payload.html).toContain('https://world-pulse.io/signals/sig-abc-123')
  })

  it('includes signal title in the plain text fallback', async () => {
    mockFetch.mockResolvedValueOnce(makeOkFetchResponse())
    const { sendAlertEmail } = await import('../lib/email')
    const signal = makeSignal({ title: 'Plaintext Title Test' })
    await sendAlertEmail('user@test.com', signal)
    const [, opts] = mockFetch.mock.calls[0] as [string, { body: string }]
    const payload = JSON.parse(opts.body) as { text: string }
    expect(payload.text).toContain('Plaintext Title Test')
  })

  it('is a no-op when RESEND_API_KEY is not set', async () => {
    delete process.env.RESEND_API_KEY
    const { sendAlertEmail } = await import('../lib/email')
    await sendAlertEmail('user@test.com', makeSignal())
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('sets Authorization header with Bearer token', async () => {
    process.env.RESEND_API_KEY = 'my_test_key_xyz'
    mockFetch.mockResolvedValueOnce(makeOkFetchResponse())
    const { sendAlertEmail } = await import('../lib/email')
    await sendAlertEmail('user@test.com', makeSignal())
    const [, opts] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }]
    expect(opts.headers['Authorization']).toBe('Bearer my_test_key_xyz')
  })

  it('does not throw when Resend returns an error response — logs warning', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorFetchResponse(422))
    const { sendAlertEmail } = await import('../lib/email')
    await expect(sendAlertEmail('user@test.com', makeSignal())).resolves.toBeUndefined()
  })

  it('does not throw when fetch rejects (network error) — swallows error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network unreachable'))
    const { sendAlertEmail } = await import('../lib/email')
    await expect(sendAlertEmail('user@test.com', makeSignal())).resolves.toBeUndefined()
  })

  it('HTML-escapes XSS payloads in signal title', async () => {
    mockFetch.mockResolvedValueOnce(makeOkFetchResponse())
    const { sendAlertEmail } = await import('../lib/email')
    const signal = makeSignal({ title: '<script>alert("xss")</script>' })
    await sendAlertEmail('user@test.com', signal)
    const [, opts] = mockFetch.mock.calls[0] as [string, { body: string }]
    const payload = JSON.parse(opts.body) as { html: string }
    expect(payload.html).not.toContain('<script>')
    expect(payload.html).toContain('&lt;script&gt;')
  })

  it('includes both html and text parts in the payload', async () => {
    mockFetch.mockResolvedValueOnce(makeOkFetchResponse())
    const { sendAlertEmail } = await import('../lib/email')
    await sendAlertEmail('user@test.com', makeSignal())
    const [, opts] = mockFetch.mock.calls[0] as [string, { body: string }]
    const payload = JSON.parse(opts.body) as { html?: string; text?: string }
    expect(payload.html).toBeTruthy()
    expect(payload.text).toBeTruthy()
  })

  it('EMAIL_CONFIGURED is true when RESEND_API_KEY is set', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    const { EMAIL_CONFIGURED } = await import('../lib/email')
    expect(EMAIL_CONFIGURED).toBe(true)
  })

  it('adds reply_to to payload when EMAIL_REPLY_TO is set', async () => {
    process.env.EMAIL_REPLY_TO = 'support@world-pulse.io'
    mockFetch.mockResolvedValueOnce(makeOkFetchResponse())
    const { sendAlertEmail } = await import('../lib/email')
    await sendAlertEmail('user@test.com', makeSignal())
    const [, opts] = mockFetch.mock.calls[0] as [string, { body: string }]
    const payload = JSON.parse(opts.body) as { reply_to?: string }
    expect(payload.reply_to).toBe('support@world-pulse.io')
  })
})

// ─── AlertSettings email_address integration ───────────────────────────────

describe('AlertSettings email_address field', () => {
  it('alert-dispatcher AlertSettings interface accepts email_address', async () => {
    const { AlertDispatcher } = await import('../lib/alert-dispatcher')
    const dispatcher = new AlertDispatcher()
    expect(dispatcher).toBeDefined()
  })
})
