import { cachedFetch } from '@/lib/server-fetch'
import type { WeekData } from '@/components/week/WeekView'

const API_BASE = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

/**
 * A week's page data from GET /api/v1/stories/week (no name: the week under
 * way); 'missing' for a week that doesn't exist or hasn't begun, 'unavailable'
 * when the API didn't answer. Kept 2 minutes in this process.
 */
export async function fetchWeek(name?: string): Promise<WeekData | 'missing' | 'unavailable'> {
  try {
    const res = await cachedFetch(`${API_BASE}/api/v1/stories/week${name ? `?week=${encodeURIComponent(name)}` : ''}`, 120_000)
    if (res.status === 400 || res.status === 404) return 'missing'
    if (!res.ok) return 'unavailable'
    const json = await res.json() as { success?: boolean; data?: WeekData }
    return json.success && json.data ? json.data : 'unavailable'
  } catch {
    return 'unavailable'
  }
}
