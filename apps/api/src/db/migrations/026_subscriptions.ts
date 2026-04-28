import { db } from '../postgres'

export async function up(): Promise<void> {
  // Add subscription_plan to users table if not present
  const hasSubPlan = await db.schema.hasColumn('users', 'subscription_plan')
  if (!hasSubPlan) {
    await db.schema.table('users', (t) => {
      t.text('subscription_plan').notNullable().defaultTo('free')
    })
  }

  const hasTable = await db.schema.hasTable('subscriptions')
  if (!hasTable) {
    await db.schema.createTable('subscriptions', (t) => {
      t.uuid('id').primary().defaultTo(db.raw('gen_random_uuid()'))
      t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      t.text('stripe_customer_id').notNullable()
      t.text('stripe_subscription_id').unique().nullable()
      t.text('stripe_price_id').nullable()
      t.text('plan').notNullable().defaultTo('free')
        .checkIn(['free', 'pro'])
      t.text('status').notNullable().defaultTo('active')
        .checkIn(['active', 'canceled', 'past_due', 'trialing'])
      t.timestamp('current_period_start', { useTz: true }).nullable()
      t.timestamp('current_period_end', { useTz: true }).nullable()
      t.boolean('cancel_at_period_end').defaultTo(false)
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    })

    await db.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_idx
        ON subscriptions(user_id);
      CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_idx
        ON subscriptions(stripe_customer_id);
    `)
  }
}

export async function down(): Promise<void> {
  await db.schema.dropTableIfExists('subscriptions')
  const hasSubPlan = await db.schema.hasColumn('users', 'subscription_plan')
  if (hasSubPlan) {
    await db.schema.table('users', (t) => {
      t.dropColumn('subscription_plan')
    })
  }
}
