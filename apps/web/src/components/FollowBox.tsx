import { X_HANDLE } from '@/lib/share-links'

/**
 * A small "Follow" line for story pages and /briefing (plan G18 slice 2,
 * Oct 19, 2026): the verified-stories feed and WorldPulse on X, the two ways
 * to come back that need no key on the server. The 7 AM email box
 * (BriefingSignup) shows itself once email can be sent. Plain links, so it
 * renders in the page's HTML.
 */
export const FOLLOW_FEED_URL = 'https://api.world-pulse.io/api/v1/rss/signals.xml'

export function FollowBox({ className = '' }: { className?: string }) {
  const link = 'text-wp-text2 hover:text-wp-amber underline-offset-2 hover:underline'
  return (
    <aside aria-label="Follow WorldPulse" className={`text-[12px] text-wp-text3 flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      <span>Follow WorldPulse:</span>
      <a href={FOLLOW_FEED_URL} className={link} rel="noopener">Feed of verified stories</a>
      <a href={`https://x.com/${X_HANDLE}`} className={link} target="_blank" rel="noopener noreferrer">@{X_HANDLE} on X</a>
    </aside>
  )
}
