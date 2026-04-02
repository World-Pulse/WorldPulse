/**
 * WorldPulse GraphQL Schema
 *
 * Real-time subscriptions via WebSocket:
 *   Endpoint: ws://api.world-pulse.io/graphql
 *
 *   Example subscription:
 *     subscription {
 *       signalCreated { id title category severity }
 *     }
 *
 *   Connect with graphql-ws or any GraphQL-over-WS client.
 *   The server uses mercurius's built-in in-memory pubsub emitter.
 *   Topics: SIGNAL_CREATED, SIGNAL_UPDATED
 */
export const typeDefs = /* GraphQL */ `
  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
  }

  type Signal {
    id: ID!
    title: String!
    description: String
    category: String!
    severity: String!
    lat: Float
    lng: Float
    source: String
    sourceUrl: String
    reliabilityScore: Float
    createdAt: String!
  }

  type SignalConnection {
    nodes: [Signal!]!
    totalCount: Int!
    pageInfo: PageInfo!
  }

  type User {
    id: ID!
    username: String!
    displayName: String
    avatarUrl: String
    reliabilityScore: Float
  }

  type EventCluster {
    id: ID!
    primarySignalId: ID!
    correlationType: String!
    correlationScore: Float!
    categories: [String!]!
    sourceCount: Int!
    signalCount: Int!
    severity: String!
    signals: [Signal!]!
    createdAt: String!
  }

  type BriefingDevelopment {
    headline: String!
    detail: String!
    severity: String!
    category: String!
    signalCount: Int!
  }

  type CategoryBreakdown {
    category: String!
    count: Int!
    criticalCount: Int!
    highCount: Int!
  }

  type GeographicHotspot {
    countryCode: String!
    locationName: String
    signalCount: Int!
    avgSeverityScore: Float!
  }

  type DailyBriefing {
    id: ID!
    date: String!
    generatedAt: String!
    model: String!
    periodHours: Int!
    totalSignals: Int!
    totalClusters: Int!
    executiveSummary: String!
    keyDevelopments: [BriefingDevelopment!]!
    categoryBreakdown: [CategoryBreakdown!]!
    geographicHotspots: [GeographicHotspot!]!
    threatAssessment: String!
    outlook: String!
    topSignals: [Signal!]!
  }

  type Query {
    signal(id: ID!): Signal
    signals(
      category: String
      severity: String
      limit: Int
      offset: Int
      since: String
    ): SignalConnection!
    search(q: String!, limit: Int): [Signal!]!
    trending: [Signal!]!
    correlatedSignals(signalId: ID!): EventCluster
    recentClusters(limit: Int): [EventCluster!]!
    dailyBriefing(hours: Int): DailyBriefing!
  }

  type Subscription {
    signalCreated: Signal!
    signalUpdated: Signal!
  }
`
