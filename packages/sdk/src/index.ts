// ─── WorldPulse SDK ──────────────────────────────────────────────
// A small client for WorldPulse's open read routes (README.md).
//
//   import { WorldPulse } from '@worldpulse/sdk'
//   const wp = new WorldPulse()
//   const { data, total } = await wp.signals.list({ category: 'conflict' })

export {
  WorldPulse,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT,
  // the method groups (wp.signals, …), exported so their types can be named
  SignalMethods,
  CategoryMethods,
  StoryMethods,
  SearchMethods,
  CountryMethods,
} from './client'

export {
  WorldPulseError,
  ApiError,
  RateLimitError,
  NetworkError,
  TimeoutError,
} from './errors'

export type {
  WorldPulseOptions,
  Severity,
  SignalStatus,
  DataResponse,
  // GET /api/v1/public/signals
  ListSignalsParams,
  PublicSignal,
  SignalList,
  // GET /api/v1/signals/:id
  SignalDetail,
  SignalSource,
  SignalVerification,
  SignalRiskScore,
  SignalSummary,
  SourceBias,
  SignalMedia,
  // GET /api/v1/stories, /api/v1/stories/:id, /api/v1/stories/week
  TopStoriesParams,
  Story,
  StoryList,
  StoryReport,
  StoryDetail,
  Week,
  // GET /api/v1/search/semantic
  SemanticSearchParams,
  SemanticMatch,
  SemanticSearchResponse,
  // GET /api/v1/countries
  CountryWindow,
  CountryIndexParams,
  CountryRisk,
  CountryIndex,
} from './types'
