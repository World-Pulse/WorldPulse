# Cloudflare CDN & Security Headers — Deployment Guide

WorldPulse uses Cloudflare as its CDN, DDoS mitigation layer, and edge security provider.
This guide covers the full Cloudflare setup: DNS, SSL, caching, security headers, and
the Fastify middleware that correctly trusts real client IPs behind Cloudflare edge nodes.

---

## Architecture Overview

```
Browser → Cloudflare Edge → Nginx (142.93.71.102) → Fastify API  (port 3001)
                                                   → Next.js Web  (Vercel)
```

All traffic from real users arrives at the Fastify API via Cloudflare edge IP addresses.
Without special handling, `req.ip` would always resolve to a Cloudflare edge IP, breaking
per-user rate limiting. The WorldPulse Cloudflare middleware (`apps/api/src/middleware/cloudflare.ts`)
solves this by extracting the real client IP from the `CF-Connecting-IP` header.

---

## 1. DNS Setup

Point these records to Cloudflare (orange-cloud = proxied):

| Type  | Name                  | Value                  | Proxy   |
|-------|-----------------------|------------------------|---------|
| A     | `world-pulse.io`      | `142.93.71.102`        | ✅ Yes  |
| A     | `www`                 | `142.93.71.102`        | ✅ Yes  |
| A     | `api`                 | `142.93.71.102`        | ✅ Yes  |
| CNAME | `_vercel`             | `cname.vercel-dns.com` | ❌ No   |

> **Important:** The Vercel CNAME (`_vercel`) must NOT be proxied — Vercel requires
> a direct CNAME for domain verification.

---

## 2. SSL / TLS

| Setting                   | Value              |
|---------------------------|--------------------|
| SSL mode                  | **Full (strict)**  |
| Minimum TLS version       | TLS 1.2            |
| Opportunistic Encryption  | On                 |
| TLS 1.3                   | On                 |
| Automatic HTTPS Rewrites  | On                 |
| HSTS                      | See below          |

### HSTS Configuration

HSTS is set in **two places** — both must be consistent:

**1. Next.js edge middleware** (`apps/web/src/middleware.ts`):
```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```
Applied to all web routes in production (`NODE_ENV === 'production'`).

**2. Fastify API via `@fastify/helmet`** (`apps/api/src/index.ts`):
```
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

**Cloudflare Dashboard:** In SSL/TLS → Edge Certificates → HTTP Strict Transport Security:
- Max-Age: 31536000 (1 year)
- Include Subdomains: ✅
- Preload: ✅ (submit to hstspreload.org when ready)
- No-Sniff Header: ✅

> **Do not enable HSTS** at the Cloudflare level until you have verified HTTPS works
> on all subdomains. A wrong HSTS setting can lock users out for 1 year.

---

## 3. Cloudflare Middleware (Fastify)

File: `apps/api/src/middleware/cloudflare.ts`

### What it does

| Responsibility | Detail |
|---|---|
| Real IP extraction | Reads `CF-Connecting-IP` header; falls back to `req.ip` |
| CF-Ray correlation | Exposes `req.cfRay`, echoes `X-CF-Ray` in response for ops |
| isBehindCloudflare flag | Set on every request — routes can branch on this |
| Rate-limit key | `buildCfAwareKeyGenerator()` returns `user:ID` > `ip:CF-Connecting-IP` > `ip:req.ip` |

### Registration order (important)

```typescript
// apps/api/src/index.ts — plugin registration order
await app.register(helmet, { ... })            // security headers first
await app.register(cors, { ... })             // CORS
await app.register(rateLimitPlugin, { ... })   // rate limiter reads req.cfClientIp
await app.register(cloudflareMiddlewarePlugin) // CF middleware sets req.cfClientIp BEFORE rate-limit key runs
await app.register(securityPlugin)            // payload scanning last
```

> **Important:** `cloudflareMiddlewarePlugin` must be registered BEFORE `@fastify/rate-limit`
> so that the rate-limit key generator can read `req.cfClientIp`.

### Cloudflare IP CIDR validation

The middleware validates that the connecting socket IP falls within one of the 15 known
Cloudflare IPv4 CIDR ranges before trusting `CF-Connecting-IP`. This prevents IP spoofing
by non-Cloudflare senders.

Known ranges (as of 2026-03-28, verify at https://www.cloudflare.com/ips-v4):
```
173.245.48.0/20   103.21.244.0/22   103.22.200.0/22
103.31.4.0/22     141.101.64.0/18   108.162.192.0/18
190.93.240.0/20   188.114.96.0/20   197.234.240.0/22
198.41.128.0/17   162.158.0.0/15    104.16.0.0/13
104.24.0.0/14     172.64.0.0/13     131.0.72.0/22
```

---

## 4. Security Headers

### Next.js Web (`apps/web/src/middleware.ts`)

Applied to all routes matching the middleware `config.matcher` pattern:

| Header | Value |
|---|---|
| `X-Frame-Options` | `DENY` (except `/embed` routes) |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(self), payment=()` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` (production only) |
| `X-XSS-Protection` | `1; mode=block` |
| `Content-Security-Policy` | See below |

Also set via `next.config.mjs` headers array (applied at the Next.js server level):
```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(self)
```

### Fastify API (`@fastify/helmet`)

Configured in `apps/api/src/index.ts` via `@fastify/helmet`. Key overrides:

```typescript
await app.register(helmet, {
  contentSecurityPolicy: { /* custom directives */ },
  strictTransportSecurity: {
    maxAge: 31536000,
    includeSubDomains: true,
  },
  // ... other helmet defaults
})
```

---

## 5. Content Security Policy

### Production CSP (no localhost)

The CSP is constructed at runtime by `buildCspDirectives()` in `apps/web/src/middleware.ts`.
`localhost:3001` and `ws://localhost:3001` are **only included in development builds**:

```typescript
const isDev = process.env.NODE_ENV !== 'production'

// connect-src in production:
//   "connect-src 'self' https://api.world-pulse.io wss://api.world-pulse.io
//    https://tile.openstreetmap.org https://fonts.openmaptiles.org
//    https://gibs.earthdata.nasa.gov"
//
// connect-src in development also includes:
//   "http://localhost:3001 ws://localhost:3001"
```

This guard was also applied to `apps/web/next.config.mjs` in Cycle 27, and to
`apps/web/src/middleware.ts` (both main CSP and embed CSP) in Cycle 28.

### Embed Route CSP (`/embed/*`)

The embed widget allows `frame-ancestors *` so third-party sites can iframe it.
All other CSP directives are the same as above, with `X-Frame-Options` removed.

---

## 6. Caching Rules

### Cloudflare Dashboard → Caching → Cache Rules

| Rule | Matches | Cache TTL | Notes |
|---|---|---|---|
| API endpoints | `api.world-pulse.io/api/*` | Bypass (no cache) | Dynamic data |
| Static assets | `world-pulse.io/_next/static/*` | 1 year | Immutable hash |
| OG image | `world-pulse.io/og-image.png` | 1 day | Rarely changes |
| HTML pages | `world-pulse.io/*` (default) | Respect origin | Vercel sets headers |

### API `Cache-Control` headers

Set by `apps/web/vercel.json`:
```json
{
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "no-store" }]
    }
  ]
}
```

---

## 7. Rate Limiting Behaviour Behind Cloudflare

Without the Cloudflare middleware, all requests appear to come from Cloudflare edge IPs
(e.g., `104.16.x.x`). This would cause all users to share a single rate-limit bucket.

With `cloudflareMiddlewarePlugin` + `buildCfAwareKeyGenerator()`:

```
Priority: user ID → CF-Connecting-IP → req.ip (fallback)
```

Verify the middleware is working correctly:
```bash
# The X-Real-Client-IP response header should show your real IP:
curl -I https://api.world-pulse.io/health | grep X-Real-Client-IP
```

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Rate limit hits for all users simultaneously | CF middleware not registered before rate-limit | Verify registration order in `index.ts` |
| `req.ip` shows Cloudflare edge IP | `trustProxy: true` is set but CF middleware is missing | Confirm `cloudflareMiddlewarePlugin` is registered |
| HSTS locks out HTTP local dev | HSTS applied in all environments | Check `NODE_ENV === 'production'` guard in middleware.ts |
| Localhost API calls fail in production CSP | `localhost:3001` left in CSP_DIRECTIVES | Verify `isDev` guard in `buildCspDirectives()` |
| Vercel domain verification fails | `_vercel` CNAME was proxied (orange-cloud) | Set `_vercel` record to DNS-only (grey-cloud) |
| CF-Ray header not present | Request bypassed Cloudflare (direct IP hit) | Check DNS records are orange-cloud proxied |

---

## 9. Environment Variables

No Cloudflare-specific environment variables are required in the application code.
The Cloudflare middleware operates entirely on request headers (`CF-Connecting-IP`, `CF-Ray`).

For the Cloudflare API (used only in CI/CD or infrastructure scripts):
```
CLOUDFLARE_API_TOKEN=<token>       # Zones:Read, Cache Purge
CLOUDFLARE_ZONE_ID=<zone-id>       # world-pulse.io zone ID
```

---

## 10. Related Files

| File | Purpose |
|---|---|
| `apps/api/src/middleware/cloudflare.ts` | Fastify plugin: CF-Connecting-IP extraction, CIDR validation, rate-limit key |
| `apps/api/src/__tests__/cloudflare-middleware.test.ts` | Tests for CIDR lookup, CF-Ray validation, key generator |
| `apps/api/src/__tests__/security-middleware.test.ts` | Tests for rate limiting, helmet headers, CORS |
| `apps/web/src/middleware.ts` | Next.js edge middleware: CSP, HSTS, X-Frame-Options, nosniff |
| `apps/web/src/__tests__/middleware-security.test.ts` | Tests for CSP localhost guard (production vs development) |
| `apps/web/next.config.mjs` | Additional security headers + CSP localhost guard |
| `apps/web/vercel.json` | Vercel config: Cache-Control no-store on /api/*, Sentry tunnel rewrite |
| `docs/deployment/SENTRY.md` | Sentry error tracking setup |
| `docs/deployment/VERCEL.md` | Vercel deployment guide |
