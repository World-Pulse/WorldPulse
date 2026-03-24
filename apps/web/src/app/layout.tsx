import type { Metadata, Viewport } from 'next'
import { Inter, Bebas_Neue, JetBrains_Mono } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../messages/en.json'
import './globals.css'
import { Providers } from '@/components/providers'
import { TopNav } from '@/components/nav/TopNav'
import { BottomTabBar } from '@/components/nav/BottomTabBar'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  preload: true,
  variable: '--font-sans',
})

const bebasNeue = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  preload: true,
  variable: '--font-display',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'optional',  // non-critical; skip if not cached to avoid layout shift
  preload: false,
  variable: '--font-mono',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: '#06070d',
}

export const metadata: Metadata = {
  title: 'WorldPulse — Global Intelligence Network',
  description: 'Real-time verified signals from every corner of the world. Live map, breaking news, open source.',
  keywords: ['world news', 'breaking news', 'global events', 'open source', 'real-time'],
  openGraph: {
    title: 'WorldPulse — Global Intelligence Network',
    description: 'Real-time verified signals from every corner of the world. Live map, breaking news, open source.',
    type: 'website',
    url: 'https://world-pulse.io',
    siteName: 'WorldPulse',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'WorldPulse' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'WorldPulse — Global Intelligence Network',
    description: 'Real-time verified signals from every corner of the world.',
    images: ['/og-image.png'],
  },
}

// Force dynamic rendering — the root layout depends on live request context
// (next-intl locale, auth state). This also prevents /_not-found from being
// statically prerendered without a next-intl request context, which would throw.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = 'en'
  const messages = enMessages as Record<string, unknown>
  const dir = 'ltr'

  return (
    <html lang={locale} dir={dir} className="dark">
      <body className={`${inter.variable} ${bebasNeue.variable} ${jetbrainsMono.variable} ${inter.className} bg-wp-bg text-wp-text antialiased`}>
        {/* Skip to main content for keyboard/screen reader users */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-wp-amber focus:text-black focus:font-bold focus:text-[14px] focus:outline-none"
        >
          Skip to main content
        </a>
        <NextIntlClientProvider messages={messages}>
          <Providers>
            <TopNav />
            <main
              id="main-content"
              className="pt-[52px] min-h-screen main-content-mobile-pb"
            >
              {children}
            </main>
            <BottomTabBar />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
