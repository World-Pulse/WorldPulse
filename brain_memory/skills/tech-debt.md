---
name: tech-debt
description: Identify, categorize, and prioritize technical debt. Trigger with "tech debt", "technical debt audit", "what should we refactor", "code health", "what's making us slow", or when the user asks about code quality, refactoring priorities, maintenance backlog, or anything that sounds like "this is getting hard to work with". Also trigger when someone mentions something is fragile, poorly understood, or "we keep having to touch this" — these are debt signals even if they don't use the phrase "tech debt". Use this skill proactively when the conversation reveals underlying quality issues.
---

# Tech Debt Management

Identify, categorize, and prioritize technical debt in a way that helps the team actually act on it.

## How to Identify Debt

Good debt identification starts with asking the right questions — not just reading code:
- Where do bugs keep coming back?
- Which parts of the codebase do developers avoid touching?
- What slows down onboarding most?
- What breaks most often in production?
- What takes 10× longer than it should?
- What do developers apologize for in PRs?

Then look at the code itself for structural signals: duplication, high cyclomatic complexity, functions with too many arguments, magic numbers without comments, large files that do too many things, missing error handling.

If source control is connected, also check: which files change most often (churn), which files are involved in most bug fixes, which tests are frequently skipped or flaky.

## Categories

| Type | What it looks like | What it costs |
|------|--------------------|---------------|
| **Code debt** | Duplicated logic, poor naming, magic numbers, functions doing too many things | Bugs, slow features, knowledge silos |
| **Architecture debt** | Wrong data store for the access pattern, bloated service, missing abstraction layer | Scaling limits, cascading failures |
| **Test debt** | Low coverage, no integration tests, flaky tests nobody fixes, tests that only test happy paths | Regressions ship silently |
| **Dependency debt** | Outdated libraries, abandoned packages, version mismatches | Security vulnerabilities, future migration pain |
| **Documentation debt** | Missing runbooks, outdated READMEs, tribal knowledge in people's heads | Onboarding pain, slow incident recovery |
| **Infrastructure debt** | Manual deployment steps, no monitoring/alerting, no IaC, inconsistent environments | Incidents, slow recovery, drift |
| **Security debt** | Unhashed secrets in config, missing auth on endpoints, stale credentials, no audit logging | Breaches, compliance failures |

## Prioritization

Score each item on three dimensions, 1–5:

- **Impact**: How much does this slow down development or harm users today?
- **Risk**: What's the likely consequence of NOT fixing it? (security issue = 5, cosmetic = 1)
- **Effort**: How hard is the fix? (use inverted scale: 1 = months of work, 5 = an afternoon)

**Priority score** = (Impact + Risk) × Effort

This surfaces the high-value quick wins (high impact + risk, low effort) and separates them from the big bets (high impact + risk, high effort) that need explicit planning.

## Remediation Planning

Tech debt rarely gets paid down in dedicated sprints — the realistic path is integrating fixes into regular work. Frame the plan in three tiers:

**Opportunistic** (fix as you go): Small debt items in files you're already touching. No extra planning needed.

**Targeted** (allocate ~20% capacity): Medium items that need focused effort but don't require a feature freeze. Schedule a few per sprint.

**Strategic** (requires a project): Large architectural changes that need dedicated time, migration plans, and stakeholder buy-in. These need business justification, not just technical arguments.

## Making the Business Case

Tech debt conversations with non-technical stakeholders work best when framed as business risk, not technical purity:
- "This slows every new feature by an extra day" → cost in engineering time
- "This is the root cause of the last three incidents" → cost in reliability and trust
- "This is a known security gap" → cost in compliance and reputation
- "Nobody on the team fully understands this system" → cost in key-person risk

Avoid: "this code is messy and hard to read." That's true but it doesn't help make the decision.

## Output Format

```markdown
## Tech Debt Audit: [codebase / area]

### Summary
[2-3 sentences: overall health, biggest risk areas]

### Findings

| Item | Type | Impact | Risk | Effort | Score | Tier |
|------|------|--------|------|--------|-------|------|
| [description] | Code | 4 | 3 | 4 | 28 | Targeted |

### Top 3 Quick Wins
[High score, low effort — do these first]

### Top 3 Strategic Items
[High score, high effort — need planning and buy-in]

### Remediation Plan
**This sprint (opportunistic)**: [list]
**Next 4 sprints (targeted)**: [list]
**Q-level project (strategic)**: [list]

### How to Frame This for Stakeholders
[1-2 sentences per strategic item in business terms]
```
