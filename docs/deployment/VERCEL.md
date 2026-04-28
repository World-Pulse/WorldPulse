# WorldPulse — Vercel Deployment Guide

> **Note:** WorldPulse production is currently self-hosted via Docker/Nginx on `142.93.71.102`.
> This guide documents how to deploy the **`apps/web`** Next.js frontend to Vercel as an alternative
> or supplementary CDN-edge deployment (e.g. for preview environments, geo-distributed CDN, or a
> future migration off the self-hosted setup).

---

## Prerequisites

- Vercel account with a team or personal project
- Access to the WorldPulse GitHub repository
- `NEXT_PUBLIC_API_URL` pointing to the live API (`https://api.world-pulse.io`)

---

## Project Configuration

A `vercel.json` file is located at `apps/web/vercel.json` and configures:

| Setting | Value | Purpose |
|---|---|---|
| `framework` | `nextjs` | Explicit Next.js detection (Vercel auto-detects but explicit is safer in monorepos) |
| `buildCommand` | `pnpm turbo run build --filter=@worldpulse/web` | Turborepo-aware monorepo build from the repo root |
| `installCommand` | `pnpm install --frozen-lockfile` | Locked dependency install |
| `functions maxDuration` | `30s` | Prevents API route timeouts on cold starts |
| `rewrites /monitoring-tunnel` | Sentry ingest | Tunnels Sentry requests through Next.js to bypass ad-blockers (matches `tunnelRoute` in next.config.mjs) |
| `ignoreCommand` | git diff check | Skips redundant Vercel rebuilds when only unrelated packages change |

---

## Required Environment Variables

Set these in **Vercel Dashboard → Project → Settings → Environment Variables**.

### Runtime (Frontend)

| Variable | Example Value | Required |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.world-pulse.io` | ✅ Yes |
| `NEXT_PUBLIC_WS_URL` | `wss://api.world-pulse.io` | ✅ Yes |
| `NEXT_PUBLIC_APP_URL` | `https://world-pulse.io` | ✅ Yes |

### Build-time (Sentry)

| Variable | Example Value | Required |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | `https://xxx@oXXX.ingest.sentry.io/YYY` | For error tracking |
| `SENTRY_DSN` | *(same as above)* | Server-side Sentry |
| `SENTRY_AUTH_TOKEN` | `sntrys_...` | Required for source map upload |
| `SENTRY_ORG` | `worldpulse` | Your Sentry org slug |
| `SENTRY_PROJECT` | `worldpulse-web` | Your Sentry project slug |

### Auth

| Variable | Example Value | Required |
|---|---|---|
| `NEXTAUTH_SECRET` | *(generated secret)* | For NextAuth sessions |
| `NEXTAUTH_URL` | `https://world-pulse.io` | Canonical app URL |
| `GITHUB_CLIENT_ID` | *(from GitHub OAuth App)* | GitHub login |
| `GITHUB_CLIENT_SECRET` | *(from GitHub OAuth App)* | GitHub login |

### Feature Flags (Optional)

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | — | If switching from MapLibre to Mapbox |
| `NEXT_PUBLIC_MAPTILER_KEY` | — | MapTiler basemap tiles (satellite/terrain) |
| `NEXT_PUBLIC_POSTHOG_KEY` | — | PostHog analytics (set in PostHogProvider) |
| `ANALYZE` | `false` | Set to `true` to generate bundle analysis |

---

## Vercel Dashboard Setup (Monorepo)

1. **Import Repository** → select the WorldPulse GitHub repo
2. **Root Directory** → set to `apps/web` (Vercel will detect Next.js in this subdirectory)
3. **Build & Output Settings** → leave as "Override" with the values in `vercel.json`
4. **Environment Variables** → add all variables from the table above
5. **Deploy**

> If deploying from the repository root instead of `apps/web`, the `buildCommand` in `vercel.json`
> runs `cd ../.. && pnpm turbo run build --filter=@worldpulse/web` to build from the monorepo root.

---

## Content Security Policy Notes

The `connect-src` directive in `next.config.mjs` is environment-aware:

```js
// Localhost API connections are included ONLY in development
...(process.env.NODE_ENV !== 'production'
  ? ['http://localhost:3001', 'ws://localhost:3001']
  : [])
```

In production Vercel deployments, `NODE_ENV` is automatically set to `production`, so
`localhost:3001` will **not** appear in the CSP header. This prevents the browser from
attempting to connect to a non-existent local API on production pages.

**Production CSP `connect-src` includes:**
- `https://api.world-pulse.io` — main REST API
- `wss://api.world-pulse.io` — WebSocket for live signal feed
- `https://tile.openstreetmap.org` — map tiles
- `https://celestrak.org` — satellite TLE data
- `https://gibs.earthdata.nasa.gov` — NASA GIBS imagery
- `https://d2ad6b4ur7yvpq.cloudfront.net` — Natural Earth GeoJSON
- `https://*.ingest.sentry.io` / `https://*.ingest.us.sentry.io` — Sentry

---

## NEXT_PUBLIC_API_URL Fallback Pattern

All 55 frontend pages use the environment-aware API URL pattern:

```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
```

The `?? 'http://localhost:3001'` fallback is intentional for local development —
it has no effect when `NEXT_PUBLIC_API_URL` is set (which it always is in Vercel deployments).

**Action required:** Ensure `NEXT_PUBLIC_API_URL` is set to `https://api.world-pulse.io`
in all Vercel environments (Production, Preview, Development).

---

## Preview Deployments

Vercel automatically creates preview URLs for each pull request. To route preview builds
to the production API:

- Set `NEXT_PUBLIC_API_URL` in **Preview** environment scope → `https://api.world-pulse.io`
- The API has CORS configured for `*.vercel.app` preview URLs via the `CORS_ORIGINS` env var on the API server

To add preview URL CORS support on the API, update `CORS_ORIGINS` on the production server:

```bash
ssh root@142.93.71.102
# Add *.vercel.app to CORS_ORIGINS in /opt/worldpulse/.env.prod
```

---

## Deployment Commands (Manual)

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Link project (first time)
cd apps/web && vercel link

# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

---

## Troubleshooting

| Issue | Cause | Fix |
|---|---|---|
| `Cannot find module '@worldpulse/types'` | `transpilePackages` not picking up monorepo package | Ensure `vercel.json` `buildCommand` runs from monorepo root, not `apps/web/` |
| API calls failing in preview | `NEXT_PUBLIC_API_URL` not set for Preview env | Add env var to Preview scope in Vercel dashboard |
| Sentry source maps missing | `SENTRY_AUTH_TOKEN` not set | Add token to Build environment in Vercel dashboard |
| CSP violations in console | Sentry tunnel route not configured | Verify `tunnelRoute: '/monitoring-tunnel'` in `next.config.mjs` and `rewrites` in `vercel.json` |
| 504 on `/api/` routes | Function timeout exceeded | Increase `functions.maxDuration` in `vercel.json` (max 60s on Pro, 300s on Enterprise) |

---

## Related Docs

- [SENTRY.md](./SENTRY.md) — Sentry error tracking setup
- [self-hosting.md](../self-hosting.md) — Docker self-host guide (current production)
