import { describe, it, expect } from 'vitest'
import { buildSchema } from 'graphql'
import { typeDefs } from '../schema'
import { resolvers } from '../resolvers'

describe('GraphQL Subscription schema', () => {
  it('Subscription type exists in typeDefs', () => {
    const schema = buildSchema(typeDefs)
    const subscriptionType = schema.getSubscriptionType()
    expect(subscriptionType).not.toBeNull()
    expect(subscriptionType?.name).toBe('Subscription')
  })

  it('signalCreated field is defined on Subscription type', () => {
    const schema = buildSchema(typeDefs)
    const subscriptionType = schema.getSubscriptionType()
    const fields = subscriptionType?.getFields() ?? {}
    expect(fields['signalCreated']).toBeDefined()
    expect(fields['signalCreated']?.type.toString()).toBe('Signal!')
  })

  it('signalUpdated field is defined on Subscription type', () => {
    const schema = buildSchema(typeDefs)
    const subscriptionType = schema.getSubscriptionType()
    const fields = subscriptionType?.getFields() ?? {}
    expect(fields['signalUpdated']).toBeDefined()
    expect(fields['signalUpdated']?.type.toString()).toBe('Signal!')
  })
})

describe('GraphQL Subscription resolvers', () => {
  it('Subscription resolver object is defined', () => {
    expect(resolvers.Subscription).toBeDefined()
  })

  it('signalCreated resolver has a subscribe function', () => {
    expect(typeof resolvers.Subscription.signalCreated.subscribe).toBe('function')
  })

  it('signalUpdated resolver has a subscribe function', () => {
    expect(typeof resolvers.Subscription.signalUpdated.subscribe).toBe('function')
  })
})
