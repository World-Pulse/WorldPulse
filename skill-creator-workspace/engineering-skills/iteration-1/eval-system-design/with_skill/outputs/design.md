## System Design: WorldPulse Semantic Search

### Requirements

**Functional**
- Users type natural language queries (e.g., "earthquake in New Zealand")
- System returns relevant signals even without exact keyword matches
- Query should complete in <500ms for a responsive experience
- Results should be ranked by relevance
- No changes to signal ingestion pipeline required

**Scale**
- Current: 2,000 signals
- Projected: 100,000+ signals
- Queries per day: 100-1000 (startup phase, likely to grow)
- Signal creation: ~5-50 per day (estimates from domain)
- Vector dimension: typical embeddings are 384-1536 (depends on model choice)

**Non-Functional**
- Latency SLA: p95 < 500ms for search queries
- Availability: 99.5% (startup tolerates brief downtime)
- Consistency: read-heavy, eventual consistency acceptable for search index
- Cost: zero budget for infrastructure beyond free tiers; Pinecone free tier only

**Constraints**
- Existing stack: PostgreSQL, Redis, Node.js/Fastify
- Budget: free tier only — Pinecone free tier max 1M vectors (plenty for 100k signals)
- Team: small (assumed 1-2 engineers)
- Timeline: v1 should launch quickly; can iterate after
- No GPU cluster available for fine-tuning embeddings

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Client (Web/Mobile)                                         │
│  [Search Query] ──────────────────────────────────────────► │
└────────────┬──────────────────────────────────────────────┬─┘
             │                                              │
             │                                              │
        ┌────▼─────────────────────────────┐                │
        │  Fastify API Server              │                │
        │  ├─ POST /api/v1/signals/search  │                │
        │  ├─ GET /api/v1/signals/:id      │                │
        │  └─ Embed query → search Pinecone│                │
        └────┬──────────────┬──────────────┘                │
             │              │                               │
             │              │                               │
   ┌─────────▼──────┐ ┌────▼──────────┐      ┌──────────────▼─┐
   │  PostgreSQL    │ │  Redis        │      │  Pinecone      │
   │  ├─ Signals    │ │  (Cache)      │      │  (Vector Index)│
   │  ├─ Metadata   │ │  ├─ Query TTL │      │  ├─ Embeddings │
   │  └─ Full text  │ │  └─ Hot queries      │  └─ Metadata   │
   └────────────────┘ └───────────────┘      └────────────────┘
             ▲                                        ▲
             └────────────────┬─────────────────────┘
                    Signal Ingestion Pipeline
                    (async embedding job)
```

**Data Flow**
1. **Ingestion**: Signal created → PostgreSQL stores → async job picks it up → embedding generated → indexed in Pinecone
2. **Search**: Query received → embedded via API → search Pinecone → fetch signal metadata from PostgreSQL → hydrate results → return to client
3. **Caching**: Frequently searched queries cached in Redis; raw results cached by query_hash; TTL 1 hour

### Data Model

**Signals Table (PostgreSQL)**
```sql
CREATE TABLE signals (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  body TEXT,                    -- Full signal content
  event_type VARCHAR(50),       -- earthquake, flood, market_move, policy_change, etc.
  location GEOGRAPHY,           -- Geographic point/polygon if applicable
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  embedding_status VARCHAR(20), -- pending, completed, failed
  pinecone_vector_id TEXT       -- Link to Pinecone namespace
);

CREATE INDEX idx_signals_created_at ON signals(created_at DESC);
CREATE INDEX idx_signals_event_type ON signals(event_type);
CREATE INDEX idx_signals_location ON signals USING GIST(location);
CREATE INDEX idx_signals_embedding_status ON signals(embedding_status);

-- Hybrid search: full-text index for fallback
CREATE INDEX idx_signals_full_text ON signals
  USING GIN(to_tsvector('english', title || ' ' || description));
```

**Pinecone Vector Index**
- Index name: `worldpulse-signals`
- Dimension: 384 (using sentence-transformers/all-MiniLM-L6-v2; trade-off: speed vs. quality)
- Metric: cosine similarity (standard for text embeddings)
- Metadata stored per vector:
  ```json
  {
    "signal_id": "uuid",
    "title": "...",
    "event_type": "earthquake",
    "location": "New Zealand",
    "created_at": "2026-03-28T10:30:00Z"
  }
  ```

**Access Patterns**
- **Read**: Search by semantic similarity (query → embedding → vector search)
- **Read**: Fetch full signal by ID (signal_id from Pinecone → PostgreSQL)
- **Write**: New signal ingestion (async, low priority)
- **Index update**: Delete old vectors when signal is removed (rare)

### API Design

**Search Endpoint**
```
POST /api/v1/signals/search
Content-Type: application/json

{
  "query": "earthquake in New Zealand",
  "limit": 10,
  "offset": 0,
  "filters": {
    "event_type": "earthquake",
    "after": "2026-03-20T00:00:00Z"
  }
}

Response (200 OK):
{
  "results": [
    {
      "id": "sig-123",
      "title": "M6.2 Earthquake Near Christchurch",
      "description": "...",
      "event_type": "earthquake",
      "location": "Christchurch, New Zealand",
      "created_at": "2026-03-28T09:15:00Z",
      "relevance_score": 0.92
    }
  ],
  "total": 45,
  "query_time_ms": 125
}
```

**Get Signal Endpoint**
```
GET /api/v1/signals/:id

Response (200 OK):
{
  "id": "sig-123",
  "title": "...",
  "description": "...",
  "body": "...",
  "event_type": "earthquake",
  "location": {...},
  "created_at": "2026-03-28T09:15:00Z"
}
```

**Error Responses**
```json
{
  "code": "SEARCH_ERROR",
  "message": "Failed to complete search",
  "details": {
    "reason": "embedding_service_down"
  }
}
```

### Embedding Strategy

**Model Choice: sentence-transformers/all-MiniLM-L6-v2**
- Dimension: 384 (small, fast, free to host)
- Speed: <10ms per query on CPU
- Quality: MTEB score 0.56 (good for semantic similarity, not perfect)
- Deployment: Run locally in Node.js via `@xenova/transformers` (no external service needed)
- Alternative if quality issues: Switch to OpenAI's text-embedding-3-small (costs money, better quality)

**Embedding Pipeline (Node.js Worker)**
```typescript
// Pseudo-code
async function embedSignal(signalId: string) {
  const signal = await db.getSignal(signalId);
  const text = `${signal.title} ${signal.description}`;

  const embedding = await embedder.embed(text);

  await pinecone.upsert([{
    id: signal.pinecone_vector_id || generateId(),
    values: embedding,
    metadata: {
      signal_id: signalId,
      title: signal.title,
      event_type: signal.event_type,
      location: signal.location,
      created_at: signal.created_at.toISOString()
    }
  }]);

  await db.updateSignal(signalId, { embedding_status: 'completed' });
}
```

### Caching Strategy

**Query Result Caching (Redis)**
- Key: `search:${hash(query + filters)}`
- Value: JSON array of signal IDs + relevance scores
- TTL: 1 hour (acceptable staleness for startup)
- Invalidation: Manual purge when signal is deleted or manually refreshed

**Hot Query Tracking**
- Track query frequency in memory or Redis counter
- Automatically cache top 100 queries for 24 hours

### Trade-offs

| Decision | Why | What we give up | Revisit when |
|----------|-----|-----------------|--------------|
| **Use Pinecone free tier** | Zero cost, no self-hosted infrastructure needed, managed SLA. | Vendor lock-in, can't fine-tune embedding model, API limits (1M vectors, 125K requests/month free tier). | Hitting rate limits (100k+ signals, >10k monthly searches) or needing custom embeddings. |
| **Host embeddings locally (no API)** | Eliminates latency of calling embedding service, no cost, simple. | Embedding latency on CPU (~5-10ms), limited to CPU capacity, must optimize model size. | CPU becomes bottleneck (>100 QPS) or embedding quality becomes critical. |
| **Store full signal in PostgreSQL, metadata in Pinecone** | PostgreSQL handles complex queries and full-text fallback; Pinecone is stateless. | Dual write complexity, eventual consistency between stores, risk of inconsistency. | Need sub-100ms query latency (move signal to Pinecone metadata fully). |
| **No read replicas** | Simplifies ops, PostgreSQL can handle startup read load. | Read queries compete with writes for I/O. | Read latency exceeds 50ms OR write rate exceeds 100/sec. |
| **Dimension 384 (sentence-transformers)** | Fast inference, small memory, free hosting, good enough for startup. | Lower semantic quality vs. larger models (768, 1536 dim). | Quality drops or recall requirements tighten, switch to OpenAI embedding 3-small. |
| **Redis for session/query cache only** | Lightweight, fast, existing infrastructure. | Need persistent cache across restarts (acceptable for query cache). | Cache misses become expensive; upgrade to persistent cache or in-process. |
| **Async embedding job (not real-time)** | Decouples ingest from embedding, prevents slow writes, supports batching. | Search may not find new signals for minutes/hours after creation (acceptable for startup). | Real-time search required; move to synchronous embedding on signal creation. |

### What I'd Build First (v1)

**Minimum Viable Semantic Search**
1. Set up Pinecone free tier account, create index
2. Implement embedding function locally (sentence-transformers via `@xenova/transformers`)
3. Create `/api/v1/signals/search` endpoint:
   - Accept query string
   - Embed query locally (3-10ms)
   - Search Pinecone top-10 hits (50-200ms)
   - Fetch signal metadata from PostgreSQL by IDs (10-50ms)
   - Return ranked results
4. Add async embedding worker:
   - Cron job every 5 minutes polls for pending signals
   - Batch embed (10 at a time)
   - Upsert to Pinecone
5. Manual fallback: if Pinecone is down, fall back to PostgreSQL full-text search (slower but works)
6. Cache search results in Redis with 1-hour TTL

**What to cut or defer**:
- Metadata filters (event_type, date range) — hardcode to "all" for v1
- Geographic filtering — defer until user demand
- Custom embedding model fine-tuning
- Real-time embedding (sync on signal creation)
- Analytics on search quality
- Personalization / ranking by user preference

**v1 timeline**: 5-7 days with 1 engineer
- Day 1-2: Set up Pinecone, write embedding wrapper
- Day 3-4: Implement `/search` endpoint, test with 2k signals
- Day 5: Async embedding job, fallback logic
- Day 6-7: Testing, monitoring, edge cases, deploy

### What I'd Revisit at 10× Scale (200k+ signals, 1000+ QPS)

**Embedding Model**
- Current: sentence-transformers (384 dim, CPU bound)
- At scale: Switch to OpenAI `text-embedding-3-small` (1536 dim, better quality) OR host a small embedding cluster
- Rationale: CPU bottleneck at 100+ QPS; embedding latency becomes critical path

**Vector Index**
- Current: Pinecone free tier (1M vector max, 125K requests/month limit)
- At scale: Either upgrade Pinecone Pro tier ($15/month per pod) OR self-host with Weaviate/Milvus
- Rationale: Pinecone free has monthly request limits; at 1000 QPS you'd hit it in hours

**Caching**
- Current: Redis with 1-hour TTL
- At scale: Multi-tier cache — in-process LRU for top 10k queries + Redis for longer tail
- Rationale: Avoid Redis latency on hot queries

**Async Embedding**
- Current: Cron job every 5 min, batch 10
- At scale: Message queue (Redis pub/sub or Bull) with workers, batch 100-500
- Rationale: Ensure embedding backlog doesn't exceed SLA (want <5 min latency for new signals)

**Fallback and Resilience**
- Current: Full-text search fallback only
- At scale: Add caching layer in front of Pinecone, circuit breaker for vector search, hybrid scoring (BM25 + semantic)
- Rationale: Pinecone availability impact is high; need graceful degradation

**Metadata Enrichment**
- Current: Store in Pinecone metadata only
- At scale: Index signals with metadata in PostgreSQL and Pinecone separately; allow filters without vector search
- Rationale: Enable fast metadata-only filtering (e.g., "all earthquakes in last 7 days") without vector search cost

**Observability**
- Current: None
- At scale: Track embedding latency, vector search latency, hit rate, query quality (if possible)
- Rationale: Identify bottleneck as system grows

---

## Implementation Notes

### Embedding Cost
- Local embeddings: free (CPU only)
- Pinecone free tier: 1M vectors, 125K API calls/month (roughly 4k queries/day)
- At 100 signals/month ingest + 100 queries/day search: well within free tier for 1+ years

### Operational Risk
- **Pinecone downtime**: Fall back to PostgreSQL full-text search (slower, ~500ms)
- **Embedding service failure**: Queue signals as "embedding_failed", retry asynchronously
- **Stale embeddings**: Acceptable; older signals will still surface but with lower relevance

### Testing Strategy
1. Unit tests: embedding function, API endpoints
2. Integration tests: Pinecone upsertion, fallback logic
3. Load test: 50 concurrent searches with 2k signals
4. Regression test: Ensure specific queries (e.g., "earthquake New Zealand") return expected signals

### Security
- No authentication on `/search` yet (startup phase); add API key before public launch
- Rate limiting: 10 req/sec per IP (Redis counter) to avoid abuse
- Input validation: Query length max 500 chars, sanitize for embedding model

### Monitoring
- Track p50/p95/p99 latency for `/search` endpoint
- Monitor Pinecone API errors and fallback rate
- Alert on embedding backlog size > 100 signals
- Log slow queries (>500ms)
