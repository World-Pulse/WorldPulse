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

// ── Push alerts (Oct 31, 2026) ──────────────────────────────────────────────
// The server (apps/api lib/push-scan.ts) sends a story verified by several
// outlets as { title, body, url, tag }. Every push shows a notification: Safari
// ends a subscription whose pushes don't. A newer push with the same tag (the
// same story) replaces the old one.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' }
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'WorldPulse'
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    data: { url: typeof data.url === 'string' ? data.url : '/' },
  }
  if (typeof data.tag === 'string' && data.tag) options.tag = data.tag
  event.waitUntil(self.registration.showNotification(title, options))
})

// Opening a notification opens its story: in a WorldPulse tab already open on it, or a new one
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  let target = '/'
  try {
    const u = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin)
    if (u.origin === self.location.origin) target = u.href
  } catch (e) { /* the home page */ }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url === target && 'focus' in client) return client.focus()
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined
    })
  )
})
