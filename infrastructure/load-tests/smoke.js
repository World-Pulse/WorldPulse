/**
 * WorldPulse Smoke Test — Gate 5
 * 10 VUs, 30s: verify basic endpoints respond 200
 *
 * Run: k6 run smoke.js
 * With env: k6 run --env BASE_URL=http://localhost:3001 smoke.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { logResults } from './lib/results-logger.js';

// Custom metrics
const errorRate = new Rate('error_rate');
const healthLatency = new Trend('health_latency', true);
const feedLatency = new Trend('feed_latency', true);
const mapLatency = new Trend('map_latency', true);

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    // Smoke test: all endpoints must respond successfully
    http_req_failed: ['rate<0.01'],       // < 1% errors
    http_req_duration: ['p(95)<500'],     // 95th percentile < 500ms
    error_rate: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

export default function () {
  const params = {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'WorldPulse-LoadTest/1.0',
    },
    timeout: '10s',
  };

  // 1. Health check
  const healthRes = http.get(`${BASE_URL}/api/v1/health`, params);
  const healthOk = check(healthRes, {
    'health status is 200': (r) => r.status === 200,
    'health response has status field': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status !== undefined;
      } catch {
        return false;
      }
    },
  });
  healthLatency.add(healthRes.timings.duration);
  errorRate.add(!healthOk);

  sleep(0.2);

  // 2. Feed signals
  const feedRes = http.get(`${BASE_URL}/api/v1/feed/signals?limit=20`, params);
  const feedOk = check(feedRes, {
    'feed status is 200': (r) => r.status === 200,
    'feed returns array': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body) || Array.isArray(body?.data) || Array.isArray(body?.signals);
      } catch {
        return false;
      }
    },
  });
  feedLatency.add(feedRes.timings.duration);
  errorRate.add(!feedOk);

  sleep(0.2);

  // 3. Map signals
  const mapRes = http.get(`${BASE_URL}/api/v1/signals/map`, params);
  const mapOk = check(mapRes, {
    'map status is 200': (r) => r.status === 200,
    'map returns data': (r) => r.body && r.body.length > 0,
  });
  mapLatency.add(mapRes.timings.duration);
  errorRate.add(!mapOk);

  sleep(0.5);
}

export function handleSummary(data) {
  return logResults(data, 'smoke');
}
