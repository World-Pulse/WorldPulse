// ─── WorldPulse SDK ──────────────────────────────────────────────
// Official TypeScript client for the WorldPulse Public API
//
// Usage:
//   import { WorldPulse } from '@worldpulse/sdk'
//   const wp = new WorldPulse()
//   const { data } = await wp.signals.list({ category: 'conflict' })
//
// Real-time streaming (v1.1+):
//   const stream = wp.stream.live({ channels: ['conflict', 'breaking'] })
//   stream.on('signal', (s) => console.log(s.title))
//   await stream.connect()
//
//   for await (const s of wp.stream.poll({ category: 'conflict' })) {
//     console.log(s.title)
//   }
//

export { WorldPulse } from './client'

// Streaming
export { SignalLiveStream, StreamMethods } from './stream'

// Types
export type {
  WorldPulseConfig,
  Signal,
  SignalDetail,
  Category,
  Source,
  IntelligenceDomain,
  CountryActivity,
  ThreatAssessment,
  PlatformStats,
  PaginatedResponse,
  ListResponse,
  DataResponse,
  ListSignalsParams,
  ListSourcesParams,
  ListCountriesParams,
  ListBreakingParams,
  ApiErrorResponse,
  Severity,
  SignalCategory,
  SignalSort,
  PaginationLinks,
  // Streaming types
  LiveStreamOptions,
  LiveStreamEventMap,
  PollStreamOptions,
  WsChannel,
  WsEventType,
  WsMessage,
  WsConnectedData,
  WsSignalData,
} from './types'

// Errors
export {
  WorldPulseError,
  ApiError,
  TimeoutError,
  RateLimitError,
  NetworkError,
  StreamError,
  StreamConnectionError,
} from './errors'
