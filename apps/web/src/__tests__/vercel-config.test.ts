/**
 * @file vercel-config.test.ts
 * Validates the Vercel deployment configuration (vercel.json) and env var
 * documentation (.env.example) to prevent misconfigured deploys.
 *
 * These tests run in CI to catch config regressions before deployment.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// Resolve root relative to this test file (apps/web/src/__tests__/ → ../../../../)
const ROOT = join(__dirname, '..', '..', '..', '..', '..')
const WEB_ROOT = join(ROOT, 'apps', 'web')

// ─── vercel.json ────────────────────────────────────────────────────────────

describe('vercel.json', () => {
  const vercelJsonPath = join(ROOT, 'vercel.json')

  it('exists at repo root', () => {
    expect(existsSync(vercelJsonPath)).toBe(true)
  })

  it('is valid JSON', () => {
    const raw = readFileSync(vercelJsonPath, 'utf-8')
    expect(() => JSON.parse(raw)).not.toThrow()
  })

  describe('schema', () => {
    let config: Record<string, unknown>

    beforeEach(() => {
      config = JSON.parse(readFileSync(vercelJsonPath, 'utf-8'))
    })

    it('targets nextjs framework', () => {
      expect(config.framework).toBe('nextjs')
    })

    it('build command uses pnpm with filter for web workspace', () => {
      expect(config.buildCommand).toContain('--filter')
      expect(config.buildCommand).toContain('web')
    })

    it('install command uses pnpm', () => {
      expect(config.installCommand).toContain('pnpm')
    })

    it('output directory points to apps/web/.next', () => {
      expect(config.outputDirectory).toBe('apps/web/.next')
    })

    it('has NEXT_PUBLIC_API_URL set to production API', () => {
      const env = config.env as Record<string, string>
      expect(env).toBeDefined()
      expect(env['NEXT_PUBLIC_API_URL']).toBe('https://api.world-pulse.io')
    })

    it('has NEXT_PUBLIC_WS_URL set to production WSS endpoint', () => {
      const env = config.env as Record<string, string>
      expect(env['NEXT_PUBLIC_WS_URL']).toBe('wss://api.world-pulse.io')
    })

    it('does NOT expose any secrets in env block', () => {
      const env = config.env as Record<string, string>
      const secretPatterns = [
        /secret/i, /private.*key/i, /password/i, /token/i, /stripe.*key/i,
        /jwt/i, /database_url/i, /pinecone/i
      ]
      for (const key of Object.keys(env ?? {})) {
        for (const pattern of secretPatterns) {
          expect(key).not.toMatch(pattern)
        }
      }
    })

    it('headers block includes security headers on wildcard source', () => {
      const headers = config.headers as Array<{ source: string; headers: Array<{ key: string }> }>
      const wildcardEntry = headers?.find(h => h.source === '/(.*)')
      expect(wildcardEntry).toBeDefined()
      const headerKeys = wildcardEntry!.headers.map(h => h.key)
      expect(headerKeys).toContain('X-Frame-Options')
      expect(headerKeys).toContain('X-Content-Type-Options')
      expect(headerKeys).toContain('Strict-Transport-Security')
    })

    it('rewrites /api/v1/* to production API (not localhost)', () => {
      const rewrites = config.rewrites as Array<{ source: string; destination: string }>
      const apiRewrite = rewrites?.find(r => r.source.includes('/api/v1/'))
      expect(apiRewrite).toBeDefined()
      expect(apiRewrite!.destination).toContain('world-pulse.io')
      expect(apiRewrite!.destination).not.toContain('localhost')
    })

    it('has ignore command to skip non-web changes', () => {
      expect(config.ignoreCommand).toBeDefined()
      expect(typeof config.ignoreCommand).toBe('string')
    })
  })
})

// ─── .env.example ───────────────────────────────────────────────────────────

describe('apps/web/.env.example', () => {
  const envExamplePath = join(WEB_ROOT, '.env.example')

  it('exists in apps/web/', () => {
    expect(existsSync(envExamplePath)).toBe(true)
  })

  describe('documents required env vars', () => {
    let content: string

    beforeEach(() => {
      content = readFileSync(envExamplePath, 'utf-8')
    })

    it('documents NEXT_PUBLIC_API_URL', () => {
      expect(content).toContain('NEXT_PUBLIC_API_URL')
    })

    it('documents NEXT_PUBLIC_WS_URL', () => {
      expect(content).toContain('NEXT_PUBLIC_WS_URL')
    })

    it('documents NEXT_PUBLIC_SENTRY_DSN', () => {
      expect(content).toContain('NEXT_PUBLIC_SENTRY_DSN')
    })

    it('has localhost defaults for dev (not production URLs)', () => {
      expect(content).toContain('localhost')
    })

    it('does NOT contain real API keys or secrets', () => {
      // Env example should only have placeholders or empty values
      const lines = content.split('\n').filter(l => !l.startsWith('#') && l.includes('='))
      for (const line of lines) {
        const value = line.split('=')[1]?.trim()
        // Values should be empty, a placeholder, or a localhost URL
        if (value && value.length > 0) {
          expect(value).not.toMatch(/^sk_live_/)   // Stripe live key
          expect(value).not.toMatch(/^rk_live_/)   // Stripe restricted
          expect(value).not.toMatch(/ghp_[a-zA-Z0-9]+/)  // GitHub PAT
        }
      }
    })
  })
})

// ─── Localhost port consistency ──────────────────────────────────────────────

describe('API_URL fallback port consistency', () => {
  it('clusters/page.tsx does not reference stale localhost:4000 port', () => {
    const clustersPath = join(WEB_ROOT, 'src', 'app', 'clusters', 'page.tsx')
    if (!existsSync(clustersPath)) return // skip if file removed

    const content = readFileSync(clustersPath, 'utf-8')
    expect(content).not.toContain('localhost:4000')
  })
})

// ─── import to satisfy vitest beforeEach scope ────────────────────────────────
import { beforeEach } from 'vitest'
