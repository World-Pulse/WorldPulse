# WorldPulse Brain Agent — Blockers Log

## Active Blockers

*No active blockers as of 2026-03-28 (commit b22076f cleared all pending staged changes).*

---

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

---

## Resolved Blockers

- **2026-03-28 Commit b22076f:** All accumulated staged changes from cycles 10–71 committed and pushed in one batch (110 files, 15K+ insertions). The multi-cycle NTFS index.lock backlog is fully cleared. Changes included: Vercel config, .env.example, OSINT sources (ACLED/CISA/OFAC/ReliefWeb/Safecast/etc.), API routes (breaking/briefings/countries/threats), scraper pipeline, web components (BreakingAlertBanner, CIBWarningBadge, RiskScoreGauge, RelatedSignals, clusters page), and all test suites.
- **2026-03-22 Cycle 28:** index.lock was absent at start of Cycle 29 — git status showed clean. This means Windows sometimes clears the lock on its own (probably VSCode/Windows Terminal restart).
