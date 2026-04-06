# WorldPulse Brain Agent — Blockers Log

## Active Blockers

### NTFS Index Lock (Recurring) — Cycles 47, 48, 57, 61, 62, 63, 69, 73
**Status:** ACTIVE — requires manual resolution on Windows host
**Symptom:** `.git/index.lock` 0-byte file with NTFS permissions, cannot be deleted from Linux sandbox
**Resolution:** Delete `.git/index.lock` from Windows (File Explorer or `del .git\index.lock` in CMD) then run the commits below.

**Cycle 73 — Labor Rights Intelligence Page:**
```bash
git add apps/api/src/routes/labor-rights.ts \
        apps/api/src/routes/__tests__/labor-rights.test.ts \
        apps/web/src/app/labor-rights/page.tsx \
        apps/api/src/index.ts \
        apps/web/src/components/sidebar/LeftSidebar.tsx \
        apps/web/src/components/CommandPalette.tsx
git commit -m "feat(labor-rights): add Labor Rights Intelligence Page — 45+ countries, 5 indicators, 48 tests, full dashboard"
```

**Cycle 69 — RSS Source Expansion 500+:**
```bash
git add apps/api/migrations/20260402000003_expand_sources_500.ts \
        apps/api/migrations/__tests__/expand-sources-500.test.ts
git commit -m "feat(sources): expand RSS registry to 500+ feeds (50 new: EastAfrica/CEE/MiddleEast/Pacific/Water/Nuclear/Humanitarian/DigitalRights/Labor/Space)"
```

**Cycle 63 — Semantic Claim Verification v2:**
```bash
git add apps/api/src/routes/claims.ts \
        apps/api/src/routes/__tests__/claims-semantic.test.ts
git commit -m "feat(claims): upgrade Claim Verification Engine to v2.0 — Pinecone semantic similarity, contradiction detection, 38 tests"
```

**Cycle 62 — Claim Extraction & Verification API:**
```bash
git add apps/api/src/routes/claims.ts \
        apps/api/src/routes/__tests__/claims.test.ts \
        apps/web/src/app/claims/page.tsx \
        apps/api/src/index.ts \
        apps/web/src/components/sidebar/LeftSidebar.tsx
git commit -m "feat(claims): add Claim Extraction & Verification API — 3 endpoints, 30 tests, dashboard page (Factiverse counter)"
```

**Cycle 61 — RSS Expansion 350+ & Tasks Cleanup:**
```bash
git add apps/api/migrations/20260401000008_expand_sources_350.ts \
        apps/api/migrations/__tests__/expand-sources-350.test.ts \
        worldpulse_tasks.json
git commit -m "feat(sources): expand RSS registry to 346+ feeds (46 new: LatAm/SouthAsia/HornOfAfrica/WestAfrica/CentralAfrica/CentralAm/Conflict/Climate)"
```

**Cycle 57 — BAT-16 EnhancedHeatmap Tests:**
```bash
git add apps/web/src/__tests__/enhanced-heatmap.test.ts
git commit -m "test(map): BAT-16 EnhancedHeatmap — 28 unit tests (lifecycle, RAF, category ramps)"
```

**Cycle 47 — RSS Source Registry 250+:**
```bash
git add apps/api/migrations/20260401000005_expand_sources_250.ts \
        apps/api/migrations/__tests__/expand-sources-250.test.ts
git commit -m "feat(sources): expand RSS registry to 250+ feeds (40 new: SEAsia/Pacific/Nordic/EastEurope/SouthAsia/AfricaFR/Maritime/Space/Health/Arctic)"
```

**Cycle 48 — Country Resilience Score:**
```bash
git add apps/api/src/routes/countries.ts \
        apps/api/migrations/20260401000006_country_resilience_cache.ts \
        apps/api/src/routes/__tests__/countries-resilience.test.ts \
        apps/web/src/app/countries/resilience/page.tsx
git commit -m "feat(countries): Country Resilience Score — 6-dimension scoring system with /resilience/rankings page and per-country endpoint"
```

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
