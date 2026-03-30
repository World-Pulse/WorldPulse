# Sentry Error Tracking & Performance Monitoring

WorldPulse uses [Sentry](https://sentry.io) for error tracking, performance monitoring, and session replay.
Both the Next.js web app and the Fastify API report to Sentry independently.

> **Self-hosted alternative:** [GlitchTip](https://glitchtip.com) is a drop-in Sentry-compatible API.
> Point the DSN vars at your GlitchTip project URL to replace Sentry entirely.

---

## Required environment variables

### `apps/web` (Next.js)

| Variable | Description | Required |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | Public DSN for the web project (browser + server) | Yes (to enable) |
| `SENTRY_AUTH_TOKEN` | Auth token for source map uploads at build time | Yes (for source maps) |
| `SENTRY_ORG` | Sentry organisation slug | Yes (for source maps) |
| `SENTRY_PROJECT` | Sentry project slug for the web app | Yes (for source maps) |
| `NEXT_PUBLIC_SENTRY_TRACES_RATE` | Performance traces sample rate, `0`–`1` (default: `0.1`) | No |
| `NEXT_PUBLIC_SENTRY_REPLAY_RATE` | Session replay sample rate (default: `0.1`) | No |
| `NEXT_PUBLIC_SENTRY_ERROR_REPLAY_RATE` | Session replay sample rate on error (default: `1.0`) | No |
| `NEXT_PUBLIC_APP_VERSION` | Release tag attached to Sentry events (e.g. `1.2.3`) | No |

### `apps/api` (Fastify)

| Variable | Description | Required |
|---|---|---|
| `SENTRY_DSN` | DSN for the API project | Yes (to enable) |
| `SENTRY_AUTH_TOKEN` | Auth token (if uploading API source maps separately) | No |
| `SENTRY_ORG` | Sentry organisation slug | No |
| `SENTRY_PROJECT` | Sentry project slug for the API | No |

---

## Obtaining the values

1. Go to **sentry.io → Settings → Projects → \<project\> → Client Keys (DSN)**.
2. Copy the full DSN (`https://xxx@oNNN.ingest.sentry.io/NNN`).
3. For `SENTRY_AUTH_TOKEN`: **Settings → Account → API → Auth Tokens → Create new token** with `project:releases` and `org:read` scopes.
4. `SENTRY_ORG` and `SENTRY_PROJECT` are the URL slugs visible in your Sentry dashboard URL.

---

## Local development

Sentry is **disabled by default** when `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` are not set.
No events are sent and no errors are thrown. Source map upload is skipped at build time
when `SENTRY_AUTH_TOKEN` is absent.

To test Sentry locally, add the DSN to `apps/web/.env.local` and `apps/api/.env`:

```
# apps/web/.env.local
NEXT_PUBLIC_SENTRY_DSN=https://xxx@oNNN.ingest.sentry.io/NNN

# apps/api/.env
SENTRY_DSN=https://yyy@oNNN.ingest.sentry.io/NNN
```

---

## Source map uploads

Source maps are uploaded to Sentry **at build time** via `withSentryConfig` in `next.config.mjs`.
The build will **succeed** even when `SENTRY_AUTH_TOKEN` is missing (upload is silently skipped).

To verify source maps are uploading:

```bash
SENTRY_AUTH_TOKEN=... SENTRY_ORG=... SENTRY_PROJECT=... pnpm --filter @worldpulse/web build
```

Look for `[sentry] Uploaded source maps` in the build output.

---

## Ad-blocker bypass (tunnel route)

`withSentryConfig` is configured with `tunnelRoute: '/monitoring-tunnel'`. This proxies
Sentry requests through the Next.js server so ad-blockers cannot block them.
No additional route file is needed — `@sentry/nextjs` handles it automatically.

---

## Using Sentry in application code

### Web (Next.js)

```ts
import { captureException, captureMessage, setSentryUser } from '@/lib/sentry'

// Report an error
captureException(new Error('Something went wrong'))

// Report a message
captureMessage('Unexpected state reached', 'warning')

// Set user context (call after login)
setSentryUser({ id: user.id, email: user.email })

// Clear user context (call after logout)
setSentryUser(null)
```

### API (Fastify)

```ts
import { captureException, flushSentry } from './lib/sentry'

// Report an error
captureException(err, { route: '/api/v1/signals' })

// Flush before process exit (Fastify close hook)
await flushSentry()
```

---

## Error Boundary

`apps/web/src/components/ErrorBoundary.tsx` is a React error boundary that:

- Automatically calls `captureException` when a child component throws.
- Shows a friendly fallback UI with a "Try again" button.
- Is wired into `apps/web/src/app/layout.tsx` to catch all page-level errors.

Use it to wrap individual sections for more granular error isolation:

```tsx
import { ErrorBoundary } from '@/components/ErrorBoundary'

<ErrorBoundary fallback={<p>Failed to load map.</p>}>
  <LiveMap />
</ErrorBoundary>
```
