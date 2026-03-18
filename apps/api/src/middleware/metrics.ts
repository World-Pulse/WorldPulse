import type { FastifyPluginAsync } from 'fastify'
import { getConnectedCount } from '../ws/handler'

// Simple in-memory metrics (production: use prom-client)
const metrics = {
  requestCount:    0,
  requestErrors:   0,
  wsConnections:   0,
  signalsCreated:  0,
  postsCreated:    0,
}

export const metricsPlugin: FastifyPluginAsync = async (app) => {
  // Count all requests
  app.addHook('onResponse', async (req, reply) => {
    metrics.requestCount++
    if (reply.statusCode >= 400) metrics.requestErrors++
  })

  // Prometheus-format metrics endpoint
  app.get('/metrics', async (_, reply) => {
    const wsCount = getConnectedCount()
    
    const output = [
      '# HELP worldpulse_requests_total Total HTTP requests',
      '# TYPE worldpulse_requests_total counter',
      `worldpulse_requests_total ${metrics.requestCount}`,
      '',
      '# HELP worldpulse_request_errors_total Total HTTP errors',
      '# TYPE worldpulse_request_errors_total counter',
      `worldpulse_request_errors_total ${metrics.requestErrors}`,
      '',
      '# HELP worldpulse_ws_connections Current WebSocket connections',
      '# TYPE worldpulse_ws_connections gauge',
      `worldpulse_ws_connections ${wsCount}`,
      '',
      '# HELP worldpulse_signals_created_total Total signals created',
      '# TYPE worldpulse_signals_created_total counter',
      `worldpulse_signals_created_total ${metrics.signalsCreated}`,
      '',
      '# HELP worldpulse_posts_created_total Total posts created',
      '# TYPE worldpulse_posts_created_total counter',
      `worldpulse_posts_created_total ${metrics.postsCreated}`,
      '',
      '# HELP process_uptime_seconds Process uptime',
      '# TYPE process_uptime_seconds gauge',
      `process_uptime_seconds ${process.uptime()}`,
      '',
    ].join('\n')

    return reply.type('text/plain; version=0.0.4').send(output)
  })
}

export function incrementMetric(key: keyof typeof metrics) {
  metrics[key]++
}
