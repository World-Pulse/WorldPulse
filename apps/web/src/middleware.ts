import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Locale routing middleware is disabled — pages are not under a [locale]
// directory so next-intl's internal rewrites (/{locale}/path) would 404.
// Locale defaults to 'en' via the fallback in src/i18n/request.ts.
export function middleware(_req: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: [],  // match nothing — middleware is a no-op
}
