/**
 * email.test.ts — Unit tests for sendAlertEmail() via Resend REST API
 *
 * Tests fire-and-forget email dispatch, env-var gating, HTML/text builders,
 * error resilience, and subject formatting across all severity levels.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Signal } from '@worldpulse/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id:               'sig-abc-123',
    title:            'Test Signal Title',
    summary:          'A brief summary of the test signal.',
    body:             '',
    category:         'conflict',
    severity:         'high',
    status:           'verified',
    reliabilityScore: 0.82,
    alertTier:        'PRIORITY',
    sourceCount:      3,
    location:         null,
    locationName:     'Kyiv, Ukraine',
    countryCode:      'UA',
    region:           null,
    tags:             [],
    sources:          [],
    originalUrls:     ['https://reuters.com/article/1'],
    language:         'en',
    viewCount:        0,
    shareCount:       0,
    postCount:        0,
    eventTime:        null,
    firstReported:    '2026-03-30T10:00:00.000Z',
    verifiedAt:       null,
    lastUpdated:      '2026-03-30T10:00:00.000Z',
    lastCorroboratedAt: null,
    createdAt:          '2026-03-30T10:00:00.000Z',
    ...overrides,
  }
}

function makeOkFetch(overrides: Partial<{ ok: boolean; status: number; json: object }> = {}) {
  return vi.fn().mockResolvedValue({
    ok:     overrides.ok  ?? true,
    status: overrides.status ?? 200,
    json:   vi.fn().mockResolvedValue(overrides.json ?? { id: 'resend-msg-001' }),
    text:   vi.fn().mockResolvedValue(''),
  })
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('sendAlertEmail', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = { ...OLD_ENV }
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  afterEach(() => {
    process.env = OLD_ENV
    vi.restoreAllMocks()
  })

  // ── 1. No-op when RESEND_API_KEY is absent ──────────────────────────────

  it('returns early without calling fetch when RESEND_API_KEY is not set', async () => {
    delete process.env.RESEND_API_KEY
    const fetchMock = makeOkFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { sendAlertEmail } = await import('../email')
    await sendAlertEmail('user@example.com', makeSignal())

    expect(fetchMock).not.toHaveBeenCalled()
  })

  // ── 2. POSTs to Resend API when key is configured ───────────────────────

  it('sends a POST request to https://api.resend.com/emails when key is set', async () => {
    process.env.RESEND_API_KEY = 'test-resend-key'
    const fetchMock = makeOkFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { sendAlertEmail } = await import('../email')
    await sendAlertEmail('user@example.com', makeSignal())

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect(opts.method).toBe('POST')
  })

  // ── 3. Correct Authorization header ─────────────────────────────────────

  it('sets Authorization header to Bearer <key>', async () => {
    process.env.RESEND_API_KEY = 'my-secret-key'
    const fetchMock = makeOkFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { sendAlertEmail } = await import('../email')
    await sendAlertEmail('user@example.com', makeSignal())

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = opts.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer my-secret-key')
  })

  // ── 4. Subject format: [SEVERITY_LABEL] title ───────────────────────────

  it('formats subject as [HIGH] <title> for high severity', async () => {
    process.env.RESEND_API_KEY = 'k'
    const fetchMock = makeOkFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { sendAlertEmail } = await import('../email')
    await sendAlertEmail('u@e.com', makeSignal({ severity: 'high', title: 'Bridge Explosion' }))

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.subject).toBe('[HIGH] Bridge Explosion')
  })

  // ── 5. From address from EMAIL_FROM_ADDRESS env var ──────────────────────

  it('uses EMAIL_FROM_ADDRESS env var for from address', async () => {
    process.env.RESEND_API_KEY      = 'k'
    process.env.EMAIL_FROM_ADDRESS  = 'My App <noreply@myapp.io>'
    const fetchMock = makeOkFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { sendAlertEmail } = await import('../email')
    await sendAlertEmail('u@e.com', makeSignal())

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.from).toBe('My App <noreply@myapp.io>')
  })

  // ── 6. To address matches argument ──────────────────────────────────────

  it('sends to the email address provided as the first argument', async () => {
    process.env.RESEND_API_KEY = 'k'
    const fetchMock = makeOkFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { sendAlertEmail } = await import('../email')
    await sendAlertEmail('analyst@worldpulse.com', makeSignal())

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.to).toEqual(['analyst@worldpulse.com'])
  })

  // ── 7. HTML body is present ──────────────────────────────────────────────

  it('includes a non-empty html field in the request body', async () => {
    process.env.RESEND_API_KEY = 'k'
    const fetchMock = makeOkFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { sendAlertEmail } = await import('../email')
    await sendAlertEmail('u@e.com', makeSignal())

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(typeof body.html).toBe('string')
    expect(body.html.length).toBeGreaterThan(100)
  })

  // ── 8. Plain text body is present ───────────────────────────────────────

  it('includes a non-empty text field in the request body', async () => {
    process.env.RESEND_API_KEY = 'k'
    const fetchMock = makeOkFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { sendAlertEmail } = await import('../email')
    await sendAlertEmail('u@e.com', makeSignal())

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(typeof body.text).toBe('string')
    expect(body.text.length).toBeGreaterThan(50)
  })

  // ── 9. reply_to set when EMAIL_REPLY_TO is configured ───────────────────

  it('sets reply_to when EMAIL_REPLY_TO env var is provided', async () => {
    process.env.RESEND_API_KEY  = 'k'
    process.env.EMAIL_REPLY_TO  = 'support@worldpulse.io'
    const fetchMock = makeOkFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { sendAlertEmail } = await import('../email')
    await sendAlertEmail('u@e.com', makeSignal())

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.reply_to).toBe('support@worldpulse.io')
  })

  // ── 10. reply_to absent when EMAIL_REPLY_TO is empty ────────────────────

  it('omits reply_to when EMAIL_REPLY_TO is not set', async () => {
    process.env.RESEND_API_KEY = 'k'
    delete process.env.EMAIL_REPLY_TO
    const fetchMock = makeOkFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { sendAlertEmail } = await import('../email')
    await sendAlertEmail('u@e.com', makeSignal())

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.reply_to).toBeUndefined()
  })

  // ── 11. Non-ok API response is handled silently ──────────────────────────

  it('handles non-ok Resend response (status 422) without throwing', async () => {
    process.env.RESEND_API_KEY = 'k'
    const fetchMock = makeOkFetch({ ok: false, status: 422 })
    vi.stubGlobal('fetch', fetchMock)

    const { sendAlertEmail } = await import('../email')
    // Must not throw
    await expect(sendAlertEmail('u@e.com', makeSignal())).resolves.toBeUndefined()
  })

  // ── 12. Network error is caught without throwing ─────────────────────────

  it('swallows network errors and does not throw', async () => {
    process.env.RESEND_API_KEY = 'k'
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)

    const { sendAlertEmail } = await import('../email')
    await expect(sendAlertEmail('u@e.com', makeSignal())).resolves.toBeUndefined()
  })

  // ── 13-17. Severity subject prefixes ────────────────────────────────────

  it.each([
    ['critical', 'CRITICAL'],
    ['high',     'HIGH'],
    ['medium',   'MEDIUM'],
    ['low',      'LOW'],
    ['info',     'INFO'],
  ] as const)('formats subject prefix as [%s] for %s severity', async (severity, label) => {
    process.env.RESEND_API_KEY = 'k'
    const fetchMock = makeOkFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { sendAlertEmail } = await import('../email')
    await sendAlertEmail('u@e.com', makeSignal({ severity, title: 'Signal X' }))

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.subject).toBe(`[${label}] Signal X`)
  })

  // ── 18. HTML contains signal title ──────────────────────────────────────

  it('includes the signal title in the HTML body', async () => {
    process.env.RESEND_API_KEY = 'k'
    const fetchMock = makeOkFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { sendAlertEmail } = await import('../email')
    await sendAlertEmail('u@e.com', makeSignal({ title: 'Reactor Overload in Tokyo' }))

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.html).toContain('Reactor Overload in Tokyo')
  })

  // ── 19. HTML contains signal URL ────────────────────────────────────────

  it('includes the signal detail URL in the HTML body', async () => {
    process.env.RESEND_API_KEY = 'k'
    const fetchMock = makeOkFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { sendAlertEmail } = await import('../email')
    await sendAlertEmail('u@e.com', makeSignal({ id: 'sig-xyz-789' }))

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.html).toContain('/signals/sig-xyz-789')
  })

  // ── 20. Content-Type is application/json ────────────────────────────────

  it('sets Content-Type to application/json', async () => {
    process.env.RESEND_API_KEY = 'k'
    const fetchMock = makeOkFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { sendAlertEmail } = await import('../email')
    await sendAlertEmail('u@e.com', makeSignal())

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = opts.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
  })
})
