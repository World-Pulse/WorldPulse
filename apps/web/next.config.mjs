import createNextIntlPlugin from 'next-intl/plugin'
import createBundleAnalyzer from '@next/bundle-analyzer'

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
        ],
      },
    ]
  },
}

export default withBundleAnalyzer(withNextIntl(nextConfig))
