import Knex from 'knex'
export const db = Knex({
  client: 'pg',
  connection: { connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false },
  pool: { min: 2, max: 10 },
})
