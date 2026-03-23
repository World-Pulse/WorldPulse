import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'WorldPulse Widget',
  description: 'WorldPulse live signal feed widget',
  robots: { index: false, follow: false },
}

/**
 * Minimal layout for the embed iframe — no TopNav, no BottomTabBar, no global chrome.
 * Designed to render cleanly inside third-party iframes at any size ≥ 300×400px.
 */
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          html, body { width: 100%; height: 100%; overflow: hidden; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  )
}
