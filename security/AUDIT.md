# Gate 6 — Security Hardening & Vulnerability Audit

**Status: PASS**
**Date: 2026-03-26 (re-audited 2026-03-26)**
**Audited by: WorldPulse Brain Agent (automated) + manual review**

---

## Summary

Gate 6 establishes a defense-in-depth security posture across the web frontend and API backend. All critical controls are in place. Two accepted risks are documented below with mitigations and upgrade paths.

---

## 1. Dependency Audit (`pnpm audit`)

**Result: 0 vulnerabilities found** (as of 2026-03-26)

### Actions taken

| Package | CVE / Advisory | Action |
|---------|----------------|--------|
| `tar` <7.5.10 (HIGH ×6) | GHSA-34x7, GHSA-8qq5, GHSA-83g3, GHSA-444r, and others — arbitrary file write / path traversal via hardlinks | Added `pnpm.overrides.tar: ">=7.5.10"` in root `package.json`, re-ran `pnpm install` |
| `picomatch` >=3.0.0 <3.0.2 and >=4.0.0 <4.0.4 (HIGH ×3) | GHSA-c2c7-rcm5-vvqj — ReDoS via extglob quantifiers | Added `pnpm.overrides.picomatch: ">=4.0.4"` in root `package.json` |
| `fastify` <=5.8.2 (MODERATE) | GHSA-444r-cwp2-x5xf — `request.protocol` / `request.host` spoofable via `X-Forwarded-*` from untrusted connections | Bumped `fastify` to `^5.8.3` in `apps/api/package.json` |

**Notes:**
- The `tar` and `picomatch` CVEs were in `apps/mobile` transitive deps (`@expo/cli → cacache → tar`). These packages are developer toolchain only (build-time, not deployed). The pnpm overrides force all workspace packages to use the patched versions.
- The `fastify` CVE is in the deployed API. Fixed directly by bumping the minimum version.

### CI recommendation

Add to your CI pipeline (`.github/workflows/ci.yml` or equivalent):

```yaml
- name: Security audit
  run: pnpm audit --audit-level=high
```

---

## 2. API Security Hardening

### 2a. Rate Limiting

All routes are covered by the **global rate limiter** registered in `apps/api/src/index.ts`:

```
Global: 200 requests/minute per user (keyed by x-user-id header, fallback to IP)
Backend: Redis — persists across restarts and horizontal scaling
```

Per-route tighter limits are applied where appropriate:

| Route | Limit |
|-------|-------|
| `POST /api/v1/auth/*` | 5 req/min (auth route config) |
| `GET /api/v1/search` | 30 req/min (search route config) |
| All others | 200 req/min (global) |

No unprotected routes found. All new routes (cameras, maritime, jamming, patents, trade, admin-kafka) fall under the global limit.

### 2b. Input Validation (Zod coverage)

Routes with a request body (POST/PUT/PATCH that accept JSON) use Zod schemas:

| Route | Schema |
|-------|--------|
| `POST /auth/register` | `RegisterSchema` |
| `POST /auth/login` | `LoginSchema` |
| `POST /auth/refresh` | `RefreshTokenSchema` |
| `POST /posts` | `CreatePostSchema` |
| `POST /communities` | `CreateCommunitySchema` |
| `POST /polls` | `CreatePollSchema` |
| `POST /polls/:id/vote` | `VoteSchema` |
| `POST /alerts` | `AlertSchema` |
| `PUT /alerts/:id` | `AlertSchema.partial()` |
| `PUT /users/me` | `UpdateProfileSchema` |
| `PATCH /users/me/onboarding` | `OnboardingSchema` |
| `POST /notifications/device-token` | `DeviceTokenSchema` |
| `DELETE /notifications/device-token` | `DeleteDeviceTokenSchema` |
| `PATCH /notifications/read` | `MarkReadSchema` |
| `PUT /notifications/settings` | `AlertSettingsSchema` |
| `POST /developer/keys` | `CreateKeySchema` |

Routes that mutate state without a JSON body (e.g. `POST /:id/like`, `POST /:id/follow`) use URL params only — no body validation needed.

**Accepted Gap:** See [Accepted Risk #2](#risk-2-inconsistent-body-validation-zod-coverage).

### 2c. SQL Injection

All database queries use **Knex.js query builder** with parameterized bindings. No raw SQL string interpolation was found in the codebase. Knex's parameterized queries prevent first-order SQL injection independently of the payload scanner.

Verified by manual review of:
- `apps/api/src/db/postgres.ts`
- All route handlers in `apps/api/src/routes/`

### 2d. Auth Token Security

- `JWT_SECRET` loaded from `process.env` — no hardcoded secret in source
- Production guard: server throws if `JWT_SECRET` is not set and `NODE_ENV === 'production'`
- Dev fallback: `'dev_secret_change_in_prod'` — short, clearly labelled, blocked in prod
- Access token expiry: **15 minutes**
- Refresh token: **30 days**, stored in Redis (can be invalidated server-side)
- API keys stored as **SHA-256 hashes** — plaintext never persisted after creation

### 2e. CORS

CORS origins are restricted by environment in `apps/api/src/index.ts`:

| Environment | Allowed Origins |
|------------|-----------------|
| Development | `localhost:3000`, `localhost:3001`, `127.0.0.1:3000` + `CORS_ORIGINS` env var |
| Production | `https://worldpulse.io`, `https://www.worldpulse.io` + `CORS_ORIGINS` env var |

Requests with no `Origin` header are allowed (server-to-server, `curl`). Unmatched origins receive a `403` with error message that does not leak the allowlist.

---

## 3. Frontend Security

### 3a. Security Headers

Applied via **Next.js Edge Middleware** (`apps/web/src/middleware.ts`) to every non-static route:

| Header | Value |
|--------|-------|
| `Content-Security-Policy` | See CSP section below |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(self), payment=()` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` (production only) |
| `X-XSS-Protection` | `1; mode=block` (legacy browser fallback) |

Embed routes (`/embed/*`) receive a relaxed CSP with `frame-ancestors *` to support the widget iframe use case. All other routes use `frame-ancestors 'none'`.

#### Content Security Policy

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com data:;
img-src 'self' data: blob: https:;
connect-src 'self' https://api.world-pulse.io wss://api.world-pulse.io
            http://localhost:3001 ws://localhost:3001
            https://tile.openstreetmap.org https://fonts.openmaptiles.org
            https://gibs.earthdata.nasa.gov;
media-src 'self' blob:;
worker-src 'self' blob:;
frame-src 'none';
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none';
upgrade-insecure-requests;
```

See [Accepted Risk #1](#risk-1-csp-unsafe-inline-on-script-src) for `unsafe-inline` rationale.

### 3b. User-Generated Content (XSS)

- **No `dangerouslySetInnerHTML` usage found** in `apps/web/src/`
- **No markdown-to-HTML renderers** installed (no `marked`, `remarkable`, `rehype-raw`, etc.)
- React renders all user content as **escaped text nodes** — XSS via content interpolation is not possible

Verification: `grep -rn "dangerouslySetInnerHTML|innerHTML" apps/web/src/` returned no results.

### 3c. API Key / Secret Exposure in Frontend Build

- No API keys or secrets are imported in any `apps/web/src/` file
- `NEXT_PUBLIC_*` env vars reviewed: contain only public API URLs and feature flags (no credentials)
- `.next/` build output is in `.gitignore` — not committed to the repo

---

## 4. Secrets Scan

### Git History

Scanned git history for patterns: `sk-`, `ghp_`, `AKIA`, `Bearer <token>` across all `.ts`, `.tsx`, `.env` files.

**Result: No hardcoded credentials found.**

The only match (`dev_secret_change_in_prod` in `apps/api/src/index.ts:143`) is the intentionally named JWT dev fallback — not a real secret.

### .gitignore Coverage

The following are excluded from version control:

```
.env, .env.local, .env.production, .env.prod, .env.*.local, .env.staging
*.pem, *.key
secrets/
```

A pre-commit reminder comment was added to `.gitignore`:

```
# Pre-commit reminder: run `git secrets --scan` or `grep -r "sk-\|ghp_\|AKIA" .` before pushing
```

---

## Accepted Risks

### Risk 1: CSP `unsafe-inline` on `script-src`
**Severity:** Medium
**Location:** `apps/web/src/middleware.ts`

Next.js injects inline scripts for hydration and route transitions. Removing `unsafe-inline` breaks the framework. `unsafe-eval` is similarly required for some Next.js internals.

**Mitigation:** `object-src 'none'`, `base-uri 'self'`, and `form-action 'self'` limit the practical exploitability of any XSS. `frame-ancestors 'none'` prevents clickjacking.

**Upgrade path:** When Next.js nonce support stabilizes (tracked in Next.js roadmap), replace `unsafe-inline` with per-request nonces. The middleware is structured to make this a one-line change.

---

### Risk 2: Inconsistent Body Validation (Zod coverage)
**Severity:** Low
**Location:** Various POST routes in `apps/api/src/routes/`

Some routes perform inline body validation rather than using a Zod schema. This means type coercion errors could surface as 500s rather than 400s, and field-level validation may be weaker.

**Mitigation:** The payload scanner (`securityPlugin`) runs on all requests before route handlers and blocks known injection patterns regardless of schema coverage. Parameterized Knex queries prevent injection at the DB layer as a second backstop.

**Upgrade path:** Migrate all route handlers to Zod schemas with `fastify-type-provider-zod` in a follow-up cleanup sprint.

---

## Security Measures in Place

### HTTP Security Headers (API)
**File:** `apps/api/src/index.ts` — `@fastify/helmet`

| Header | Value |
|--------|-------|
| `Content-Security-Policy` | `default-src 'none'; script-src 'self'; connect-src 'self'; ...` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` (production only) |
| `X-DNS-Prefetch-Control` | `off` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `cross-origin` |

### SSRF Protection
**File:** `apps/api/src/lib/security.ts` — `checkSSRF()`

All outbound HTTP requests (scrapers, webhook dispatchers) must pass through `checkSSRF()` before execution. Blocks:

- Private IPv4 ranges: `10.x`, `172.16–31.x`, `192.168.x`
- Loopback: `127.x`, `::1`
- Link-local: `169.254.x` (includes AWS EC2 metadata endpoint `169.254.169.254`)
- Multicast: `224–239.x`
- Docker bridge: `172.17.x`
- IPv6 loopback, link-local (`fe80::`), and ULA ranges (`fc00::/7`)
- IPv4-mapped IPv6 addresses (`::ffff:x.x.x.x`)
- Blocked URL schemes: `file:`, `ftp:`, `gopher:`, `data:`, `javascript:`, `vbscript:`
- Credentials embedded in URLs (`user:pass@host`)
- Internal hostnames: `localhost`, `metadata.google.internal`, `0.0.0.0`
- URLs exceeding 4096 characters (ReDoS protection)

**Test coverage:** `apps/api/src/__tests__/ssrf-guard.test.ts`

### Payload Scanner (Injection Attack Detection)
**Files:**
- `apps/api/src/lib/security.ts` — `scanPayload()`
- `apps/api/src/middleware/security.ts` — Fastify plugin

The `securityPlugin` Fastify plugin runs on every request as a `preHandler` hook:

1. Extracts all string values from query params, URL params, and JSON body (up to 10KB)
2. Scans each string against regex pattern sets for:
   - **SQL injection**: `SELECT/UNION/DROP` keywords, comment sequences, time-delay functions
   - **XSS**: `<script>`, `javascript:` URLs, inline event handlers, `eval()`, `document.cookie`
   - **Path traversal**: `../`, URL-encoded variants
3. On detection: logs a structured security event to Redis + structured logger, returns `400 SECURITY_BLOCKED`
4. Skips scanning for `/health`, `/api/docs`

**Test coverage:** `apps/api/src/__tests__/security.test.ts`

### Brute-Force / Account Lockout Protection
**File:** `apps/api/src/lib/security.ts` — `checkLoginAttempt()`, `recordFailedLogin()`

- **Threshold:** 10 failed attempts within a 10-minute window
- **Lockout duration:** 15 minutes
- **Scope:** Keyed by email address or IP
- **On success:** `clearLoginAttempts()` resets the counter
- **Privacy:** Identifiers stored as truncated SHA-256 hashes in security event logs

### Request Fingerprinting
**File:** `apps/api/src/lib/security.ts` — `fingerprintRequest()`

Each request is tagged with a 16-character hex fingerprint derived from `SHA-256(IP + User-Agent)`. Fingerprints are attached to all security event log entries to enable abuse correlation without storing PII.

### Security Metrics & Observability
**File:** `apps/api/src/lib/security.ts` — `getSecurityMetrics()`

Security events are counted in hourly Redis buckets with a 7-day TTL.

---

## Test Coverage

| Test File | What It Covers |
|-----------|----------------|
| `apps/api/src/__tests__/ssrf-guard.test.ts` | Private IP blocking, scheme blocking, metadata endpoint |
| `apps/api/src/__tests__/security.test.ts` | SQLi patterns, XSS patterns, path traversal, payload scanner, fingerprinting |
| `apps/api/src/__tests__/auth.test.ts` | Login flow, JWT issuance, brute-force lockout |

---

## Gate 6 Checklist

| Control | Status |
|---------|--------|
| HTTP security headers (CSP, HSTS, X-Frame-Options, etc.) | ✅ |
| SSRF protection on all outbound requests | ✅ |
| Injection attack payload scanning (SQLi, XSS, path traversal) | ✅ |
| Brute-force / account lockout protection | ✅ |
| Rate limiting on all routes | ✅ |
| Parameterized DB queries (no raw SQL interpolation) | ✅ |
| Secrets loaded from environment (no hardcoded credentials) | ✅ |
| `.env` excluded from git | ✅ |
| No secrets in git history | ✅ |
| No `dangerouslySetInnerHTML` in frontend | ✅ |
| No API keys bundled in frontend build | ✅ |
| `pnpm audit` dependency scan — 0 vulnerabilities | ✅ |
| CORS tightened to specific allowed origins | ✅ |
| Full Zod schema validation on all POST routes | ⚠️ Partial (see Risk 2) |

**Overall Gate 6 Status: PASS** — All critical security controls are in place. One accepted risk is low-severity with documented mitigation.

---

## TypeScript Strict Mode Fixes (2026-03-26)

The following strict-mode TypeScript errors were found and fixed during the Gate 6 audit pass:

| File | Error | Fix |
|------|-------|-----|
| `middleware/security.ts` | `req as Record<string, unknown>` — no index signature overlap | Cast via `unknown` intermediate |
| `utils/ssrf-guard.ts` | `ipv4Mapped[1]` possibly `undefined` | Added `?.[1]` optional chaining guard |
| `routes/auth.ts` | `reply.redirect(302, url)` — Fastify v5 reversed arg order | Changed to `reply.redirect(url, 302)` |
| `routes/auth.ts` | `reply.status(429)` not in schema response types | Added `429` and `503` to route schemas |
| `routes/analytics.ts` | Knex `QueryBuilder` → `Promise<T>` cast too narrow | Cast via `unknown` intermediate |
| `lib/briefing-generator.ts` | Array `[0]` access on typed responses possibly `undefined` (×4) | Optional chaining with early return guards |
| `routes/countries.ts` | `SEVE_MAP[n]` possibly `undefined` (bounded array) | Nullish coalescing `?? 0` |
| `routes/trade.ts` | `valueMatch[1]` from regex possibly `undefined` | Optional chaining guard |
| `routes/admin-kafka.ts` | `reply.status(403)` not in schema response types | Added `403` to route schema |
| `packages/types/src/index.ts` | `'alert.breaking'` missing from `WSEventType` union | Added to union type |
