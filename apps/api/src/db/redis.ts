import Redis from 'ioredis'

const url = process.env.REDIS_URL ?? 'redis://localhost:6379'

/**
 * Redis client config.
 *
 * Gate 5 tuning (load test baseline):
 *   - enableAutoPipelining: true — automatically batches simultaneous commands
 *     into a single round-trip, reducing latency under concurrent load.
 *     No code changes needed in route handlers — ioredis handles it transparently.
 *
 *   - connectTimeout: 5_000 — surface Redis timeouts faster under high load.
 *
 *   - keepAlive: 30_000 — maintains TCP connection health for long-running processes.
 *
 *   - commandTimeout: 2_000 — prevent slow Redis commands from blocking VU threads.
 *
 * For 10K concurrent users, a Redis Cluster (3+ shards) or Redis Sentinel
 * is recommended. Single-node Redis saturates at ~100K ops/sec; with 10K VUs
 * doing 2+ Redis ops each (cache read + write), single-node is the bottleneck.
 */
export const redis = new Redis(url, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 100, 3000),
  enableReadyCheck: true,
  lazyConnect: false,
  enableAutoPipelining: true,     // Auto-batch simultaneous commands → fewer round-trips
  connectTimeout: 5_000,
  commandTimeout: 2_000,
  keepAlive: 30_000,
})

redis.on('connect',    () => console.log('✅ Redis connected'))
redis.on('error',      (err: Error) => console.error('Redis error:', err.message))
redis.on('reconnecting', () => console.warn('Redis reconnecting...'))
