# WorldPulse — Phase 1-3 Strategic Roadmap

> The open-source intelligence layer for a dangerous world.

**Path A** (OSINT Bloomberg) — API-first structured data for analysts, hedge funds, risk teams.
**Path B** (Intelligence for Everyone) — Compelling reading experience for analysts, journalists, researchers.
**Strategy:** Build A's infrastructure while wearing B's face. B is growth; A is revenue.

**Two personas:** The Informed Individual (daily habit — checks WorldPulse before Twitter) and the Enterprise Analyst (decision support — can't prep for a meeting without it).

---

## Phase 1: Nail the Reading Experience (Now → 3 months)

**North star:** DAU returning 5+ days/week.
**The test:** Analyst opens WorldPulse at 7am → knows what happened overnight in 90 seconds → comes back tomorrow.

### 1.1 — AI Digest Quality (Sprint 1-2, weeks 1-4)

- [x] Dynamic reliability scoring (per-signal variance)
- [x] Severity recalibration (sports/culture/opinion capped at MEDIUM)
- [x] Corroboration threshold (single-source capped at MEDIUM)
- [x] Feed quality filter (tiered severity + reliability gates)
- [x] Category diversity cap (max 2 consecutive, 5 per page)
- [x] RECOMMENDATIONS section stripping
- [x] Markdown header stripping
- [x] Content deduplication in feed (event fingerprinting, keeps highest-reliability signal, shows related count)
- [x] Smart headline generation (FIRMS reverse-geocoding: "Major wildfire near Shan State, Myanmar" instead of raw coords)
- [x] Cross-source signal dedup (6h window, title+category fingerprint, prevents duplicate coverage)
- [x] Extended dedup TTL (1h → 24h to prevent RSS re-crawl duplicates)
- [x] Editorial voice consistency — PULSE style guide: active voice, lead with event, include significance, end with what to watch
- [x] Source attribution — Show corroborating sources: "Based on 3 sources: NASA FIRMS, Myanmar Times, Reuters"
- [x] Time-decay ranking — Time-weighted relevance score (severity × exponential decay, 4h half-life)

### 1.2 — Morning Briefing (Sprint 2-3, weeks 3-6)

- [x] "What happened while you slept" section — Timezone-aware, top 5-10 overnight events (GET /api/v1/pulse/briefing)
- [x] Regional focus — User-set region of interest filters the briefing (from onboarding prefs)
- [x] Trend detection — "Escalating" tags on developing stories (trending.ts: cluster analysis + severity escalation + frequency acceleration)
- [x] Executive summary — One paragraph, 3-4 sentences capturing the overnight picture (LLM-generated via fast tier)
- [x] Scheduled delivery — Email digest at preferred time via Resend, FLASH-tier push email for critical signals

### 1.3 — Personalization Layer (Sprint 3-5, weeks 5-10)

- [x] Interest profiles — Onboarding collects categories + regions, stored in users table
- [x] Feed personalization — Interest/region-based boosting in AI Digest feed (2h time windows)
- [x] Implicit learning — Track clicks, expands, bookmarks; after 50+ interactions, weight feed accordingly (user_interactions table, computeImplicitWeights engine, fire-and-forget tracking on click/like/bookmark)
- [x] "For You" feed tab — Personalized ranking distinct from "All" view (GET /api/v1/me/for-you, implicit+explicit interest merge, 48h window, category diversity cap)
- [x] Alert rules (basic) — "Notify me when CRITICAL + [category] + [region]". Email + in-app (alert_rules + alert_history + notifications tables, CRUD API, alert-matcher engine wired into flash brief publisher, Resend email delivery)
- [x] Saved searches — Save filter combo, one-click access (saved_searches table, CRUD API with use-count tracking, max 20 per user)

### 1.4 — Reading Experience Polish (Sprint 4-6, weeks 7-12)

- [x] Signal detail page redesign — Related signals, source chain, reliability breakdown, event timeline (already had RelatedSignals, SourceChain, ReliabilityDots, VerificationTimeline; added EventTimeline component showing story development over time)
- [x] Mobile-first optimization — Exceptional reading on phone (44px min touch targets, safe-area insets, responsive feed cards, readable typography for 7am use case)
- [x] Dark mode refinement — Bloomberg Terminal aesthetics (scan-line overlay, data-dense class, monospace data badges, severity glow effects, ticker-bar styling)
- [x] Loading performance — Feed renders <1s, skeleton loading, edge caching (FeedSkeleton shimmer, signal detail skeleton, stale-while-revalidate Cache-Control on feed API)
- [x] Offline support — PWA with service worker, cached last briefing (manifest.json, sw.js with briefing stale-while-revalidate strategy, app shell pre-caching, network-first API fallback)

### 1.5 — Data Quality Foundation (Sprint 1-6, continuous)

- [x] Duplicate signal detection (cross-source event dedup before insert)
- [x] Geographic validation — Cross-reference location tags against verified databases (geo-validator.ts: country↔coordinate consistency, Null Island detection, ISO code validation, reverse-geocode correction, batch validation every 30min, geo_validation_log table)
- [x] Source reputation scoring — Track accuracy over time, auto-reduce reliability for disputed sources (source-reputation.ts: rolling 30-day corroboration/dispute rates, auto-adjust reliability ±0.15, recompute every 6h, source_reputation table)
- [x] FIRMS source_count fix — Normalize to mean "independent sources", not "satellite detections" (source_count=1 always, cell.count moved to metadata only)
- [x] Classification accuracy tracking — Log disputes, use to retrain rule-based patterns (signal_disputes table, dispute API with auto-resolve at 3+ matching disputes, aggregate stats by type/category/source, /disputes/summary endpoint)

---

## Phase 2: Analyst Toolkit (3-6 months)

**North star:** Paid subscribers (Pro tier).
**The test:** Analyst says "I used Twitter lists + Google Alerts + RSS + a spreadsheet. Now I just use WorldPulse." Worth $30/month.

### 2.1 — Custom Watchlists

- [ ] Named watchlists ("Taiwan Strait", "Cyber Threats to Finance") — saved filter + alert rules
- [ ] Watchlist feed — Dedicated feed per watchlist, ordered by relevance
- [ ] Watchlist briefings — Auto daily summary per watchlist
- [ ] Shareable watchlists — Public/team-shared with URL

### 2.2 — Advanced Search

- [ ] Semantic search — Natural language queries against signal corpus
- [ ] Faceted filtering — Date range, category, severity, reliability, region, source, language
- [ ] Search history — Recent searches with one-click re-run
- [ ] Search-to-watchlist — "Save this search as a watchlist"

### 2.3 — Email & Push Intelligence

- [ ] Daily digest email — Configurable time, categories, severity, regions. Beautiful HTML
- [ ] Weekly intelligence report — Auto-generated 1-page PDF/email, trends + developing stories
- [ ] Real-time push alerts — Mobile push for FLASH-tier matching preferences (<60s latency)
- [ ] Slack/Teams integration — Post signals to channel, filter by watchlist

### 2.4 — Collaboration & Teams

- [ ] Team workspaces — Shared watchlists, annotations, alert rules
- [ ] Signal annotations — Team-visible notes on signals
- [ ] Assignment — Flag signal for teammate review

### 2.5 — Pro Tier Monetization

- [ ] Free tier — Full read access, 3 watchlists, basic alerts
- [ ] Pro tier ($29/month) — Unlimited watchlists, advanced search, email digests, team (5 members)
- [ ] Enterprise inquiry — Contact us for custom integrations, SLA, API, SSO

---

## Phase 3: Open the API (6-12 months)

**North star:** API customers and revenue per customer.
**The test:** Hedge fund pipes signals into risk model. Newsroom CMS generates story leads. SOC dashboard shows WorldPulse alongside their feeds.

### 3.1 — Public API

- [ ] RESTful signal API — Paginated, full metadata (category, severity, reliability, location, sources, correlation)
- [ ] Webhook alerts — Push delivery matching filter criteria
- [ ] Streaming endpoint — WebSocket or SSE for real-time delivery
- [ ] Bulk historical data — Archives by date range, CSV + JSON
- [ ] Rate limiting tiers — Free (100/day), Pro (10K/day), Enterprise (custom)

### 3.2 — API Infrastructure

- [ ] API key management — Self-service creation, rotation, usage dashboards
- [ ] SDKs — Python + JavaScript/TypeScript
- [ ] Documentation — OpenAPI spec, interactive docs, quickstart guides
- [ ] SLA guarantees — 99.9% uptime, <5s signal delivery latency

### 3.3 — Enterprise Features

- [ ] SSO/SAML
- [ ] Audit logging
- [ ] Custom data retention policies
- [ ] Dedicated support (named account manager for $50K+ contracts)
- [ ] On-premise deployment (Docker for air-gapped/government)

### 3.4 — API Monetization

- [ ] Developer tier (free) — 100 signals/day, 1 webhook, community support
- [ ] Professional ($499/month) — 50K signals/day, 10 webhooks, email support, historical data
- [ ] Enterprise ($5K-$50K/month) — Unlimited, custom webhooks, SLA, SSO, bulk data

---

## Automation & Development Infrastructure

- [x] Private repo (WorldPulse-v2) for Phase 1-3 development
- [x] Source health monitoring
- [x] Brain agent scheduled tasks (daily reflection, weekly competitor watch, health pulse)
- [ ] CI/CD pipeline for automated testing and deployment
- [ ] Branch-per-feature workflow with preview environments
- [ ] Automated signal quality metrics dashboard
- [ ] Performance regression detection
- [ ] Dependency vulnerability scanning
- [ ] Feed quality score (automated daily audit)
- [ ] User engagement metrics pipeline (PostHog)
- [ ] A/B testing framework for feed ranking

---

## Success Milestones

| Milestone | Target | Timeframe | Status |
|-----------|--------|-----------|--------|
| AI Digest: diverse, high-quality content | No category flooding, no garbage signals | Week 2 | ✅ Done |
| Morning briefing genuinely useful | One paragraph capturing overnight events | Week 4 | ✅ Done |
| First external user returns 5 days straight | Organic retention | Week 8 | ✅ Done |
| Personalization delivers relevant signals | "How did it know I care about this?" | Week 10 | ✅ Done |
| 100 daily active users | Organic growth from launch channels | Month 3 | 🔲 |
| Pro tier launches with paying subscribers | $29/month, watchlists, email digests | Month 5 | 🔲 |
| First API customer | Structured data access, webhooks | Month 8 | 🔲 |
| $1K MRR | Pro subscribers + API customers | Month 9 | 🔲 |
| $10K MRR | Enterprise API + growing Pro base | Month 12 | 🔲 |

---

*Last updated: April 22, 2026*
*Phase 1 COMPLETE. All sections (1.1, 1.2, 1.3, 1.4, 1.5) finished. Ready for Phase 2: Analyst Toolkit.*
