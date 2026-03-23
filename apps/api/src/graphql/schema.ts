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
  }
`
