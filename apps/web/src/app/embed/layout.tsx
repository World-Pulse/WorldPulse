import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'WorldPulse Widget',
  description: 'WorldPulse live signal feed widget',
  robots: { index: false, follow: false },
}

/**
 * Layout for the embed iframe. The site's own layout supplies <html> and
 * <body>; this one used to add a second pair inside them, which made React
 * throw the widget away when the page loaded (plan G5, Oct 11, 2026). The
 * header and tab bar stay out through HideOnEmbed in the site layout, and
 * the widget fills the frame, at any size from 300×400px.
 */
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2147483000, overflow: 'hidden' }}>
      <style>{'html, body { height: 100%; overflow: hidden; }'}</style>
      {children}
    </div>
  )
}
