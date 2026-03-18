import Redis from 'ioredis'

const url = process.env.REDIS_URL ?? 'redis://localhost:6379'

export const redis = new Redis(url, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 100, 3000),
  enableReadyCheck: true,
  lazyConnect: false,
})

redis.on('connect',    () => console.log('✅ Redis connected'))
redis.on('error',      (err: Error) => console.error('Redis error:', err.message))
redis.on('reconnecting', () => console.warn('Redis reconnecting...'))
