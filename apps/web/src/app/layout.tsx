import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import './globals.css'
import { Providers } from '@/components/providers'
import { TopNav } from '@/components/nav/TopNav'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'WorldPulse — Global Intelligence Network',
  description: 'Real-time global events, verified signals, and open social discourse. The world in one feed.',
  keywords: ['world news', 'breaking news', 'global events', 'open source', 'real-time'],
  openGraph: {
    title: 'WorldPulse',
    description: 'The world in real time. Verified. Open source.',
    type: 'website',
    url: 'https://worldpulse.io',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'WorldPulse',
    description: 'The world in real time. Verified. Open source.',
  },
  themeColor: '#06070d',
}

const RTL_LOCALES = new Set(['ar'])

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()
  const dir = RTL_LOCALES.has(locale) ? 'rtl' : 'ltr'

  return (
    <html lang={locale} dir={dir} className="dark">
      <body className={`${inter.className} bg-wp-bg text-wp-text antialiased`}>
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
            <main id="main-content" className="pt-[52px] min-h-screen">
              {children}
            </main>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
