/**
 * Tests for Sentry integration helper (apps/web/src/lib/sentry.ts).
 *
 * Validates:
 * - Config derivation from env vars
 * - Graceful no-op when Sentry is not installed
 * - captureException / captureMessage / setSentryUser safe calls
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('sentry lib', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('exports sentryConfig with enabled=false when no DSN', async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN
    delete process.env.SENTRY_DSN
    const { sentryConfig } = await import('../lib/sentry')
    expect(sentryConfig.enabled).toBe(false)
    expect(sentryConfig.dsn).toBe('')
  })

  it('exports sentryConfig with enabled=true when DSN is set', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://abc123@sentry.io/42'
    const { sentryConfig } = await import('../lib/sentry')
    expect(sentryConfig.enabled).toBe(true)
    expect(sentryConfig.dsn).toBe('https://abc123@sentry.io/42')
  })

  it('captureException is a no-op when disabled', async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN
    delete process.env.SENTRY_DSN
    const { captureException } = await import('../lib/sentry')
    // Should not throw
    expect(() => captureException(new Error('test'))).not.toThrow()
  })

  it('captureMessage is a no-op when disabled', async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN
    delete process.env.SENTRY_DSN
    const { captureMessage } = await import('../lib/sentry')
    expect(() => captureMessage('test', 'info')).not.toThrow()
  })

  it('setSentryUser is a no-op when disabled', async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN
    delete process.env.SENTRY_DSN
    const { setSentryUser } = await import('../lib/sentry')
    expect(() => setSentryUser({ id: '123' })).not.toThrow()
    expect(() => setSentryUser(null)).not.toThrow()
  })

  it('withSentryTag is a no-op when disabled', async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN
    delete process.env.SENTRY_DSN
    const { withSentryTag } = await import('../lib/sentry')
    expect(() => withSentryTag('key', 'value')).not.toThrow()
  })

  it('respects custom trace sample rate from env', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://abc@sentry.io/1'
    process.env.NEXT_PUBLIC_SENTRY_TRACES_RATE = '0.5'
    const { sentryConfig } = await import('../lib/sentry')
    expect(sentryConfig.tracesSampleRate).toBe(0.5)
  })

  it('respects custom replay sample rates from env', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://abc@sentry.io/1'
    process.env.NEXT_PUBLIC_SENTRY_REPLAY_RATE = '0.3'
    process.env.NEXT_PUBLIC_SENTRY_ERROR_REPLAY_RATE = '0.8'
    const { sentryConfig } = await import('../lib/sentry')
    expect(sentryConfig.replaySampleRate).toBe(0.3)
    expect(sentryConfig.errorReplaySampleRate).toBe(0.8)
  })

  it('defaults to 10% trace rate and 100% error replay', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://abc@sentry.io/1'
    delete process.env.NEXT_PUBLIC_SENTRY_TRACES_RATE
    delete process.env.NEXT_PUBLIC_SENTRY_ERROR_REPLAY_RATE
    const { sentryConfig } = await import('../lib/sentry')
    expect(sentryConfig.tracesSampleRate).toBe(0.1)
    expect(sentryConfig.errorReplaySampleRate).toBe(1.0)
  })

  it('sets environment from NODE_ENV', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://abc@sentry.io/1'
    process.env.NODE_ENV = 'test'
    const { sentryConfig } = await import('../lib/sentry')
    expect(sentryConfig.environment).toBe('test')
  })

  it('sets release from NEXT_PUBLIC_APP_VERSION', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://abc@sentry.io/1'
    process.env.NEXT_PUBLIC_APP_VERSION = '2.3.1'
    const { sentryConfig } = await import('../lib/sentry')
    expect(sentryConfig.release).toBe('worldpulse-web@2.3.1')
  })

  it('release is undefined when NEXT_PUBLIC_APP_VERSION is unset', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://abc@sentry.io/1'
    delete process.env.NEXT_PUBLIC_APP_VERSION
    const { sentryConfig } = await import('../lib/sentry')
    expect(sentryConfig.release).toBeUndefined()
  })
})
