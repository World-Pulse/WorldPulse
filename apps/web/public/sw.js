/**
 * WorldPulse Service Worker — PWA Offline Support
 *
 * Strategy:
 *   - App shell (HTML, CSS, JS) → Cache First with network fallback
 *   - API requests → Network First with cache fallback
 *   - Briefing endpoint → Stale While Revalidate (always show cached, update in background)
 *   - Images → Cache First with 7-day expiry
 */

const CACHE_NAME = 'worldpulse-v1'
const BRIEFING_CACHE = 'worldpulse-briefing-v1'

// App shell files to pre-cache on install
const APP_SHELL = [
  '/',
  '/manifest.json',
]

// ── Install: pre-cache app shell ────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch(() => {
        // Non-fatal — some files may not be available yet
        console.log('[SW] Some app shell files not cached')
      })
    })
  )
  self.skipWaiting()
})

// ── Activate: clean old caches ──────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== BRIEFING_CACHE)
          .map((key) => caches.delete(key))
      )
    })
  )
  self.clients.claim()
})

// ── Fetch: route-based caching strategies ───────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Skip non-GET requests
  if (event.request.method !== 'GET') return

  // Skip Chrome extension requests, analytics, etc.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return
  if (url.hostname.includes('google') || url.hostname.includes('analytics')) return

  // ── Briefing API: Stale While Revalidate ──────────────────────────
  // Always return cached briefing immediately, update in background.
  // This means the user's 7am briefing loads instantly even offline.
  if (url.pathname.includes('/api/v1/pulse/briefing') || url.pathname.includes('/api/v1/pulse/feed')) {
    event.respondWith(
      caches.open(BRIEFING_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request)
        const fetchPromise = fetch(event.request)
          .then((response) => {
            if (response.ok) {
              cache.put(event.request, response.clone())
            }
            return response
          })
          .catch(() => cached) // If network fails, return cached

        return cached || fetchPromise
      })
    )
    return
  }

  // ── API requests: Network First ───────────────────────────────────
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache successful API responses for offline fallback
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
          }
          return response
        })
        .catch(() => caches.match(event.request))
    )
    return
  }

  // ── Static assets & pages: Cache First ────────────────────────────
  if (
    url.pathname.startsWith('/_next/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.woff2')
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((response) => {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
          return response
        })
      })
    )
    return
  }

  // ── HTML pages: Network First with offline fallback ───────────────
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
        }
        return response
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          return cached || caches.match('/') // Fall back to cached home page
        })
      })
  )
})
