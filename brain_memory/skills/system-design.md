---
name: system-design
description: Design systems, services, and architectures. Trigger with "design a system for", "how should we architect", "system design for", "what's the right architecture for", or when the user needs help with API design, data modeling, service boundaries, or technical planning. Also trigger when someone describes a feature or product need and is trying to figure out how to build it — "how would I implement X", "where should this live", "should this be its own service", "what database should I use for Y". Use this skill whenever the conversation is about *how to build* something, not just *what to build*.
---

# System Design

Help design systems and evaluate architectural decisions with a focus on clarity, trade-offs, and practical execution.

## Process

### 1. Clarify Requirements

Before sketching anything, nail down the requirements. Ask if they're unclear:

**Functional**: What does it do? What are the core user interactions?

**Non-functional**: The numbers that shape everything else:
- Scale: requests/second, data volume, number of users
- Latency: what's the SLA? (p50, p95, p99)
- Availability: 99.9% vs 99.99% is a huge architectural difference
- Consistency: is stale data acceptable? For how long?
- Cost: is this a startup on a budget or a team with headroom?

**Constraints**: What's already decided? (team size, existing stack, timeline, must-use services)

### 2. High-Level Design

Start with a component diagram. Name the boxes and the arrows — what calls what, over what protocol. Then answer:
- Where does data enter the system?
- Where is it stored, and in what form?
- Where is it read back, and by whom?
- What are the failure modes if each component goes down?

ASCII diagrams are fine. Don't over-engineer the diagram — the goal is shared understanding.

### 3. Data Model

The data model is often where good designs live or die. For each entity:
- What are the primary access patterns? (Read by X, filter by Y, sort by Z)
- What's the write frequency vs read frequency?
- What relationships exist and do they need referential integrity?
- What needs to be indexed?

Storage choice follows from access patterns, not the other way around:
- **Relational (PostgreSQL)**: structured data, complex queries, transactions, strong consistency
- **Document (MongoDB)**: flexible schema, hierarchical data, no joins needed
- **Key-value (Redis)**: caching, session state, rate limiting counters, pub/sub
- **Column-store (Cassandra)**: write-heavy, time-series, high throughput at scale
- **Search (Elasticsearch)**: full-text search, faceting, log analysis
- **Graph (Neo4j)**: complex relationship traversal — friend-of-friend, recommendation

### 4. API Design

For REST APIs:
- Resources are nouns, actions are HTTP verbs
- Consistent naming: `GET /signals`, `POST /signals`, `GET /signals/:id`
- Pagination on all list endpoints (cursor-based > offset for large datasets)
- Version the API from day one (`/api/v1/`)
- Error responses: consistent format with a `code`, `message`, and optional `details`

For real-time:
- WebSockets: full-duplex, good for chat, live dashboards
- SSE: server-push only, simpler, works over HTTP/2, good for live feeds
- Polling: simplest, highest latency — only use when push isn't practical

### 5. Caching Strategy

Cache invalidation is hard. Be explicit about:
- **What to cache**: expensive queries, rarely-changing data, hot-path responses
- **Where**: in-process (fastest, not shared), Redis (shared, survives deploys), CDN (static assets, edge)
- **TTL**: how stale is acceptable?
- **Invalidation**: time-based TTL vs event-driven purge vs version keys

### 6. Scale and Reliability

- **Horizontal scaling**: stateless services scale easily; stateful services need sticky sessions or external state
- **Queue/async work**: anything that doesn't need to happen synchronously in the request path should be offloaded — email, webhooks, heavy computation
- **Circuit breakers**: protect against downstream failures cascading upstream
- **Idempotency**: design mutations to be safely retried (especially webhooks, payment operations)
- **Monitoring**: what are the golden signals? (latency, traffic, errors, saturation)

## Trade-off Analysis

Every significant design decision has a trade-off. Make them explicit rather than implicit. Use this pattern:

> **Decision**: [What you chose]
> **Why**: [The constraint or requirement that drove this]
> **Trade-off**: [What you gave up]
> **Revisit when**: [The scale or condition that would change the answer]

Example:
> **Decision**: Single PostgreSQL instance, no read replicas
> **Why**: Current load is ~50 req/s, well within single-instance capacity. Simpler to operate.
> **Trade-off**: Read queries and write queries share the same I/O budget
> **Revisit when**: p95 read latency exceeds 50ms or write WAL replay starts lagging

## Output Format

```markdown
## System Design: [Feature/System Name]

### Requirements
**Functional**: [what it does]
**Scale**: [key numbers]
**Constraints**: [what's fixed]

### Architecture
[ASCII component diagram]

### Data Model
[Key entities, storage choice, access patterns]

### API
[Key endpoints or event flows]

### Trade-offs
| Decision | Why | What we give up | Revisit when |
|----------|-----|-----------------|--------------|

### What I'd Build First
[The simplest version that works — what gets cut for v1]

### What I'd Revisit at 10× Scale
[The decisions that change when the system grows]
```

Always end with "What I'd Build First" and "What I'd Revisit" — these ground the design in reality. A design that tries to solve every problem upfront is usually wrong.
