/**
 * WorldPulse Load Test Results Logger
 * Saves JSON summaries to infrastructure/load-tests/results/{timestamp}.json
 *
 * Usage in k6 handleSummary():
 *   import { logResults } from './lib/results-logger.js';
 *   export function handleSummary(data) {
 *     return logResults(data, 'smoke');
 *   }
 */

/**
 * Generate a results summary and file path for a k6 test run.
 * @param {object} data - k6 summary data passed to handleSummary
 * @param {string} testType - 'smoke' | 'load' | 'stress'
 * @param {object} [extra] - additional analysis data (e.g. breaking point for stress test)
 * @returns {object} k6 handleSummary return value (files to write)
 */
export function logResults(data, testType, extra = {}) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `results/${timestamp}-${testType}.json`;

  const metrics = data.metrics || {};

  const summary = {
    meta: {
      test_type: testType,
      timestamp: new Date().toISOString(),
      worldpulse_version: '1.0.0',
      gate: 5,
    },
    thresholds_passed: extractThresholdsStatus(data),
    performance: {
      http_req_duration: {
        avg: safeMetric(metrics, 'http_req_duration', 'avg'),
        min: safeMetric(metrics, 'http_req_duration', 'min'),
        med: safeMetric(metrics, 'http_req_duration', 'med'),
        p90: safeMetric(metrics, 'http_req_duration', 'p(90)'),
        p95: safeMetric(metrics, 'http_req_duration', 'p(95)'),
        p99: safeMetric(metrics, 'http_req_duration', 'p(99)'),
        max: safeMetric(metrics, 'http_req_duration', 'max'),
      },
      http_reqs: {
        count: safeMetric(metrics, 'http_reqs', 'count'),
        rate: safeMetric(metrics, 'http_reqs', 'rate'),
      },
      http_req_failed: {
        rate: safeMetric(metrics, 'http_req_failed', 'rate'),
        passes: safeMetric(metrics, 'http_req_failed', 'passes'),
        fails: safeMetric(metrics, 'http_req_failed', 'fails'),
      },
      vus: {
        max: safeMetric(metrics, 'vus_max', 'max'),
        min: safeMetric(metrics, 'vus', 'min'),
      },
      data_received_bytes: safeMetric(metrics, 'data_received', 'count'),
      data_sent_bytes: safeMetric(metrics, 'data_sent', 'count'),
    },
    custom_metrics: {
      feed_latency_p95: safeMetric(metrics, 'feed_latency_ms', 'p(95)') ||
                        safeMetric(metrics, 'feed_latency', 'p(95)'),
      search_latency_p95: safeMetric(metrics, 'search_latency_ms', 'p(95)'),
      detail_latency_p95: safeMetric(metrics, 'detail_latency_ms', 'p(95)'),
      error_rate: safeMetric(metrics, 'error_rate', 'rate'),
    },
    breaking_point_analysis: extra.breakingPointEstimate ? extra : null,
    raw_metrics: sanitizeMetrics(metrics),
  };

  const output = {};
  output[filename] = JSON.stringify(summary, null, 2);
  output['stdout'] = formatConsoleOutput(summary, testType);

  return output;
}

function safeMetric(metrics, name, field) {
  return metrics?.[name]?.values?.[field] ?? null;
}

function extractThresholdsStatus(data) {
  if (!data.thresholds) return {};
  const result = {};
  for (const [key, val] of Object.entries(data.thresholds)) {
    result[key] = val.ok !== undefined ? val.ok : val;
  }
  return result;
}

function sanitizeMetrics(metrics) {
  const out = {};
  for (const [key, val] of Object.entries(metrics)) {
    out[key] = val.values || val;
  }
  return out;
}

function formatConsoleOutput(summary, testType) {
  const p = summary.performance;
  const passed = Object.values(summary.thresholds_passed).every(Boolean);
  const statusEmoji = passed ? '✅' : '❌';

  return `
${statusEmoji} WorldPulse ${testType.toUpperCase()} Test Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Thresholds:     ${passed ? 'ALL PASSED' : 'SOME FAILED'}
p95 latency:    ${(p.http_req_duration.p95 || 0).toFixed(0)}ms
p99 latency:    ${(p.http_req_duration.p99 || 0).toFixed(0)}ms
Avg latency:    ${(p.http_req_duration.avg || 0).toFixed(0)}ms
Error rate:     ${((p.http_req_failed.rate || 0) * 100).toFixed(2)}%
Total requests: ${p.http_reqs.count || 0}
RPS:            ${(p.http_reqs.rate || 0).toFixed(1)}
Max VUs:        ${p.vus.max || 0}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Results saved to: infrastructure/load-tests/${summary.meta.timestamp?.slice(0,10) || 'results'}
`;
}
