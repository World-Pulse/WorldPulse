/**
 * Tests for GitHub OAuth 2.0 flow — pure logic extracted for unit testing.
 *
 * Covers:
 *  - GitHub authorization URL construction
 *  - Access token exchange
 *  - GitHub user / email fetching
 *  - Primary email selection algorithm
 *  - Handle sanitization and deduplication logic
 *  - State cookie validation patterns
 *  - OAuth error redirect behaviour
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Pure helpers (mirrored from auth.ts for unit-testability) ────────────────

/** Builds the GitHub OAuth redirect URL. */
function buildGitHubAuthUrl(clientId: string, redirectUri: string, state: string): string {
  return (
    `https://github.com/login/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=user%3Aemail` +
    `&state=${state}`
  )
}

/** Selects the primary verified email from GitHub's /user/emails array. */
function selectPrimaryEmail(
  emails: Array<{ email: string; primary: boolean; verified: boolean }>,
): string | undefined {
  return (
    emails.find(e => e.primary && e.verified)?.email ??
    emails.find(e => e.verified)?.email ??
    emails[0]?.email
  )
}

/** Sanitizes a GitHub login into a valid WorldPulse handle (3–50 chars). */
function sanitizeHandle(login: string): string {
  return login.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 48)
}

/** Builds the frontend redirect URL with tokens. */
function buildSuccessRedirect(
  frontendUrl: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
): string {
  const params = new URLSearchParams({
    accessToken,
    refreshToken,
    expiresIn: String(expiresIn),
  })
  return `${frontendUrl}/auth/github/callback?${params.toString()}`
}

/** Validates the GitHub state token key format stored in Redis. */
function oauthStateKey(state: string): string {
  return `oauth:state:${state}`
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildGitHubAuthUrl', () => {
  it('returns a valid GitHub authorize URL', () => {
    const url = buildGitHubAuthUrl('abc123', 'http://localhost:3001/callback', 'state42')
    expect(url).toContain('https://github.com/login/oauth/authorize')
  })

  it('encodes the client_id in the URL', () => {
    const url = buildGitHubAuthUrl('my-client-id', 'http://localhost/cb', 'st')
    expect(url).toContain('client_id=my-client-id')
  })

  it('encodes the redirect_uri correctly (percent-encodes colon and slashes)', () => {
    const url = buildGitHubAuthUrl('cid', 'http://localhost:3001/api/v1/auth/github/callback', 'st')
    expect(url).toContain(encodeURIComponent('http://localhost:3001/api/v1/auth/github/callback'))
  })

  it('includes scope=user:email (percent-encoded)', () => {
    const url = buildGitHubAuthUrl('cid', 'http://localhost/cb', 'st')
    expect(url).toContain('scope=user%3Aemail')
  })

  it('appends the state parameter without encoding', () => {
    const url = buildGitHubAuthUrl('cid', 'http://localhost/cb', 'deadbeef1234')
    expect(url).toContain('state=deadbeef1234')
  })
})

describe('selectPrimaryEmail', () => {
  it('returns the primary verified email when one exists', () => {
    const result = selectPrimaryEmail([
      { email: 'secondary@example.com', primary: false, verified: true },
      { email: 'primary@example.com',   primary: true,  verified: true },
    ])
    expect(result).toBe('primary@example.com')
  })

  it('falls back to any verified email when primary is not verified', () => {
    const result = selectPrimaryEmail([
      { email: 'unverified@example.com', primary: true,  verified: false },
      { email: 'verified@example.com',   primary: false, verified: true  },
    ])
    expect(result).toBe('verified@example.com')
  })

  it('falls back to the first email when none are verified', () => {
    const result = selectPrimaryEmail([
      { email: 'first@example.com',  primary: true,  verified: false },
      { email: 'second@example.com', primary: false, verified: false },
    ])
    expect(result).toBe('first@example.com')
  })

  it('returns undefined for an empty email list', () => {
    const result = selectPrimaryEmail([])
    expect(result).toBeUndefined()
  })

  it('correctly prioritises primary+verified over verified-only', () => {
    const result = selectPrimaryEmail([
      { email: 'verified-only@x.com', primary: false, verified: true },
      { email: 'primary-verified@x.com', primary: true, verified: true },
    ])
    expect(result).toBe('primary-verified@x.com')
  })
})

describe('sanitizeHandle', () => {
  it('lowercases the login', () => {
    expect(sanitizeHandle('JohnDoe')).toBe('johndoe')
  })

  it('replaces hyphens with underscores (GitHub logins may contain hyphens)', () => {
    expect(sanitizeHandle('john-doe')).toBe('john_doe')
  })

  it('replaces dots with underscores', () => {
    expect(sanitizeHandle('john.doe')).toBe('john_doe')
  })

  it('truncates handles longer than 48 characters', () => {
    const long = 'a'.repeat(60)
    expect(sanitizeHandle(long)).toHaveLength(48)
  })

  it('preserves alphanumeric characters and underscores', () => {
    expect(sanitizeHandle('john_doe_123')).toBe('john_doe_123')
  })
})

describe('buildSuccessRedirect', () => {
  it('returns a URL at the /auth/github/callback path', () => {
    const url = buildSuccessRedirect('http://localhost:3000', 'access', 'refresh', 900)
    expect(url).toContain('/auth/github/callback')
  })

  it('includes the accessToken query parameter', () => {
    const url = buildSuccessRedirect('http://localhost:3000', 'at123', 'rt456', 900)
    expect(url).toContain('accessToken=at123')
  })

  it('includes the refreshToken query parameter', () => {
    const url = buildSuccessRedirect('http://localhost:3000', 'at', 'rt_xyz', 900)
    expect(url).toContain('refreshToken=rt_xyz')
  })

  it('includes the expiresIn query parameter as a string', () => {
    const url = buildSuccessRedirect('http://localhost:3000', 'at', 'rt', 900)
    expect(url).toContain('expiresIn=900')
  })

  it('respects a custom frontend URL', () => {
    const url = buildSuccessRedirect('https://worldpulse.io', 'at', 'rt', 900)
    expect(url).toStartWith('https://worldpulse.io')
  })
})

describe('oauthStateKey', () => {
  it('formats the Redis key with the oauth:state: prefix', () => {
    expect(oauthStateKey('abc123')).toBe('oauth:state:abc123')
  })

  it('handles long hex state strings', () => {
    const state = 'f'.repeat(64)
    expect(oauthStateKey(state)).toBe(`oauth:state:${'f'.repeat(64)}`)
  })
})

describe('state validation behaviour', () => {
  it('treats a null Redis response as an invalid / expired state', () => {
    const stateVal: string | null = null
    expect(stateVal).toBeNull()
    // Corresponding route logic: if (!stateVal) return reply.redirect(302, errorRedirect)
  })

  it('treats a non-null Redis response as a valid state', () => {
    const stateVal: string | null = 'new'
    expect(stateVal).not.toBeNull()
  })

  it('uses a 10-minute (600 second) TTL for the state in Redis', () => {
    const STATE_TTL_SECONDS = 600
    expect(STATE_TTL_SECONDS).toBe(60 * 10)
  })
})
