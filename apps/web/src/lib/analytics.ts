import posthog from 'posthog-js'

function isInitialized(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!process.env.NEXT_PUBLIC_POSTHOG_KEY &&
    posthog.__loaded
  )
}

export function trackSignalViewed(signalId: string, signalType: string): void {
  if (!isInitialized()) return
  posthog.capture('signal_viewed', { signal_id: signalId, signal_type: signalType })
}

export function trackSearchPerformed(query: string, resultCount: number): void {
  if (!isInitialized()) return
  posthog.capture('search_performed', { query, result_count: resultCount })
}

export function trackMapOpened(): void {
  if (!isInitialized()) return
  posthog.capture('map_opened')
}

export function trackAuthCompleted(method: 'signin' | 'signup'): void {
  if (!isInitialized()) return
  posthog.capture('auth_completed', { method })
}
