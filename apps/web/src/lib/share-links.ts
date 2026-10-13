/**
 * Share links for a story (plan G3, Oct 11, 2026). The story page only
 * copied its address. Each network's link carries utm tags, so the reader
 * count by channel (plan G1) shows which network brought a reader back even
 * when the app hides where a click came from.
 */

export type ShareNetwork = 'x' | 'linkedin' | 'telegram' | 'bluesky' | 'whatsapp'

export interface ShareLink { network: ShareNetwork; label: string; href: string }

/** The X account shares mention ("via @WorldPulse_io") */
export const X_HANDLE = 'WorldPulse_io'

/** A page address with utm tags for one network (any tags already there are replaced) */
export function withUtm(url: string, source: string, campaign = 'story'): string {
  const u = new URL(url)
  u.searchParams.set('utm_source', source)
  u.searchParams.set('utm_medium', 'share')
  u.searchParams.set('utm_campaign', campaign)
  return u.toString()
}

/**
 * One link per network, each opening that network's own post box. `campaign`
 * names the kind of page in the utm tags: story, entity (Oct 13, 2026), entities.
 */
export function shareLinks(url: string, title: string, campaign = 'story'): ShareLink[] {
  const t = title.replace(/\s+/g, ' ').trim()
  const q = encodeURIComponent
  const tagged = (source: string) => withUtm(url, source, campaign)
  return [
    { network: 'x', label: 'X', href: `https://x.com/intent/post?text=${q(t)}&url=${q(tagged('x'))}&via=${X_HANDLE}` },
    { network: 'linkedin', label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${q(tagged('linkedin'))}` },
    { network: 'telegram', label: 'Telegram', href: `https://t.me/share/url?url=${q(tagged('telegram'))}&text=${q(t)}` },
    { network: 'bluesky', label: 'Bluesky', href: `https://bsky.app/intent/compose?text=${q(`${t} ${tagged('bluesky')}`)}` },
    { network: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${q(`${t} ${tagged('whatsapp')}`)}` },
  ]
}
