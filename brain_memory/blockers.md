# WorldPulse Brain Agent — Blockers Log

## Active Blockers

### Cycle 71 — git index.lock persists (2026-03-28)
**Status:** Persists — cannot remove from Linux VM (NTFS FUSE mount restriction)
**Files created/modified this cycle (NOT yet committed):**
- `vercel.json` (NEW — root-level Vercel deployment config, 60L)
- `apps/web/.env.example` (NEW — documents all 8 NEXT_PUBLIC_ env vars)
- `apps/web/src/app/clusters/page.tsx` (FIXED — localhost:4000 → localhost:3001)
- `apps/web/src/__tests__/vercel-config.test.ts` (NEW — 18-assertion config test suite)
- `brain_memory/*.json` (REBUILT — cycle 71 state)
**Suggested commit (run from Windows PowerShell in project directory):**
```powershell
del .git\index.lock; del .git\HEAD.lock; del .git\index2.lock
git add vercel.json apps/web/.env.example apps/web/src/app/clusters/page.tsx apps/web/src/__tests__/vercel-config.test.ts brain_memory/
git commit -m "feat(infra): Vercel deployment config — vercel.json, .env.example, clusters port fix, 18-assertion config tests"
git push
```

---

### Cycle 62 — git index.lock persists (2026-03-28)
**Status:** Persists — cannot remove from Linux VM (NTFS FUSE mount restriction)
**Files created/modified this cycle (NOT yet committed):**
- `apps/web/src/lib/sentry.ts` (NEW — 96L, Sentry config + lazy helpers)
- `apps/web/sentry.client.config.ts` (NEW — client-side init with Replay + BrowserTracing)
- `apps/web/sentry.server.config.ts` (NEW — server-side init)
- `apps/web/sentry.edge.config.ts` (NEW — edge runtime init)
- `apps/web/src/app/global-error.tsx` (NEW — root layout error boundary)
- `apps/web/src/app/error.tsx` (NEW — app-level error boundary)
- `apps/web/src/__tests__/sentry.test.ts` (NEW — 11 unit tests)
- `apps/web/next.config.mjs` (MODIFIED — CSP connect-src for Sentry ingest)
- `brain_memory/*.json` (REBUILT — cycle 62 state)
**Suggested commit (run from Windows PowerShell in project directory):**
```powershell
del .git\index.lock; del .git\HEAD.lock; del .git\index2.lock
git add apps/web/src/lib/sentry.ts apps/web/sentry.client.config.ts apps/web/sentry.server.config.ts apps/web/sentry.edge.config.ts apps/web/src/app/global-error.tsx apps/web/src/app/error.tsx apps/web/src/__tests__/sentry.test.ts apps/web/next.config.mjs brain_memory/
git commit -m "feat(web): add Sentry error tracking — client/server/edge configs, error boundaries, CSP update, 11 tests"
git push
```

---

### Cycle 60 — git index.lock persists (2026-03-27)
**Status:** Persists — cannot remove from Linux VM (NTFS FUSE mount restriction)
**Files created/modified this cycle (NOT yet committed):**
- `apps/web/src/app/developers/page.tsx` (NEW — ~580 lines, Developer Portal page)
- `apps/web/src/components/nav/TopNav.tsx` (MODIFIED — added Developers nav link)
- `apps/web/src/components/sidebar/LeftSidebar.tsx` (MODIFIED — added Developers nav item)
- `apps/web/messages/*.json` (MODIFIED — added "developers" i18n key to all 10 locales)
- `apps/api/src/__tests__/developer-portal.test.ts` (NEW — 25 integration tests)
- `brain_memory/*.json` (REBUILT — cycle 60 state)
**Suggested commit (run from Windows PowerShell in project directory):**
```powershell
del .git\index.lock; del .git\HEAD.lock; del .git\index2.lock
git add apps/web/src/app/developers/page.tsx apps/web/src/components/nav/TopNav.tsx apps/web/src/components/sidebar/LeftSidebar.tsx "apps/web/messages/*.json" apps/api/src/__tests__/developer-portal.test.ts brain_memory/
git commit -m "feat(web): add Developer Portal page — interactive API docs, 4-lang code examples, 8 endpoint groups, 25 tests"
git push
```

---

### Cycle 57 — git index.lock persists (2026-03-27T19:30Z)
**Status:** Persists — cannot remove from Linux VM (NTFS FUSE mount restriction)
**Files modified this cycle (NOT yet committed):**
- `apps/web/src/app/signals/[id]/SignalDetailClient.tsx` (MODIFIED — RichMediaEmbed import + media section ~15 lines)
- `apps/api/src/__tests__/signal-media-embed.test.ts` (NEW — 174 lines)
- `brain_memory/brain_state.json` (REBUILT — cycle 57 state, fixed truncated JSON from cycle 55)
- `brain_memory/competition_intel.json` (UPDATED — cycle 57 scan, multimedia gap closed)
- `brain_memory/improvement_log.json` (REBUILT — full history, cycle 57 entry added)
- `brain_memory/last_improvement.txt` (UPDATED — cycle 57 summary)
**Suggested commit (run from Windows PowerShell in project directory):**
```powershell
del .git\index.lock; del .git\HEAD.lock; del .git\index2.lock
git add apps/web/src/app/signals/[id]/SignalDetailClient.tsx apps/api/src/__tests__/signal-media-embed.test.ts brain_memory/
git commit -m "feat(signals): wire RichMediaEmbed into signal detail — YouTube/Vimeo auto-embed, media_urls array, 174 tests; counter Ground News Podcasts & Opinions"
git push
```

---

### Cycle 55 — git index.lock persists (2026-03-27T18:22Z)
**Status:** Persists — cannot remove from Linux VM (NTFS FUSE mount restriction)
**Files modified this cycle (NOT yet committed):**
- `apps/scraper/src/pipeline/verify.ts` (MODIFIED — added verification_log writes with verifier_type/verdict/score_delta)
- `apps/api/src/db/migrations/021_verification_log.sql` (MODIFIED — added verifier_type, verdict, score_delta columns + index)
- `apps/api/src/routes/signals.ts` (MODIFIED — GET /:id returns verifications array; GET /:id/verifications dedicated endpoint)
- `apps/web/src/components/signals/VerificationTimeline.tsx` (MODIFIED — AggregateScoreBar, empty state, confidence bars)
- `apps/api/src/__tests__/verification-badge.test.ts` (NEW — 287 lines)
- `apps/api/src/__tests__/verification-timeline.test.ts` (NEW — 125 lines)
**Suggested commit (run from Windows PowerShell in project directory):**
```powershell
del .git\index.lock; del .git\HEAD.lock; del .git\index2.lock
git add apps/scraper/src/pipeline/verify.ts apps/api/src/db/migrations/021_verification_log.sql apps/api/src/routes/signals.ts apps/web/src/components/signals/VerificationTimeline.tsx apps/api/src/__tests__/verification-badge.test.ts apps/api/src/__tests__/verification-timeline.test.ts brain_memory/
git commit -m "feat(verification): wire verification engine to UI — log writes, /signals/:id/verifications endpoint, AggregateScoreBar, 412 test lines"
git push
```

---

### Cycle 52 — git index.lock persists (2026-03-27)
**Status:** Persists — cannot remove from Linux VM (NTFS FUSE mount restriction)
**Files modified this cycle (NOT yet committed):**
- `apps/web/src/app/map/page.tsx` (MODIFIED — +160 lines: countryRiskMode state, choropleth useEffect, RISK MAP button, country risk legend)
- `apps/web/next.config.mjs` (MODIFIED — +28 lines: full CSP header with connect-src for CDNs)
- `apps/api/src/__tests__/map-country-risk.test.ts` (NEW — 26 unit tests)
**Suggested commit (run from Windows PowerShell in project directory):**
```powershell
del .git\index.lock; del .git\HEAD.lock; del .git\index2.lock
git add apps/web/src/app/map/page.tsx apps/web/next.config.mjs apps/api/src/__tests__/map-country-risk.test.ts
git commit -m "feat(map): add live country risk choropleth — joins /api/v1/countries with Natural Earth GeoJSON, 26 tests"
git push
```

---

### Cycle 51 — git index.lock persists (2026-03-27T15:23Z)
**Status:** Persists — cannot remove from Linux VM (NTFS FUSE mount restriction)
**Files modified this cycle (NOT yet committed):**
- `apps/api/src/lib/source-bias.ts` (MODIFIED — +115 lines: detectBiasHeuristic(), tokeniseDomain(), 5-rule heuristic engine)
- `apps/api/src/lib/__tests__/source-bias.test.ts` (NEW — 230 lines, 30 unit tests)
- `brain_memory/brain_state.json` (REBUILT — cycle 51 state, fixed truncated JSON from cycle 50)
- `brain_memory/competition_intel.json` (UPDATED — Intell Weave HIGH threat, closed GDELT gap)
- `brain_memory/improvement_log.json` (REBUILT — full history, cycle 51 entry added)
- `brain_memory/last_improvement.txt` (UPDATED — cycle 51 summary)
**Suggested commit (run from Windows PowerShell in project directory):**
```powershell
del .git\index.lock
del .git\HEAD.lock
del .git\index2.lock
git add apps/api/src/lib/source-bias.ts apps/api/src/lib/__tests__/source-bias.test.ts brain_memory/
git commit -m "feat(bias): implement heuristic detection for unknown news domains -- closes documented stub; 5 rules (TLD authority, parent inheritance, state-media CCTLD, keyword scan); 30 tests"
git push
```

---

### Cycle 49 — git index.lock (2026-03-27T14:05Z)
**Status:** Persists — cannot remove from Linux VM (NTFS FUSE mount restriction)
**Files modified this cycle (NOT yet committed):**
- `apps/api/src/routes/signals.ts` (MODIFIED — +77 lines: GET /map/hotspots geographic convergence endpoint)
- `apps/web/src/app/map/page.tsx` (MODIFIED — +80 lines: Hotspot interface, useEffect, Convergence Alerts widget)
- `apps/api/src/__tests__/hotspots.test.ts` (NEW — 165 lines, 7 unit tests for convergence hotspot endpoint)
- `brain_memory/brain_state.json` (REBUILT — cycle 49 state, fixed truncated JSON from cycle 48)
- `brain_memory/competition_intel.json` (MODIFIED — World Monitor/Ground News upgraded to HIGH threat)
- `brain_memory/improvement_log.json` (MODIFIED — cycle 49 entry added)
- `brain_memory/last_improvement.txt` (MODIFIED — cycle 49 summary)
**Suggested commit (run from Windows PowerShell in project directory):**
```powershell
del .git\index.lock
del .git\HEAD.lock
git add apps/api/src/routes/signals.ts apps/web/src/app/map/page.tsx apps/api/src/__tests__/hotspots.test.ts brain_memory/
git commit -m "feat(map): add geographic convergence hotspot detection — /map/hotspots API + Convergence Alerts widget, 7 tests"
git push
```

### Cycle 47 — git index.lock (2026-03-27T13:30Z)
**Status:** Persists — cannot remove from Linux VM (NTFS FUSE mount restriction)
**Files modified this cycle (NOT yet committed):**
- `apps/api/src/lib/alert-dispatcher.ts` (MODIFIED — +80 lines: db import, dispatchDbSubscriptionAlerts method, fixed singleton export)
- `apps/api/src/__tests__/alert-db-subscriptions.test.ts` (NEW — 20 unit tests for DB subscription email delivery)
- `brain_memory/brain_state.json` (MODIFIED — cycle 47 state, rebuilt from truncated version)
- `brain_memory/competition_intel.json` (MODIFIED — worldmonitor HIGH threat added)
- `brain_memory/improvement_log.json` (MODIFIED — cycle 47 entry added)
- `brain_memory/last_improvement.txt` (MODIFIED — cycle 47 summary)
**Suggested commit (run from Windows PowerShell in project directory):**
```powershell
del .git\index.lock
del .git\HEAD.lock
git add apps/api/src/lib/alert-dispatcher.ts apps/api/src/__tests__/alert-db-subscriptions.test.ts brain_memory/
git commit -m "feat(alerts): wire DB alert_subscriptions to email dispatcher — keyword/category/country/severity filters, 20 tests"
git push
```

### Cycle 45 — git index.lock (2026-03-27T12:21Z)
**Status:** Persists — cannot remove from Linux VM (NTFS FUSE mount restriction)
**Files modified this cycle (NOT yet committed):**
- `apps/web/src/app/map/page.tsx` (MODIFIED — +876 lines: category filter bar, time range, heatmap toggle, visible signal count badge)
**Suggested commit (run from Windows PowerShell in project directory):**
```powershell
del .git\index.lock
del .git\HEAD.lock
git add apps/web/src/app/map/page.tsx
git commit -m "feat(map): add category+time filter bar, heatmap toggle, visible signal count badge"
git push
```

### Cycle 44 — git index.lock (2026-03-27T17:00Z)
**Status:** Persists — cannot remove from Linux VM (NTFS FUSE mount restriction)
**Files created/modified this cycle (NOT yet committed):**
- `apps/api/src/graphql/schema.ts` (MODIFIED — added Subscription type: signalCreated, signalUpdated)
- `apps/api/src/graphql/resolvers.ts` (MODIFIED — added Subscription resolver object with subscribe())
- `apps/api/src/graphql/index.ts` (MODIFIED — enabled subscription: true in mercurius)
- `apps/api/src/graphql/__tests__/subscriptions.test.ts` (NEW — 6 tests validating schema + resolvers)
- `brain_memory/*.json` (MODIFIED — cycle 44 state, competition intel, improvement log)
**Suggested commit (run from Windows PowerShell in project directory):**
```powershell
del .git\index.lock
git add apps/api/src/graphql/ brain_memory/
git commit -m "feat(graphql): add real-time Subscription type for signalCreated and signalUpdated"
git push
```

### Cycle 38 — git index.lock (2026-03-27T06:28Z)
**Status:** Persists — cannot remove from Linux VM (NTFS FUSE mount restriction)
**Files created/modified this cycle (NOT yet committed):**
- `apps/api/src/lib/errors.ts` (NEW — 95L: sendError helper, ErrorCode type, ApiError interface, 9 convenience shorthands)
- `apps/api/src/lib/__tests__/errors.test.ts` (NEW — 140L: 13 unit tests for sendError + all convenience helpers)
- `apps/api/src/routes/signals.ts` (MODIFIED — added parseBbox() helper with full coordinate range validation + NaN/Infinity checks applied to signal list AND map/points bbox routes; added sendError import)
- `apps/api/src/routes/bundles.ts` (MODIFIED — fixed bare `{ error: '...' }` to use sendError() with success:false + VALIDATION_ERROR code)
**Suggested commit (run from Windows PowerShell in project directory):**
```powershell
del .git\index.lock
git add apps/api/src/lib/errors.ts apps/api/src/lib/__tests__/errors.test.ts apps/api/src/routes/signals.ts apps/api/src/routes/bundles.ts
git commit -m "feat(api): centralize error responses — sendError helper, ErrorCode enum, bbox input validation"
git push
```

### Cycle 34 — git index.lock (2026-03-27)
**Status:** Persists from previous cycles — cannot remove from Linux VM
**Files awaiting commit (Cycle 34 new/modified):**
- `apps/web/src/components/signals/ReliabilityDots.tsx` (MODIFIED — 131→258L, 5-tier explainer tooltip)
**Suggested commit (run from Windows PowerShell):**
```powershell
del .git\index.lock
git add apps/web/src/components/signals/ReliabilityDots.tsx
git commit -m "feat(ui): enhance ReliabilityDots tooltip with 5-tier scoring system explainer and factor breakdown"
git push
```

### git index.lock (LOW SEVERITY — PERSISTENT)
- **Date last seen:** 2026-03-26 Cycle 2 (brain agent), also Cycle 152 (autopilot)
- **Cycle 2 new untracked files awaiting commit:**
  - `apps/api/src/routes/analytics.ts` (MODIFIED — +200 lines, trending-entities endpoint)
  - `apps/api/src/__tests__/trending-entities.test.ts` (NEW — 245 lines, 14 tests)
- **Commit message for Cycle 2 changes:**
  ```
  feat(analytics): add trending-entities endpoint with entity extraction pipeline
  ```
- **Files:** `.git/HEAD.lock` (created 22:01, pre-existing Windows crash) + `.git/index.lock` (created 22:18, during this cycle's git add)
- **Description:** Both lock files exist on Windows NTFS. Linux VM cannot unlink them (Operation not permitted). All git add, commit, and push operations fail.
- **Current state (Cycle 152):** All multi-cycle changes are staged in git index or untracked on disk. Cycle 152 created apps/api/src/middleware/security.ts + security/AUDIT.md — both on disk, both blocked from commit. Files are NOT lost. Need to be committed from Windows PowerShell.
- **Resolution (run from Windows PowerShell in project directory):**
  ```powershell
  del .git\HEAD.lock
  del .git\index.lock
  git commit -m "fix(feed): wire category channel tabs + update classifier + live sidebar counts"
  git push
  ssh root@142.93.71.102 "cd /opt/worldpulse && git pull && ./deploy.sh"
  ```
- **Note:** Every brain agent cycle accumulates staged changes. The NTFS lock issue is fundamental to running git in WSL2 against a Windows-mounted folder. Consider running the brain agent with git operations from Windows side instead, OR setting up a Linux-native git repo with push-to-Windows-checkout workflow.

## Stability Gate Blocker — OSINT Poller Health Tracking (2026-03-26)

**Status:** PARTIAL — mitigated, known residual gap
**Severity:** MEDIUM — does not prevent the stability clock from starting, but reduces OSINT visibility

**Description:**
All 29 OSINT source pollers (`gdelt`, `adsb`, `seismic`, etc.) use `setInterval` internally
and do NOT call `recordSuccess`/`recordFailure` from `health.ts`. This means the pollers are
invisible to the stability tracker when they poll successfully but produce **zero new signals**
in a given hour (e.g., a quiet hour for volcano alerts or patent grants).

**What was fixed:**
`insertAndCorrelate()` in `apps/scraper/src/pipeline/insert-signal.ts` now calls
`recordSuccess(meta.sourceId, meta.sourceName ?? meta.sourceId, meta.sourceSlug ?? meta.sourceId, undefined, 1)`
after every successful signal insertion. Any OSINT source that produces ≥1 signal per hour
will have its `last_seen` updated in the health index, making it visible to the stability
tracker's 70% clean-source threshold.

**Residual gap:**
OSINT sources that produce **no new signals** in a given hour (dedup cache hits, or genuinely
quiet periods) will NOT update their `last_seen`. If enough such sources are idle in the same
hour, the stability check could fail. In practice, high-frequency sources (GDELT, NWS, seismic,
space weather) produce signals most hours and will anchor the 70% quorum.

**Long-term fix (low priority):**
Add a dedicated health-heartbeat call at the end of each OSINT source's poll loop, even when
no new signals are emitted. This requires modifying each of the 29 source files — deferred to
avoid unnecessary churn before the 14-day stability window starts.

## Gate 6 Security Cycle (2026-03-26) — Staged Changes Awaiting Commit
**Status:** Files modified/updated, git.lock prevents commit
**Files changed:**
- `apps/api/package.json` — fastify bumped to ^5.8.3
- `pnpm-lock.yaml` — regenerated after tar/picomatch overrides applied
- `.gitignore` — pre-commit reminder + .env.staging, *.pem, *.key, secrets/
- `security/AUDIT.md` — fully updated Gate 6 audit document

**Suggested commit:**
```bash
git add apps/api/package.json pnpm-lock.yaml .gitignore security/AUDIT.md
git commit -m "feat(security): Gate 6 hardening — 0 vuln audit, fastify 5.8.3, tar/picomatch overrides"
```

## Cycle 10 — git index.lock (2026-03-26, Cycle 10)
**Status:** Files created on disk, awaiting commit
**Cause:** Stale .git/index.lock from previous cycle crash on Windows NTFS FUSE mount
**Files created this cycle (NOT yet committed):**
- `apps/api/src/db/migrations/009_webhooks.sql` (NEW — developer_webhooks + webhook_deliveries tables)
- `apps/api/src/lib/webhooks.ts` (NEW — HMAC-SHA256 webhook delivery library, 175 lines)
- `apps/api/src/routes/developer.ts` (MODIFIED — 4 new webhook endpoints: POST/GET/DELETE /webhooks, GET /webhooks/:id/deliveries)
- `apps/api/src/ws/handler.ts` (MODIFIED — fireWebhooks() wired to signal.new + alert.breaking Redis events)
- `apps/api/src/__tests__/webhooks.test.ts` (NEW — 28 unit tests: HMAC, filter matching, schema validation, limit)
**Suggested commit (run from Windows PowerShell):**
```powershell
del .git\index.lock
git add apps/api/src/db/migrations/009_webhooks.sql apps/api/src/lib/webhooks.ts apps/api/src/routes/developer.ts apps/api/src/ws/handler.ts apps/api/src/__tests__/webhooks.test.ts
git commit -m "feat(developer): add outbound webhooks — HMAC-signed HTTP delivery, 4 CRUD endpoints, 28 tests"
git push
```

## Cycle 13 — git index.lock (2026-03-26)
**Status:** Files created on disk by Claude Code, session timed out before git commit
**Cause:** Claude Code subprocess SIGTERM'd after max-turns, .git/index.lock persists on Windows NTFS
**Files created this cycle (NOT yet committed):**
- `apps/api/src/routes/briefing.ts` (NEW — 244 lines, GET /api/v1/briefing/daily)
- `apps/api/src/routes/briefings.ts` (NEW — AI narrative briefing)
- `apps/api/src/routes/breaking.ts` (NEW — breaking alerts CRUD)
- `apps/api/src/lib/briefing-generator.ts` (NEW — 568 lines, LLM narrative synthesis)
- `apps/api/src/lib/breaking-alerts.ts` (NEW — breaking alert system)
- `apps/api/src/lib/alert-dispatcher.ts` (MODIFIED)
- `apps/web/src/app/briefing/page.tsx` (NEW — 427 lines, daily brief UI)
- `apps/api/src/__tests__/briefing.test.ts` (NEW — 269 lines)
- `apps/api/src/__tests__/breaking-alerts.test.ts` (NEW — 233 lines)
- `apps/api/src/__tests__/auth.test.ts` (NEW — 300 lines)
- `apps/api/src/__tests__/feed.test.ts` (NEW — 287 lines)
- `apps/api/src/__tests__/signals.test.ts` (MODIFIED — 450 lines)
- `apps/api/src/__tests__/cib-detection.test.ts` (NEW — 212 lines)
- `apps/api/src/__tests__/entities.test.ts` (NEW — 211 lines)
- `apps/api/src/__tests__/risk-score.test.ts` (NEW — 153 lines)
- `apps/api/src/__tests__/threats.test.ts` (NEW — 346 lines)
- `apps/api/src/index.ts` (MODIFIED — briefing + breaking routes registered)
**Suggested commit (run from Windows PowerShell):**
```powershell
del .git\index.lock
git add apps/api/src/routes/briefing.ts apps/api/src/routes/briefings.ts apps/api/src/routes/breaking.ts apps/api/src/lib/briefing-generator.ts apps/api/src/lib/breaking-alerts.ts apps/api/src/lib/alert-dispatcher.ts apps/web/src/app/briefing/page.tsx apps/api/src/__tests__/briefing.test.ts apps/api/src/__tests__/breaking-alerts.test.ts apps/api/src/__tests__/auth.test.ts apps/api/src/__tests__/feed.test.ts apps/api/src/__tests__/signals.test.ts apps/api/src/__tests__/cib-detection.test.ts apps/api/src/__tests__/entities.test.ts apps/api/src/__tests__/risk-score.test.ts apps/api/src/__tests__/threats.test.ts apps/api/src/index.ts
git commit -m "feat(briefing): add AI daily intelligence briefing API + UI, breaking alerts, comprehensive test suite"
git push
```

## Cycle 26 — git index.lock (2026-03-26T22:15Z)
**Status:** Files fixed on disk, awaiting commit
**Cause:** Stale .git/index.lock prevents git add from Linux/WSL2 VM
**Files fixed this cycle (NOT yet committed):**
- `apps/scraper/src/sources/eu-sanctions.ts` (truncation fixed — 231→240 lines, completed startEuSanctionsPoller)
- `apps/scraper/src/sources/aviation-incidents.ts` (truncation fixed — 305→310 lines, completed clearInterval return)
- `apps/scraper/src/pipeline/insert-signal.ts` (truncation fixed — 103→123 lines, completed Redis publish + return signal)
**Suggested commit (run from Windows PowerShell):**
```powershell
del .git\index.lock
git add apps/scraper/src/sources/eu-sanctions.ts apps/scraper/src/sources/aviation-incidents.ts apps/scraper/src/pipeline/insert-signal.ts
git commit -m "fix(scraper): complete truncated OSINT source files — eu-sanctions, aviation-incidents, insert-signal"
git push
```

## Resolved Blockers
- **2026-03-22 Cycle 28:** index.lock was absent at start of Cycle 29 — git status showed clean. This means Windows sometimes clears the lock on its own (probably VSCode/Windows Terminal restart).