import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { Inter, Bebas_Neue, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/providers'
import { TopNav } from '@/components/nav/TopNav'
import { BottomTabBar } from '@/components/nav/BottomTabBar'
// import { BreakingAlertBanner } from '@/components/alerts/BreakingAlertBanner'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { CommandPaletteProvider, CommandPalette } from '@/components/CommandPalette'
import { LocaleAttributes } from '@/components/locale/LocaleAttributes'

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
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'WorldPulse',
  },
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

// Prevent /_not-found and other pages from being statically prerendered at build
// time — static prerender runs without a next-intl request context, causing
// NextIntlClientProvider/useTranslations to throw "Couldn't find config file".
export const dynamic = 'force-dynamic'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className="dark">
      <Script
        src="https://www.googletagmanager.com/gtag/js?id=G-YJXNFP4046"
        strategy="afterInteractive"
      />
      <Script id="gtag-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-YJXNFP4046');
        `}
      </Script>
      <Script id="sw-register" strategy="afterInteractive">
        {`
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(() => {});
          }
        `}
      </Script>
      <body className={`${inter.variable} ${bebasNeue.variable} ${jetbrainsMono.variable} ${inter.className} bg-wp-bg text-wp-text antialiased`}>
        {/* Skip to main content for keyboard/screen reader users */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-wp-amber focus:text-black focus:font-bold focus:text-[14px] focus:outline-none"
        >
          Skip to main content
        </a>
        <LocaleAttributes />
          <Providers>
            {/* CommandPaletteProvider registers the ⌘K/Ctrl+K global shortcut */}
            <CommandPaletteProvider>
              <CommandPalette />
              {/* <BreakingAlertBanner /> */}
              <TopNav />
              <main
                id="main-content"
                className="pt-[52px] min-h-screen main-content-mobile-pb"
              >
                <ErrorBoundary>{children}</ErrorBoundary>
              </main>
              <BottomTabBar />
            </CommandPaletteProvider>
          </Providers>
      </body>
    </html>
  )
}
