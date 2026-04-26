import Knex from 'knex'
import { Pool } from 'pg'

export const db = Knex({
  client: 'pg',
  connection: { connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false },
  pool: { min: 2, max: 10 },
})

// Raw pg Pool for modules that use db.query() directly (e.g. entity-graph.ts)
export const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 5,
})
