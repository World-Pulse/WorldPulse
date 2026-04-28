# Tech Debt Audit: WorldPulse API Codebase

## Summary

The WorldPulse API codebase has accumulated significant structural and operational debt across database infrastructure, data access patterns, caching semantics, and test coverage. The most urgent risks are the unresolved dual-database state (wp_db vs wp_postgres), 5 days of unmonitored scraper error logs, and total absence of integration tests—any of which can cause silent failures or cascading incidents in production. Without addressing these, the team faces growing deployment risk, longer debugging cycles, and potential data integrity issues.

---

## Findings

| Item | Type | Impact | Risk | Effort | Score | Tier |
|------|------|--------|------|--------|-------|------|
| Dual database containers (wp_db + wp_postgres) with no canonical source | Architecture | 5 | 5 | 2 | 20 | Targeted |
| Scraper error logs not monitored (5 days running) | Infrastructure | 4 | 4 | 1 | 8 | Opportunistic |
| No integration tests; only unit tests for utility functions | Test | 5 | 4 | 3 | 27 | Targeted |
| Mixed raw SQL and Knex ORM in data layer | Code | 4 | 3 | 3 | 21 | Targeted |
| Inconsistent Redis cache key separators (colons vs hyphens) | Code | 3 | 3 | 2 | 12 | Opportunistic |
| No error handling or retry logic in scraper | Infrastructure | 4 | 4 | 2 | 16 | Targeted |
| Missing monitoring/alerting on data pipeline | Infrastructure | 3 | 4 | 2 | 14 | Opportunistic |
| No documentation of database schema or migration strategy | Documentation | 2 | 2 | 1 | 4 | Opportunistic |
| No audit logging for data mutations | Security | 2 | 4 | 2 | 12 | Opportunistic |

---

## Top 3 Quick Wins

These are high-value fixes that can be tackled in parallel with feature work without major rework:

1. **Review and log scraper error output** (Infrastructure, Score 8)
   - Set up centralized logging to stdout/stderr with rotation
   - Add structured logging (JSON format) with severity levels
   - Effort: ~2–3 hours
   - Payoff: Immediate visibility into scraper health; uncovers blocked data flows before they cascade

2. **Standardize Redis cache key format** (Code, Score 12)
   - Audit all cache key generation across the codebase
   - Establish a single separator convention (recommend colons for namespacing consistency)
   - Add a cache key builder utility function to enforce the pattern
   - Effort: ~4–6 hours
   - Payoff: Reduces cache misses from typos, simplifies debugging, prevents key collisions

3. **Add monitoring alert for scraper stuck state** (Infrastructure, Score 14)
   - Check scraper last-run timestamp; alert if >6 hours old
   - Monitor scraper process memory and CPU; alert if runaway detected
   - Effort: ~3–4 hours (depends on existing alerting framework)
   - Payoff: Catches silent failures; prevents 5-day backlogs before they happen again

---

## Top 3 Strategic Items

These require dedicated focus and architectural decisions:

1. **Resolve canonical database and establish single source of truth** (Architecture, Score 20)
   - Investigate which container (wp_db or wp_postgres) is actually being written to in production
   - Audit schema diffs between the two
   - Choose canonical store; migrate/decommission the other
   - Update CI/CD and deployment docs
   - Effort: ~2–3 sprints (schema audit + careful cutover + validation)
   - Risk if not fixed: Silent data corruption, failed deployments, cascading query failures if apps read from different stores

2. **Add comprehensive integration test suite** (Test, Score 27)
   - Design test pyramid: unit (existing) → integration (routes + DB) → end-to-end (full scraper + API)
   - Write fixtures for test database
   - Cover happy path and error cases for all data pipelines (scraper, mutations, reads)
   - Integrate into CI; fail builds if coverage drops
   - Effort: ~4–6 sprints (initial build) + ongoing maintenance
   - Payoff: Catch regressions before production; confidence in refactors; faster incident recovery

3. **Unify data access layer (raw SQL → Knex ORM)** (Code, Score 21)
   - Audit routes and identify which use raw SQL vs Knex
   - Choose ORM (Knex) as standard; migrate raw SQL incrementally
   - Add query validation and prepared statement enforcement
   - Effort: ~3–4 sprints (staggered across sprints)
   - Payoff: Reduced SQL injection surface; easier schema changes; better IDE support and query composition

---

## Remediation Plan

### This Sprint (Opportunistic)

These are fix-as-you-go items that fit into any PR touching affected files:

- [ ] Add scraper logging to structured JSON format (stdout/stderr with rotation)
- [ ] Create a cache key builder utility and document the convention (colons for namespaces)
- [ ] Document which database container is canonical and why (add to deployment runbook)
- [ ] Add stub monitoring/alerting config for scraper stuck state (or create Linear issue for ops team)

**Expected effort**: 12–14 hours total, spread across team; can be done in parallel with feature work.

---

### Next 4 Sprints (Targeted)

These items should each be scoped as one focused task per sprint:

**Sprint 1**: Establish scraper monitoring and error visibility
- [ ] Finalize logging structure and add to all scraper entry points
- [ ] Build scraper health dashboard (last-run, error count, memory usage)
- [ ] Set up alerts for: error rate spike, timeout, process restart loop
- **Effort**: 1 sprint (~40 hours)

**Sprint 2**: Standardize cache key generation
- [ ] Audit all Redis operations across codebase
- [ ] Replace inline key generation with cache key builder
- [ ] Add integration tests for cache behavior (hit/miss/invalidation)
- **Effort**: 1 sprint (~32 hours)

**Sprint 3**: Begin integration test infrastructure
- [ ] Design test database fixture and seeding strategy
- [ ] Write tests for 3–5 critical routes (highest-churn endpoints)
- [ ] Integrate test runner into CI; enforce coverage threshold (start at 30%)
- **Effort**: 1 sprint (~40 hours)

**Sprint 4**: Continue integration tests + begin SQL migration
- [ ] Write 3–5 more integration tests (data mutation routes)
- [ ] Identify top 3 raw SQL queries by churn; plan Knex rewrites
- [ ] Rewrite 1 complex raw SQL query as Knex; document pattern
- **Effort**: 1 sprint (~40 hours, shared between two workstreams)

---

### Q-Level Project (Strategic)

These require stakeholder commitment and likely need to be forked out or allocated 20–40% capacity over 2–3 quarters:

**Database Canonicalization Project** (Duration: 2–3 weeks, depending on data volume)

Outcome: One canonical, versioned, monitored database; all writes routed through it; deployments and backups fully understood.

- Week 1: Audit schema diffs, trace live traffic, identify which writes go to which store
- Week 2: Plan cutover (read from one store, validate consistency); coordinate with ops
- Week 3: Execute cutover; decommission stale container; update CI/CD; document runbook
- Blocking the team: Yes (deployment risk) — prioritize before next feature freeze

**Full Integration Test Suite** (Duration: 6–8 weeks, ongoing)

Outcome: 70%+ integration test coverage; all data pipelines (scraper, API routes, caching, mutations) validated; CI fails on regression.

- Weeks 1–2: Build test harness and database fixtures
- Weeks 3–5: Write route tests (happy path + error cases for all endpoints)
- Weeks 6–7: Write scraper tests (data parsing, error recovery, idempotency)
- Week 8: Audit coverage gaps, fix flaky tests, establish maintenance cadence
- Blocking the team: No (can run in parallel) — but unblock refactors and give developers confidence to optimize

**Data Access Layer Unification** (Duration: 8–10 weeks, ongoing)

Outcome: All data access through consistent ORM; no raw SQL; query validation enforced in middleware; easier schema changes.

- Weeks 1–2: Survey codebase, categorize raw SQL queries by complexity
- Weeks 3–5: Migrate high-impact queries (most frequently touched) to Knex
- Weeks 6–8: Migrate medium-impact queries; add query validation middleware
- Weeks 9–10: Final migration and cleanup; enforce no-raw-SQL in linting
- Blocking the team: No (can stagger per route) — but enables confident refactors and schema evolution

---

## How to Frame This for Stakeholders

**"We have two databases and we're not sure which one is the real one. This adds uncertainty to every deployment and makes incident recovery slower."**
- Business impact: Deployment risk, slower MTTR (mean time to recovery)
- Fix: Resolve which is canonical (2–3 weeks, ops + 1 engineer), then decommission the redundant one
- Why now: Before we scale traffic, we need to know our data is being written to one place consistently

**"We're not testing our data pipelines. The scraper has been running silently for 5 days, and we have no idea if it's hitting errors."**
- Business impact: Silent data corruption, incomplete intelligence feeds, no early warning system for pipeline breaks
- Fix: Add integration tests and scraper monitoring (8+ weeks to full coverage, but quick wins in first 2 weeks)
- Why now: Every day without visibility is a day of potentially stale or corrupt data flowing into the system

**"Our code mixes two different approaches to talking to the database (raw SQL and Knex ORM). This makes refactors risky and introduces SQL injection surface area."**
- Business impact: Slower development velocity (riskier to touch DB code), security risk (injection vectors)
- Fix: Migrate all raw SQL to ORM over 8–10 weeks; add query validation middleware
- Why now: As we add more data flows (new integrations, new routes), the risk compounds

---

## Next Steps

1. **Validate findings with the team** — Schedule 30 min sync to confirm the dual-database issue and scraper monitoring gaps are accurate
2. **Assign owners** — Distribute opportunistic fixes across the next 1–2 PRs; assign leads for each targeted sprint
3. **Update Linear/your tracker** — Create epics for the three strategic projects; scope as 2–3 week chunks
4. **Start with monitoring** — The scraper logging fix is the fastest payoff and unblocks debugging of other issues
