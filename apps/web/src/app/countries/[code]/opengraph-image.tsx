import { countryCardImage } from '@/lib/country-card-image'

// The picture a shared country page shows (lib/country-card.ts), redrawn at most every 10 minutes
export const alt = 'WorldPulse: the country, its verified stories this week and the newest one'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const revalidate = 600

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return countryCardImage(code)
}
