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
    // The build type-checks the app (not its tests: tsconfig.build.json), so a
    // type error stops the deploy and the live site stays as it was. It used to
    // skip the check; 134 errors had piled up, among them a crash on every
    // community and AI profile page (fixed Oct 11, 2026).
    ignoreBuildErrors: false,
    tsconfigPath: 'tsconfig.build.json',
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'maplibre-gl'],
  },
  images: {
    // Only our own uploads go through the image optimizer (/_next/image).
    // Allowing every host let anyone make our server fetch and decode any
    // image on the internet: the route to the 2026 image-optimizer RCE and
    // SSRF advisories. Post images are served from /uploads/ on these hosts.
    remotePatterns: [
      { protocol: 'https', hostname: 'world-pulse.io', pathname: '/uploads/**' },
      { protocol: 'https', hostname: 'api.world-pulse.io', pathname: '/uploads/**' },
    ],
  },
  transpilePackages: ['@worldpulse/types', '@worldpulse/ui'],
  output: 'standalone',
  // Security headers
  async headers() {
    return [
      {
        // Everything except /embed/*: those pages are made to be framed by
        // other sites, and src/middleware.ts gives them their own headers
        // (a second X-Frame-Options: DENY or CSP from here would win and
        // leave the embedded map blank on every other site; plan G17)
        source: '/((?!embed(?:/|$)).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
          // Allow the map tile sources used by the live map (country borders are our own, /geo/)
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com",
              "style-src 'self' 'unsafe-inline' https://fonts.openmaptiles.org",
              "font-src 'self' https://fonts.openmaptiles.org",
              "img-src 'self' data: blob: https://tile.openstreetmap.org https://server.arcgisonline.com https://*.maptiler.com https://*.earthdata.nasa.gov https://gibs.earthdata.nasa.gov https://www.google-analytics.com https://*.google-analytics.com",
              [
                "connect-src 'self'",
                'https://api.world-pulse.io',
                'wss://api.world-pulse.io',
                // Allow localhost API connections only in development builds
                ...(process.env.NODE_ENV !== 'production'
                  ? ['http://localhost:3001', 'ws://localhost:3001']
                  : []),
                'https://tile.openstreetmap.org',
                // World Map vector basemap, fonts and icons (OpenFreeMap)
                'https://tiles.openfreemap.org',
                'https://server.arcgisonline.com',
                'https://*.maptiler.com',
                'https://celestrak.org',
                'https://gibs.earthdata.nasa.gov',
                // Sentry error reporting (*.ingest.sentry.io for any org)
                'https://*.ingest.sentry.io',
                'https://*.ingest.us.sentry.io',
                // Google Analytics
                'https://www.googletagmanager.com',
                'https://www.google-analytics.com',
                'https://*.google-analytics.com',
                'https://*.analytics.google.com',
              ].join(' '),
              // MapLibre GL JS requires Web Workers + blob: for tile decoding
              "worker-src 'self' blob:",
              "child-src 'self' blob:",
              // (same as src/middleware.ts: our embed widget, the /cameras players)
              "frame-src 'self' https://embed.windy.com https://www.earthcam.com",
              "object-src 'none'",
              "base-uri 'self'",
            ].join('; '),
          },
        ],
      },
      {
        // The World Map's country borders (lib/country-shapes.ts): kept a week
        // by browsers instead of asked again on every map visit. A changed
        // file gets a new name.
        source: '/geo/:file*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=604800' }],
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
