import createNextIntlPlugin from 'next-intl/plugin'
import createBundleAnalyzer from '@next/bundle-analyzer'
import { withSentryConfig } from '@sentry/nextjs'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')
const withBundleAnalyzer = createBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // FeedList uses loosely-typed mock data unions; errors are non-critical
    ignoreBuildErrors: true,
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'maplibre-gl'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  transpilePackages: ['@worldpulse/types', '@worldpulse/ui'],
  output: 'standalone',
  // Security headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
          // Allow map tile sources and country GeoJSON CDN used by the live map
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline' https://fonts.openmaptiles.org",
              "font-src 'self' https://fonts.openmaptiles.org",
              "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.earthdata.nasa.gov https://gibs.earthdata.nasa.gov",
              [
                "connect-src 'self'",
                'https://api.world-pulse.io',
                'wss://api.world-pulse.io',
                // Allow localhost API connections only in development builds
                ...(process.env.NODE_ENV !== 'production'
                  ? ['http://localhost:3001', 'ws://localhost:3001']
                  : []),
                'https://tile.openstreetmap.org',
                'https://celestrak.org',
                'https://gibs.earthdata.nasa.gov',
                // Natural Earth country boundary GeoJSON for country risk choropleth
                'https://d2ad6b4ur7yvpq.cloudfront.net',
                // Sentry error reporting (*.ingest.sentry.io for any org)
                'https://*.ingest.sentry.io',
                'https://*.ingest.us.sentry.io',
              ].join(' '),
              // MapLibre GL JS requires Web Workers + blob: for tile decoding
              "worker-src 'self' blob:",
              "child-src 'self' blob:",
              "frame-src 'none'",
              "object-src 'none'",
              "base-uri 'self'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

const nextConfigWithPlugins = withBundleAnalyzer(withNextIntl(nextConfig))

export default withSentryConfig(nextConfigWithPlugins, {
  // Suppress noisy build output
  silent: true,

  // Upload source maps to Sentry for readable stack traces
  uploadSourceMaps: true,

  // Tree-shake unused Sentry code from client bundle
  widenClientFileUpload: true,

  // Automatically instrument Next.js data-fetching (getServerSideProps, etc.)
  autoInstrumentServerFunctions: true,

  // Tunnel Sentry requests through the Next.js server to avoid ad-blockers
  tunnelRoute: '/monitoring-tunnel',

  // Hide source map files from the browser
  hideSourceMaps: true,

  // Disable SDK logger in production builds
  disableLogger: true,
})
