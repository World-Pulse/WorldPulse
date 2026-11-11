/**
 * The reader's topics (the reports' category as GET /api/v1/public/categories lists them, Nov 10, 2026), as the
 * story list (?category=) and the open counts (/api/v1/public/news-by-day, /topic-countries) take them: a fixed
 * list, so their kept answers stay few (each topic's is its own query)
 */
export const READER_TOPICS = [
  'breaking', 'conflict', 'geopolitics', 'politics', 'elections', 'economy', 'finance', 'security', 'military', 'technology',
  'science', 'health', 'climate', 'weather', 'disaster', 'humanitarian', 'culture', 'sports', 'space', 'aviation', 'maritime',
  'infrastructure', 'electronic_warfare', 'other',
] as const

export type ReaderTopic = typeof READER_TOPICS[number]

export const isReaderTopic = (t: string): t is ReaderTopic => (READER_TOPICS as readonly string[]).includes(t)
