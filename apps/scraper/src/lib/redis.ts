// Scraper Redis client
import Redis from 'ioredis'
export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  retryStrategy: (t) => Math.min(t * 200, 3000),
})
redis.on('error', (e: Error) => console.error('Redis:', e.message))
