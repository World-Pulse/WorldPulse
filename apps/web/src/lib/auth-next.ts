/**
 * Where sign-in and sign-up send a reader afterwards (plan G13, Oct 11, 2026):
 * back to the page they came from, carried as ?next=. The sign-in page used
 * to ignore it and always went home, so "Sign in" on a story, Pricing's
 * Upgrade or Settings lost the reader's place.
 *
 * Only a path on this site counts: never another site ("//host", "/\host",
 * a scheme), never the sign-in and onboarding pages themselves.
 */

const MAX_NEXT = 512

/** `raw` if it is a safe path on this site, else null */
export function safeNext(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\') || v.length > MAX_NEXT) return null
  // Browsers drop tabs and line breaks from addresses ("/\t/host" → "//host")
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return null
  if (/^\/(auth|onboarding)(\/|\?|#|$)/.test(v)) return null
  return v
}

/** ?next= from the address bar (in the browser only; null on the server) */
export function nextFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  return safeNext(new URLSearchParams(window.location.search).get('next'))
}

/** A sign-in or sign-up link that brings the reader back to `next` */
export function authHref(kind: 'login' | 'register', next?: string | null): string {
  const n = safeNext(next ?? null)
  return n && n !== '/' ? `/auth/${kind}?next=${encodeURIComponent(n)}` : `/auth/${kind}`
}

/** Where to go once signed in: new accounts through onboarding first, then `next` */
export function afterSignIn(onboarded: boolean, next: string | null): string {
  const n = safeNext(next)
  if (!onboarded) return n ? `/onboarding?next=${encodeURIComponent(n)}` : '/onboarding'
  return n ?? '/'
}
