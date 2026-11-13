/**
 * The home page's welcome band: who sees it (Nov 12, 2026; components/home/WelcomeBand.tsx).
 *
 * The band is in the page as the server sends it, so it does not push the news down when it appears (a
 * band that arrived after the page loaded moved everything by its own height: a layout shift on every
 * first visit, which search engines measure). For a reader who has been here before, one line of script,
 * run before anything is drawn, marks the page and a style rule keeps the band from showing at all.
 */

export const WELCOME_KEY = 'wp_welcome_v1'
/** The old first-scroll pop-up's key: a reader who closed that one has been welcomed */
export const WELCOME_OLD_KEY = 'wp_onboarded_v2'
const TOKEN_KEY = 'wp_access_token'

/** Whether this browser should see the band, from what it has stored */
export function shouldWelcome(get: (key: string) => string | null): boolean {
  try {
    return !get(WELCOME_KEY) && !get(WELCOME_OLD_KEY) && !get(TOKEN_KEY)
  } catch {
    return false // private mode: no way to remember, so don't greet on every page
  }
}

/** Runs before the band is drawn: marks <html data-welcomed> for a reader who has seen it (the rule beside it in app/page.tsx hides the band then) */
export const WELCOME_SCRIPT = `(function(){var d=document.documentElement;try{var s=localStorage;if(s.getItem('${WELCOME_KEY}')||s.getItem('${WELCOME_OLD_KEY}')||s.getItem('${TOKEN_KEY}'))d.setAttribute('data-welcomed','1')}catch(e){d.setAttribute('data-welcomed','1')}})()`
