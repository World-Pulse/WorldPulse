/**
 * WorldPulse Load Test — Gate 5
 * Ramp to 500 VUs over 2min, hold 5min, ramp down.
 * Mix: 60% feed reads, 20% search, 15% signal detail, 5% auth
 * Thresholds: p95 < 500ms, error_rate < 1%
 *
 * Run: k6 run load.js
 * With env: k6 run --env BASE_URL=http://localhost:3001 load.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { logResults } from './lib/results-logger.js';

// Custom metrics per endpoint category
const errorRate = new Rate('error_rate');
const feedLatency = new Trend('feed_latency_ms', true);
const searchLatency = new Trend('search_latency_ms', true);
const detailLatency = new Trend('detail_latency_ms', true);
const authLatency = new Trend('auth_latency_ms', true);

export const options = {
  stages: [
    { duration: '2m', target: 500 },   // Ramp up to 500 VUs over 2 minutes
    { duration: '5m', target: 500 },   // Hold at 500 VUs for 5 minutes
    { duration: '1m', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],   // 95th percentile < 500ms
    http_req_failed: ['rate<0.01'],     // < 1% HTTP errors
    error_rate: ['rate<0.01'],          // < 1% logical errors
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

// Search terms for realistic query distribution
const SEARCH_TERMS = [
  'ukraine', 'earthquake', 'flood', 'conflict', 'election',
  'sanctions', 'missile', 'aircraft', 'navy', 'cyber',
  'protest', 'ceasefire', 'nuclear', 'diplomatic', 'outbreak',
];

// Signal categories for detail page requests
const CATEGORIES = ['conflict', 'disaster', 'political', 'cyber', 'health', 'economy'];

const params = {
  headers: {
    'Accept': 'application/json',
    'User-Agent': 'WorldPulse-LoadTest/1.0',
  },
  timeout: '15s',
};

export default function () {
  // Traffic distribution: 60% feed, 20% search, 15% signal detail, 5% auth
  const rand = Math.random();

  if (rand < 0.60) {
    // 60% — Feed reads (core workload)
    runFeedRead();
  } else if (rand < 0.80) {
    // 20% — Search queries
    runSearch();
  } else if (rand < 0.95) {
    // 15% — Signal detail pages
    runSignalDetail();
  } else {
    // 5% — Auth / user session checks
    runAuthCheck();
  }

  sleep(Math.random() * 1.5 + 0.5); // 0.5–2s think time
}

function runFeedRead() {
  const limit = [10, 20, 50][Math.floor(Math.random() * 3)];
  const category = Math.random() > 0.5 ? `&category=${CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)]}` : '';
  const res = http.get(`${BASE_URL}/api/v1/feed/signals?limit=${limit}${category}`, params);
  const ok = check(res, {
    'feed 200': (r) => r.status === 200,
    'feed has body': (r) => r.body && r.body.length > 2,
  });
  feedLatency.add(res.timings.duration);
  errorRate.add(!ok);
}

function runSearch() {
  const term = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)];
  const res = http.get(`${BASE_URL}/api/v1/search?q=${encodeURIComponent(term)}&limit=20`, params);
  const ok = check(res, {
    'search 200 or 404': (r) => r.status === 200 || r.status === 404,
    'search not 500': (r) => r.status < 500,
  });
  searchLatency.add(res.timings.duration);
  errorRate.add(!ok);
}

function runSignalDetail() {
  // Use a known-range ID — in prod these would be real UUIDs from a seeded list
  const signalId = Math.floor(Math.random() * 10000) + 1;
  const res = http.get(`${BASE_URL}/api/v1/signals/${signalId}`, params);
  const ok = check(res, {
    'detail not 500': (r) => r.status !== 500,
    'detail 200 or 404': (r) => r.status === 200 || r.status === 404,
  });
  detailLatency.add(res.timings.duration);
  errorRate.add(!ok);
}

function runAuthCheck() {
  // Health check as auth proxy (no real credentials in load test)
  const res = http.get(`${BASE_URL}/api/v1/health`, params);
  const ok = check(res, {
    'health 200': (r) => r.status === 200,
  });
  authLatency.add(res.timings.duration);
  errorRate.add(!ok);
}

export function handleSummary(data) {
  return logResults(data, 'load');
}
