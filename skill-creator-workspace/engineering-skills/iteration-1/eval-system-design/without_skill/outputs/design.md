# WorldPulse Semantic Search System Design

**Date:** 2026-03-28
**Status:** Design Phase
**Scope:** Semantic search feature for 2K-100K signals using Pinecone free tier

---

## 1. Executive Summary

WorldPulse will implement semantic search to allow users to query signals with natural language. Rather than exact keyword matching, the system will embed signals and queries into vector space, enabling discovery of semantically similar content even when exact words differ.

**Key constraints:**
- Tight budget → use Pinecone free tier (512 MB, 2 project limit)
- PostgreSQL + Redis already in place
- Node.js/Fastify backend
- Growth from 2K to 100K signals

**High-level approach:**
1. Embed signals at ingestion time using a lightweight model
2. Store embeddings in Pinecone + raw metadata in PostgreSQL
3. Cache query embeddings in Redis for repeated searches
4. Implement multi-stage ranking: vector similarity → PostgreSQL reranking → final results

---

## 2. Architecture Overview

```
┌─────────────────┐
│   User Query    │  Natural language input
└────────┬────────┘
         │
         v
    ┌────────────────────────────────────────┐
    │   Query Embedding Pipeline             │
    │  - Check Redis cache (5-min TTL)        │
    │  - If miss: generate embedding         │
    │  - Cache in Redis                      │
    └────────┬─────────────────────────────────┘
             │
             v
    ┌────────────────────────────────────────┐
    │   Pinecone Vector Search               │
    │  - Top-K semantic matches (50-100)    │
    │  - Return IDs + scores                │
    └────────┬─────────────────────────────────┘
             │
             v
    ┌────────────────────────────────────────┐
    │   PostgreSQL Reranking (Optional)      │
    │  - Fetch full metadata for top-K       │
    │  - Apply business logic filters        │
    │  - Re-rank by relevance + metadata     │
    └────────┬─────────────────────────────────┘
             │
             v
    ┌────────────────────────────────────────┐
    │   Final Results (10-20 signals)        │
    │  - Paginated response                  │
    │  - Include confidence scores           │
    └────────────────────────────────────────┘
```

---

## 3. Data Models & Storage

### 3.1 PostgreSQL Schema (Existing + Extensions)

**signals table** (extended):
```sql
CREATE TABLE signals (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  content TEXT,
  source VARCHAR(255),
  signal_type VARCHAR(50),        -- e.g., 'earthquake', 'economic', 'conflict'
  confidence_score FLOAT,          -- 0-1
  detected_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  embedding_id VARCHAR(255),       -- Pinecone vector ID (for cleanup)
  metadata JSONB,                  -- tags, regions, entities, etc.

  -- Indexes for search performance
  INDEX idx_signal_type (signal_type),
  INDEX idx_detected_at (detected_at DESC),
  FULLTEXT INDEX idx_content_search (title, description, content)
);
```

**signals_embeddings_log table** (audit trail):
```sql
CREATE TABLE signals_embeddings_log (
  id SERIAL PRIMARY KEY,
  signal_id INT NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  pinecone_id VARCHAR(255),
  embedding_model VARCHAR(50),     -- e.g., 'sentence-transformers/all-MiniLM-L6-v2'
  created_at TIMESTAMP DEFAULT NOW(),
  status VARCHAR(20)               -- 'success', 'failed', 'pending'
);
```

### 3.2 Pinecone Schema

**Index Name:** `worldpulse-signals` (single index to fit free tier)

**Vector Dimension:** 384 (using all-MiniLM-L6-v2 model)

**Metadata per vector:**
```json
{
  "signal_id": 42,
  "title": "Earthquake in New Zealand",
  "type": "natural_disaster",
  "confidence": 0.92,
  "detected_at": "2026-03-27T14:30:00Z",
  "region": "Oceania"
}
```

**Index Configuration:**
```json
{
  "dimension": 384,
  "metric": "cosine",
  "spec": {
    "serverless": {
      "cloud": "aws",
      "region": "us-west-2"
    }
  },
  "tags": ["worldpulse", "signals"]
}
```

### 3.3 Redis Schema

**Key pattern:** `search:embedding:{query_hash}`

```
Key: search:embedding:abc123def456
Value: [0.12, 0.45, ..., 0.78]  (384-dim float array)
TTL: 300 seconds (5 minutes)

Key: search:results:{query_hash}
Value: JSON of ranked results
TTL: 60 seconds (1 minute)
```

---

## 4. Component Design

### 4.1 Signal Ingestion Pipeline

**Flow:**
1. New signal received (via API, webhook, or admin panel)
2. Validate and store in PostgreSQL
3. Generate embedding asynchronously
4. Upsert into Pinecone
5. Log status to `signals_embeddings_log`

**Pseudocode (Node.js):**

```javascript
async function ingestSignal(signal) {
  // 1. Store in PostgreSQL
  const stored = await db.signals.create({
    title: signal.title,
    description: signal.description,
    content: signal.content,
    source: signal.source,
    signal_type: signal.type,
    confidence_score: signal.confidence,
    detected_at: signal.detected_at,
    metadata: signal.metadata
  });

  // 2. Generate embedding (async, don't block)
  queueEmbeddingJob({
    signal_id: stored.id,
    text: `${signal.title}\n${signal.description}\n${signal.content}`
  });

  return stored;
}

async function processEmbeddingJob(job) {
  try {
    // Embed using lightweight model
    const embedding = await embedder.embed(job.text);

    // Upsert to Pinecone
    await pinecone.upsert({
      vectors: [{
        id: `signal_${job.signal_id}`,
        values: embedding,
        metadata: {
          signal_id: job.signal_id,
          title: job.title,
          type: job.type,
          confidence: job.confidence,
          detected_at: job.detected_at
        }
      }]
    });

    // Log success
    await db.signals_embeddings_log.create({
      signal_id: job.signal_id,
      pinecone_id: `signal_${job.signal_id}`,
      embedding_model: 'sentence-transformers/all-MiniLM-L6-v2',
      status: 'success'
    });
  } catch (error) {
    await db.signals_embeddings_log.create({
      signal_id: job.signal_id,
      status: 'failed',
      error_message: error.message
    });
    logger.error(`Embedding failed for signal ${job.signal_id}`, error);
  }
}
```

### 4.2 Query Pipeline

**Fastify endpoint:**

```javascript
app.post('/api/search/semantic', async (request, reply) => {
  const { query, filters = {}, limit = 10, offset = 0 } = request.body;

  // 1. Check Redis cache
  const cacheKey = `search:embedding:${hashQuery(query)}`;
  let embedding = await redis.get(cacheKey);

  if (!embedding) {
    // 2. Generate embedding
    embedding = await embedder.embed(query);
    // 3. Cache for 5 minutes
    await redis.setex(cacheKey, 300, JSON.stringify(embedding));
  } else {
    embedding = JSON.parse(embedding);
  }

  // 4. Vector search in Pinecone (get top-K)
  const pineconeResults = await pinecone.query({
    vector: embedding,
    topK: Math.min(50, limit * 5),  // Get more than needed for reranking
    includeMetadata: true,
    filter: buildPineconeFilter(filters)  // e.g., date range, type
  });

  if (pineconeResults.matches.length === 0) {
    return reply.send({
      results: [],
      total: 0,
      query: query
    });
  }

  // 5. Fetch full metadata from PostgreSQL
  const signalIds = pineconeResults.matches.map(m => m.metadata.signal_id);
  const fullSignals = await db.signals.findAll({
    where: { id: { [Op.in]: signalIds } }
  });

  // 6. Rerank: combine vector score + relevance factors
  const ranked = rerank(pineconeResults.matches, fullSignals, query);

  // 7. Apply pagination
  const paginated = ranked.slice(offset, offset + limit);

  // 8. Cache results (1 minute)
  const resultsKey = `search:results:${hashQuery(query)}`;
  await redis.setex(resultsKey, 60, JSON.stringify(paginated));

  return reply.send({
    results: paginated,
    total: ranked.length,
    query: query,
    searchTime: Date.now() - startTime
  });
});
```

### 4.3 Reranking Logic

```javascript
function rerank(vectorMatches, fullSignals, query) {
  const signalMap = Object.fromEntries(
    fullSignals.map(s => [s.id, s])
  );

  return vectorMatches
    .map(match => {
      const signal = signalMap[match.metadata.signal_id];
      if (!signal) return null;

      // Combine scores
      const vectorScore = match.score;  // 0-1 (cosine similarity)
      const confidenceScore = signal.confidence_score;
      const recencyScore = calculateRecency(signal.detected_at);
      const sourceReliability = getSourceReliability(signal.source);

      const finalScore =
        0.50 * vectorScore +          // Primary: semantic similarity
        0.20 * confidenceScore +      // Signal confidence
        0.15 * recencyScore +         // Favor recent signals
        0.15 * sourceReliability;     // Source trust

      return {
        signal_id: signal.id,
        title: signal.title,
        description: signal.description,
        type: signal.signal_type,
        source: signal.source,
        detected_at: signal.detected_at,
        confidence: signal.confidence_score,
        semantic_score: vectorScore,
        final_score: finalScore,
        metadata: signal.metadata
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.final_score - a.final_score);
}
```

---

## 5. Embedding Strategy

### 5.1 Model Selection

**Recommended:** `sentence-transformers/all-MiniLM-L6-v2`

**Rationale:**
- Output dimension: 384 (compact, within Pinecone free tier)
- Performance: Strong on semantic similarity tasks
- Size: ~27 MB (lightweight, suitable for edge deployment if needed)
- Speed: ~100-200 queries/sec on single GPU/CPU
- Open-source: No vendor lock-in

**Alternative (if better accuracy needed):**
- `sentence-transformers/all-mpnet-base-v2` (768-dim, slower, better quality)
- Only migrate if reranking insufficient

### 5.2 Embedding at Scale

**For initial 2K signals:**
- Single-threaded embedding sufficient
- Process in background jobs (~10-15 min total)

**For 100K+ signals (future):**
- Batch embedding: 100-200 signals per batch
- Use worker queue (Bull, RabbitMQ, or Fastify Bull)
- Pinecone batch upsert API (100 vectors max per request)
- Rate limiting: respect Pinecone free tier (maintain <1000 ops/min)

**Cost projection:**
- Pinecone free: 512 MB storage = ~1.3M vectors at 384-dim (rough estimate)
- 100K signals × 384-dim × 4 bytes = ~152 MB → well within limits
- Free tier sufficient for 18+ months at 2K/month signal growth rate

---

## 6. Filtering & Advanced Search

### 6.1 Pinecone Metadata Filters

Support optional filters alongside semantic search:

```javascript
const filters = {
  signal_type: 'earthquake',           // Exact match
  detected_at: { $gte: '2026-01-01' }, // Date range
  confidence: { $gte: 0.8 },           // Confidence threshold
  region: ['Asia', 'Pacific']          // Multi-value
};
```

**Pinecone query with filters:**

```javascript
await pinecone.query({
  vector: embedding,
  topK: 50,
  filter: {
    $and: [
      { 'metadata.type': { $eq: filters.signal_type } },
      { 'metadata.detected_at': { $gte: filters.detected_at } },
      { 'metadata.confidence': { $gte: filters.confidence } }
    ]
  }
});
```

### 6.2 Fallback: Keyword Search (PostgreSQL)

If vector search returns no results, fall back to full-text search:

```javascript
async function fallbackKeywordSearch(query, limit = 10) {
  return await db.sequelize.query(`
    SELECT id, title, description, source, detected_at, confidence_score
    FROM signals
    WHERE MATCH(title, description, content) AGAINST(? IN BOOLEAN MODE)
    ORDER BY detected_at DESC
    LIMIT ?
  `, {
    replacements: [query, limit],
    type: QueryTypes.SELECT
  });
}
```

---

## 7. Performance & Caching

### 7.1 Redis Caching Strategy

| Data | Key Pattern | TTL | Size (est.) |
|------|-------------|-----|------------|
| Query embeddings | `search:embedding:{hash}` | 5 min | 1.5 KB |
| Search results | `search:results:{hash}` | 1 min | 10-50 KB |
| Hot signal IDs | `cache:hot_signals` | 1 hour | 10 KB |

**Rationale:**
- Query embeddings: Short TTL captures repeated searches within session
- Results: Very short TTL since signals update frequently
- Hot signals: Identify trending queries for pre-computation

### 7.2 Query Performance Targets

| Operation | Target | Notes |
|-----------|--------|-------|
| Embed query | < 50ms | Cached 80% of time |
| Vector search (Pinecone) | < 100ms | 50 top-K vectors |
| PostgreSQL rerank | < 50ms | 50 signals metadata fetch |
| Total user latency | < 200ms | P95, including network |

### 7.3 Latency Optimization

```javascript
// Parallel fetch + rerank (vs. sequential)
const [vectorResults, signals] = await Promise.all([
  pinecone.query({ vector: embedding, topK: 50 }),
  db.signals.findAll({ limit: 50 })  // Pre-fetch hot signals if needed
]);

// Cache reranking for identical queries
const resultsKey = hashQuery(query);
let ranked = await redis.get(resultsKey);
if (!ranked) {
  ranked = rerank(vectorResults, signals, query);
  await redis.setex(resultsKey, 60, JSON.stringify(ranked));
} else {
  ranked = JSON.parse(ranked);
}
```

---

## 8. Monitoring & Observability

### 8.1 Key Metrics

```
Vector Search Metrics:
- Queries per minute (QPM)
- Avg query latency (P50, P95, P99)
- Cache hit rate (embeddings, results)
- Pinecone index size (% of free tier limit)

Embedding Metrics:
- Signals embedded per day
- Embedding failure rate
- Queue depth (pending embeddings)
- Avg embedding generation time

Business Metrics:
- Avg result relevance (manual tagging)
- User satisfaction (implicit: CTR on results)
- Query diversity (new unique queries/day)
```

### 8.2 Logging & Alerts

```javascript
// Structured logging for debugging
logger.info('semantic_search', {
  query: query,
  cache_hit: !!embedding,
  result_count: results.length,
  top_score: results[0]?.final_score,
  latency_ms: Date.now() - startTime,
  user_id: request.user.id
});

// Alerts
- Embedding failure rate > 5% → page engineering
- Pinecone index capacity > 90% → plan migration
- Query latency P95 > 500ms → investigate bottleneck
```

---

## 9. Scaling Path

### Phase 1: MVP (2K-5K signals)
- Single Pinecone project
- Synchronous embedding on write
- Redis L1 cache (embeddings only)
- Manual quality checks

### Phase 2: Growth (5K-20K signals)
- Async embedding queue (worker process)
- Expand Redis caching (results + frequent queries)
- A/B test reranking weights
- Collect relevance feedback from users

### Phase 3: Scale (20K-100K signals)
- Multi-tenant Pinecone (if needed; switch to paid tier)
- Distributed embedding workers
- Redis cluster for high availability
- ML model fine-tuning on feedback data

### Phase 4: Enterprise (100K+ signals)
- Evaluate vector database alternatives (Weaviate, Milvus)
- Custom embedding model trained on WorldPulse signals
- Real-time index updates + HNSW indexing
- Advanced filtering (time decay, popularity, source graph)

---

## 10. Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| Pinecone free tier limit reached | Medium | High | Monitor index growth; migrate to paid tier (< $100/mo) |
| Poor result quality | Medium | High | Implement reranking; collect user feedback; fine-tune model |
| Embedding generation bottleneck | Low | Medium | Queue-based async processing; batch embeddings |
| Cache stampede (many queries → Pinecone simultaneously) | Low | Medium | Probabilistic early expiration; local compute cache |
| Relevance feedback loop (GIGO) | Medium | Medium | Manual validation; diversity in training data |

---

## 11. API Contract

### 11.1 POST /api/search/semantic

**Request:**
```json
{
  "query": "earthquake in New Zealand",
  "filters": {
    "signal_type": "natural_disaster",
    "confidence_min": 0.7,
    "detected_after": "2026-01-01"
  },
  "limit": 10,
  "offset": 0
}
```

**Response:**
```json
{
  "query": "earthquake in New Zealand",
  "total": 23,
  "results": [
    {
      "signal_id": 42,
      "title": "Magnitude 5.2 Earthquake Strikes Southland Region",
      "description": "A moderate earthquake hit...",
      "type": "natural_disaster",
      "source": "USGS",
      "detected_at": "2026-03-27T14:30:00Z",
      "confidence": 0.92,
      "semantic_score": 0.89,
      "final_score": 0.84,
      "metadata": {
        "magnitude": 5.2,
        "depth_km": 12,
        "region": "Southland"
      }
    }
    // ... 9 more results
  ],
  "search_time_ms": 142
}
```

### 11.2 POST /api/signals/{id}/embeddings/refresh

Force re-embedding of a signal (admin endpoint):

```json
{
  "signal_id": 42
}
```

---

## 12. Implementation Checklist

- [ ] Set up Pinecone project + API credentials
- [ ] Choose embedding model (recommend: all-MiniLM-L6-v2)
- [ ] Add `embedding_id`, `embedding_model` columns to `signals` table
- [ ] Create `signals_embeddings_log` audit table
- [ ] Implement `ingestSignal()` + `processEmbeddingJob()`
- [ ] Implement query embedding pipeline + Redis caching
- [ ] Implement Pinecone vector search + PostgreSQL fetch
- [ ] Implement reranking logic with score combination
- [ ] Add filtering support (metadata + PostgreSQL)
- [ ] Fallback keyword search (PostgreSQL full-text)
- [ ] Write unit tests for embedding, search, reranking
- [ ] Load testing (simulate 100K signals, 100 concurrent queries)
- [ ] Set up monitoring + alerts
- [ ] Document API contract for frontend
- [ ] User acceptance testing (relevance feedback)

---

## 13. Cost Analysis

**Initial Setup (once):**
- Embedding model: $0 (open-source, self-hosted on existing infra)
- Pinecone setup: $0 (free tier)

**Monthly Operating Cost (at full scale ~100K signals):**
- Pinecone free tier: $0 (until migration needed)
- Compute (embedding workers): $0-50 (existing K8s capacity)
- Redis (caching): $0-20 (existing Redis infra)
- Database (PostgreSQL): ~$0-10 (additional storage)

**When to upgrade Pinecone (projected ~Q4 2026):**
- Free tier limit: 512 MB → ~180K vectors at 384-dim
- Paid Starter: $15/mo (2 GB, 2M vectors)
- Savings by free tier: ~$18-180 (depending on exact timeline)

---

## 14. Appendix: Code Snippets

### Embedding Utility (Node.js)

```javascript
const { pipeline } = require('@xenova/transformers');

let embedding_cache = null;

async function getEmbedder() {
  if (!embedding_cache) {
    embedding_cache = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    );
  }
  return embedding_cache;
}

async function embed(text) {
  const embedder = await getEmbedder();
  const output = await embedder(text, {
    pooling: 'mean',
    normalize: true
  });
  return Array.from(output.data);  // Convert tensor to array
}

module.exports = { embed, getEmbedder };
```

### Query Hashing

```javascript
const crypto = require('crypto');

function hashQuery(query) {
  return crypto
    .createHash('sha256')
    .update(query.toLowerCase().trim())
    .digest('hex')
    .substring(0, 16);
}
```

### Recency Score

```javascript
function calculateRecency(detectedAt) {
  const days = (Date.now() - new Date(detectedAt)) / (1000 * 60 * 60 * 24);

  if (days <= 1) return 1.0;
  if (days <= 7) return 0.8;
  if (days <= 30) return 0.6;
  if (days <= 90) return 0.4;
  return 0.2;
}
```

---

## 15. Summary

This semantic search system balances **cost constraints** (Pinecone free tier) with **performance requirements** (sub-200ms queries, 100K+ signals). By combining vector similarity, reranking, and caching, WorldPulse can deliver highly relevant results to users while remaining budget-conscious and maintaining flexibility to scale into paid infrastructure as the platform grows.

The architecture is **modular**: embedding model, vector DB, reranking weights, and filtering logic can all be independently improved without redesigning the core pipeline.
