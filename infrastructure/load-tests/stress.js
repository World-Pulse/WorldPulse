/**
 * WorldPulse Stress Test — Gate 5
 * Ramp to 2000 VUs, identify breaking point.
 * Find the VU count where p95 > 2s or error_rate > 5%.
 *
 * Run: k6 run stress.js
 * With env: k6 run --env BASE_URL=http://localhost:3001 stress.js
 *
 * Breaking point analysis is printed in handleSummary().
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { logResults } from './lib/results-logger.js';

const errorRate = new Rate('error_rate');
const p95Latency = new Trend('p95_latency_ms', true);
const requestsPerStage = new Counter('requests_per_stage');

export const options = {
  stages: [
    { duration: '1m', target: 100 },    // Warm up
    { duration: '2m', target: 500 },    // Match load test baseline
    { duration: '2m', target: 1000 },   // 2x baseline — first stress tier
    { duration: '2m', target: 1500 },   // 3x baseline — high stress
    { duration: '2m', target: 2000 },   // 4x baseline — near-breaking
    { duration: '1m', target: 2500 },   // Beyond target — find hard limit
    { duration: '2m', target: 0 },      // Recovery ramp-down
  ],
  // Deliberately loose thresholds for stress test (we WANT to find the limit)
  thresholds: {
    http_req_duration: ['p(95)<5000'],   // Track up to 5s before aborting
    http_req_failed: ['rate<0.50'],      // Allow up to 50% errors (we're stress testing)
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

const SEARCH_TERMS = [
  'ukraine', 'earthquake', 'flood', 'conflict', 'election',
  'sanctions', 'missile', 'aircraft', 'navy', 'cyber',
];

const CATEGORIES = ['conflict', 'disaster', 'political', 'cyber', 'health'];

const params = {
  headers: {
    'Accept': 'application/json',
    'User-Agent': 'WorldPulse-StressTest/1.0',
  },
  timeout: '30s',  // Extended timeout for stress conditions
};

export default function () {
  const rand = Math.random();

  if (rand < 0.60) {
    runFeedRead();
  } else if (rand < 0.80) {
    runSearch();
  } else if (rand < 0.95) {
    runSignalDetail();
  } else {
    runHealth();
  }

  requestsPerStage.add(1);
  sleep(Math.random() * 0.5 + 0.1); // Shorter think time for stress test
}

function runFeedRead() {
  const res = http.get(`${BASE_URL}/api/v1/feed/signals?limit=20`, params);
  const ok = check(res, {
    'feed not 500': (r) => r.status < 500,
  });
  p95Latency.add(res.timings.duration);
  errorRate.add(!ok);
}

function runSearch() {
  const term = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)];
  const res = http.get(`${BASE_URL}/api/v1/search?q=${encodeURIComponent(term)}&limit=10`, params);
  const ok = check(res, {
    'search not 500': (r) => r.status < 500,
  });
  p95Latency.add(res.timings.duration);
  errorRate.add(!ok);
}

function runSignalDetail() {
  const signalId = Math.floor(Math.random() * 10000) + 1;
  const res = http.get(`${BASE_URL}/api/v1/signals/${signalId}`, params);
  const ok = check(res, {
    'detail not 500': (r) => r.status < 500,
  });
  p95Latency.add(res.timings.duration);
  errorRate.add(!ok);
}

function runHealth() {
  const res = http.get(`${BASE_URL}/api/v1/health`, params);
  check(res, {
    'health 200': (r) => r.status === 200,
  });
  p95Latency.add(res.timings.duration);
}

/**
 * Analyze breaking point from stress test data.
 * Returns the estimated VU count where p95 > 2s or error_rate > 5%.
 */
function analyzeBreakingPoint(data) {
  const p95 = data.metrics?.http_req_duration?.values?.['p(95)'] || 0;
  const errorRateVal = data.metrics?.http_req_failed?.values?.rate || 0;
  const p99 = data.metrics?.http_req_duration?.values?.['p(99)'] || 0;
  const avgDuration = data.metrics?.http_req_duration?.values?.avg || 0;
  const maxVUs = data.metrics?.vus_max?.values?.max || 0;
  const totalRequests = data.metrics?.http_reqs?.values?.count || 0;
  const rps = data.metrics?.http_reqs?.values?.rate || 0;

  let breakingPointEstimate = 'Unknown — run with live infrastructure';
  let bottleneck = 'Undetermined';

  if (p95 > 2000) {
    breakingPointEstimate = `Breaking point reached at ~${maxVUs} VUs (p95 = ${p95.toFixed(0)}ms > 2000ms threshold)`;
    bottleneck = 'Response latency degraded beyond acceptable threshold';
  } else if (errorRateVal > 0.05) {
    breakingPointEstimate = `Breaking point reached at ~${maxVUs} VUs (error_rate = ${(errorRateVal * 100).toFixed(1)}% > 5% threshold)`;
    bottleneck = 'Error rate exceeded acceptable threshold (likely connection pool exhaustion or OOM)';
  } else {
    breakingPointEstimate = `System stable up to ${maxVUs} VUs tested — breaking point not reached. Capacity > ${maxVUs} VUs.`;
    bottleneck = 'None detected at tested load levels';
  }

  return { breakingPointEstimate, bottleneck, p95, errorRateVal, maxVUs, totalRequests, rps, avgDuration, p99 };
}

export function handleSummary(data) {
  const analysis = analyzeBreakingPoint(data);
  console.log('\n=== STRESS TEST BREAKING POINT ANALYSIS ===');
  console.log(`Breaking Point: ${analysis.breakingPointEstimate}`);
  console.log(`Primary Bottleneck: ${analysis.bottleneck}`);
  console.log(`p95 latency: ${analysis.p95.toFixed(0)}ms`);
  console.log(`p99 latency: ${analysis.p99.toFixed(0)}ms`);
  console.log(`Avg latency: ${analysis.avgDuration.toFixed(0)}ms`);
  console.log(`Error rate: ${(analysis.errorRateVal * 100).toFixed(2)}%`);
  console.log(`Max VUs reached: ${analysis.maxVUs}`);
  console.log(`Total requests: ${analysis.totalRequests}`);
  console.log(`RPS at peak: ${analysis.rps.toFixed(1)}`);
  console.log('===========================================\n');

  return logResults(data, 'stress', analysis);
}
