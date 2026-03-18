import Knex from 'knex'

export const db = Knex({
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: true }
      : false,
  },
  pool: {
    min: 2,
    max: 20,
    acquireTimeoutMillis: 30_000,
    createTimeoutMillis:  30_000,
    idleTimeoutMillis:    30_000,
  },
  acquireConnectionTimeout: 30_000,
})

// Test connection on startup
db.raw('SELECT 1')
  .then(() => console.log('✅ PostgreSQL connected'))
  .catch(err => {
    console.error('❌ PostgreSQL connection failed:', err.message)
    process.exit(1)
  })
