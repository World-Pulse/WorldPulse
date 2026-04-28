# WorldPulse — Phase 1-4 Strategic Roadmap

> The open-source intelligence layer for a dangerous world.

**Path A** (OSINT Bloomberg) — API-first structured data for analysts, hedge funds, risk teams.
**Path B** (Intelligence for Everyone) — Compelling reading experience for analysts, journalists, researchers.
**Strategy:** Build A's infrastructure while wearing B's face. B is growth; A is revenue.

**Two personas:** The Informed Individual (daily habit — checks WorldPulse before Twitter) and the Enterprise Analyst (decision support — can't prep for a meeting without it).

---

## Phase 1: Nail the Reading Experience (COMPLETE)

**North star:** DAU returning 5+ days/week.
**The test:** Analyst opens WorldPulse at 7am → knows what happened overnight in 90 seconds → comes back tomorrow.

### 1.1 — AI Digest Quality ✅
### 1.2 — Morning Briefing ✅
### 1.3 — Personalization Layer ✅
### 1.4 — Reading Experience Polish ✅
### 1.5 — Data Quality Foundation ✅

*Phase 1 delivered: 120,000+ signals from 178 sources. Maritime intelligence. PULSE AI engine. PWA offline support. Bloomberg Terminal aesthetics.*

---

## Phase 1.6: Cerebral Cortex — Intelligence Maturation (NOW)

**North star:** The system gets smarter every day without human intervention.
**The test:** Analyst sees an insight WorldPulse surfaced that they couldn't have found manually — a cross-domain pattern, an entity connection, or an anomaly against baseline that no single source reported.

**Why now:** With 120K+ signals and 12 days of continuous ingestion, WorldPulse has enough data density to build real baselines and detect genuine anomalies. Below this threshold, pattern detection is noise. Above it, it becomes a competitive moat.

### 1.6.1 — Statistical Baselines (Sprint 1, weeks 1-2)

Store rolling signal statistics so the system knows what "normal" looks like and can identify genuine deviations.

- [ ] Daily baseline table — Store daily signal counts by category × region × severity (signal_baselines table, computed nightly)
- [ ] Rolling averages — 7-day, 30-day, and 90-day moving averages per category × region
- [ ] Z-score anomaly detection — Flag when current window exceeds 2σ above baseline ("Maritime signals near Strait of Hormuz are 2.7σ above the 30-day mean")
- [ ] Seasonality awareness — Day-of-week and time-of-day adjustment (weekday vs weekend news cycles, satellite pass timing for FIRMS)
- [ ] Baseline API endpoint — GET /api/v1/analytics/baselines?category=maritime&region=middle-east (current vs. baseline, z-score, trend direction)
- [ ] Wire into escalation index — Replace simple window-vs-previous-window with z-score-based escalation (statistically significant, not just "more than yesterday")

### 1.6.2 — Persistent Event Threads (Sprint 1-2, weeks 1-4)

Graduate ephemeral Redis clusters into durable PostgreSQL event threads that track developing stories over weeks.

- [ ] Event threads table — event_threads (id, title, category, region, first_seen, last_updated, signal_count, severity_trajectory, status: developing/escalating/stable/resolved)
- [ ] Signal-to-thread mapping — event_thread_signals junction table linking signals to their parent thread
- [ ] Thread lifecycle — Auto-create when correlation engine forms a cluster ≥3 signals. Merge when new signals bridge two existing threads. Mark "stable" after 48h without new signals. Mark "resolved" after 7d.
- [ ] Severity trajectory tracking — Store severity snapshots per thread over time (array of {timestamp, avg_severity, signal_count}). Enables "this story escalated from LOW to HIGH over 3 days."
- [ ] Thread API — GET /api/v1/threads (active threads, filterable by category/region/status), GET /api/v1/threads/:id (full thread with timeline)
- [ ] Thread summaries — LLM-generated narrative arc per thread ("Red Sea shipping disruptions began Mar 15 with Houthi drone attacks, escalated through carrier redeployments, now affecting 12% of global trade")
- [ ] Frontend: Developing Stories section — Show active event threads on homepage and relevant domain pages, with signal count, duration, and severity trend indicator
- [ ] Chokepoint → thread linking — When user clicks a chokepoint, show associated event threads alongside filtered signals

### 1.6.3 — Entity Relationship Strengthening (Sprint 2-3, weeks 3-6)

Close the gap where 90% of signals contribute entity nodes but no edges.

- [ ] Co-occurrence relationship inference — When two entities appear in the same signal 3+ times within 7 days, auto-create an inferred edge (predicate: "co_occurs_with", confidence based on frequency). No LLM needed.
- [ ] Batch co-occurrence job — Nightly scan of entity_nodes signal_ids, compute pairwise co-occurrence matrix, upsert inferred edges above threshold
- [ ] Temporal entity graph — Add first_seen, last_seen, mention_count, recent_trend (rising/stable/falling) to entity_nodes. Enable "Iran mentions are up 340% this week."
- [ ] Entity merging / dedup — Fuzzy match on entity names (Levenshtein distance ≤2, same type). "US Navy" and "U.S. Navy" should be one node. Semi-automated: flag candidates, auto-merge high-confidence, queue ambiguous for review.
- [ ] Relationship inference from causal chains — If signal A (category: conflict) mentions entity X and signal B (category: sanctions) mentions entity Y, and A↔B are correlated, infer edge X→Y with predicate from causal chain rules
- [ ] Entity importance scoring — PageRank or weighted degree centrality on the entity graph. Surface the most connected/influential entities, not just the most mentioned.
- [ ] Entity timeline API — GET /api/v1/entities/:id/timeline — chronological signal list + relationship changes over time for a single entity

### 1.6.4 — Semantic Similarity (Sprint 3-4, weeks 5-8)

Move beyond keyword Jaccard overlap to meaning-based signal correlation.

- [ ] Embedding pipeline — Generate embeddings for signal titles + first 200 chars of content on insert (model: text-embedding-3-small or equivalent)
- [ ] Vector storage — Pgvector extension in PostgreSQL (avoids Pinecone dependency, keeps everything in-stack). Index with IVFFlat or HNSW.
- [ ] Semantic correlation — In correlate.ts, add embedding cosine similarity as a 5th scoring factor (weight 0.25, rebalance existing 4 factors proportionally)
- [ ] Semantic dedup — Catch near-duplicate signals that use different wording (cosine similarity >0.92 within 6h window → treat as same event)
- [ ] Similar signals endpoint — GET /api/v1/signals/:id/similar — return top-N semantically similar signals across all time (not just recent window)
- [ ] Semantic search — Natural language query → embedding → vector search → ranked results (foundation for Phase 2.2 Advanced Search)
- [ ] Embedding backfill — One-time job to generate embeddings for existing 120K+ signals (batched, rate-limited, can run over 24-48h)

### 1.6.5 — Cross-Domain Pattern Detection (Sprint 4-5, weeks 7-10)

Discover emergent patterns the hardcoded causal chain rules don't cover.

- [ ] Learned causal chains — Analyze 30+ days of correlation data: which category pairs actually co-occur within 48h windows? Rank by frequency and confidence. Surface new chains: "cyber_threat → maritime is emerging (17 instances this month)"
- [ ] Cross-cluster bridging — Detect when two event threads share entities, geography, or temporal overlap but were classified in different categories. Flag for PULSE analysis: "The shipping disruption cluster and the sanctions cluster are connected through 3 shared entities"
- [ ] Geographic hotspot detection — Grid-based (H3 hexagons or lat/lng cells) signal density analysis. Identify regions with unusual multi-category activity: "Eastern Mediterranean has elevated signals across maritime, military, and sanctions categories simultaneously"
- [ ] Temporal sequence mining — Detect repeating sequences: "sanctions announcement → dark vessel spike → chokepoint alert" happening 3+ times suggests a predictable pattern
- [ ] Pattern alerts — When a new cross-domain pattern is detected, auto-generate a PULSE analysis post explaining the connection
- [ ] Weekly intelligence synthesis — Automated weekly report combining: top event threads, strongest entity connections, anomalies vs baseline, emerging cross-domain patterns

### 1.6.6 — Cerebral Cortex Infrastructure (Continuous)

- [ ] Migrate correlation clusters from Redis to PostgreSQL (Redis remains hot cache, Postgres is durable store)
- [ ] Signal processing pipeline metrics — Track correlation hit rate, entity extraction coverage, embedding generation latency
- [ ] Intelligence quality scoring — Automated daily audit: What % of signals have ≥2 sources? What % have entity extraction? What % have embeddings?
- [ ] Brain agent integration — Wire baseline anomalies, new event threads, and cross-domain patterns into the brain agent's daily reflection for autonomous improvement suggestions
- [ ] Cortex health dashboard — Internal page showing: baseline coverage, entity graph density, cluster-to-thread graduation rate, embedding backfill progress

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

- [ ] Semantic search — Natural language queries against signal corpus (built on 1.6.4 embedding infrastructure)
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

## Phase 4: Autonomous Intelligence Network (12+ months)

**North star:** WorldPulse generates intelligence no human analyst could produce alone.
**The test:** A cross-domain pattern surfaces 48 hours before mainstream media connects the dots.

### 4.1 — Self-Improving Analysis

- [ ] Feedback loops — Track which PULSE analyses get engagement. Reinforce patterns that produce high-value insights.
- [ ] Analyst-in-the-loop — Pro users can confirm/reject entity relationships and pattern detections, training the system
- [ ] Predictive signals — Based on learned temporal sequences, flag "early warning" when the first step of a known pattern fires
- [ ] Autonomous source discovery — Brain agent identifies coverage gaps and suggests new sources to fill them

### 4.2 — Multi-Modal Intelligence

- [ ] Satellite imagery analysis — Integrate with Sentinel/Landsat for visual corroboration of FIRMS/maritime signals
- [ ] Social media signal layer — Twitter/X firehose for real-time event detection (complement, not replace, structured sources)
- [ ] Document intelligence — PDF/report ingestion from think tanks, government releases, corporate filings

### 4.3 — Network Effects

- [ ] Community-contributed sources — Verified source packs submitted by domain experts
- [ ] Shared watchlist marketplace — High-value watchlists created by analysts, available to subscribers
- [ ] Collaborative entity validation — Community confirms/corrects entity relationships at scale

---

## Automation & Development Infrastructure

- [x] Private repo (WorldPulse-v2) for Phase 1-4 development
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
| 120K+ signals ingested | Data density threshold for pattern detection | Week 12 | ✅ Done |
| Statistical baselines operational | Z-score anomaly detection against 30-day norms | Week 14 | 🔲 |
| Event threads tracking developing stories | Persistent narrative arcs with severity trajectories | Week 16 | 🔲 |
| Entity graph producing inferred relationships | Co-occurrence edges without LLM dependency | Week 18 | 🔲 |
| Semantic similarity live | Embedding-based correlation and dedup | Week 20 | 🔲 |
| Cross-domain pattern detected autonomously | System surfaces insight no single source reported | Week 22 | 🔲 |
| 100 daily active users | Organic growth from launch channels | Month 3 | 🔲 |
| Pro tier launches with paying subscribers | $29/month, watchlists, email digests | Month 5 | 🔲 |
| First API customer | Structured data access, webhooks | Month 8 | 🔲 |
| $1K MRR | Pro subscribers + API customers | Month 9 | 🔲 |
| $10K MRR | Enterprise API + growing Pro base | Month 12 | 🔲 |

---

*Last updated: April 27, 2026*
*Phase 1 COMPLETE. Phase 1.6 (Cerebral Cortex) is the active priority. 120,000+ signals from 178 sources. The intelligence graph is ready to mature.*
