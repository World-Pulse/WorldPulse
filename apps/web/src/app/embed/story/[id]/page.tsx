import type { Metadata } from 'next'
import { StoryCardView } from '@/components/embed/StoryCardView'
import { fetchStoryCard } from '@/lib/embed-card-server'

// "Verified · 12 outlets" for other sites to frame (plan G20): one story's
// headline, its outlet count and a link back. ?theme=dark for dark pages.
// /embed stays out of search (the embed layout and robots.ts).
export const metadata: Metadata = {
  title: 'WorldPulse story card',
  robots: { index: false, follow: false },
}

export default async function EmbedStoryPage(
  { params, searchParams }: {
    params: Promise<{ id: string }>
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
  },
) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const theme = query.theme === 'dark' ? 'dark' : 'light'
  const card = await fetchStoryCard(id)
  return <StoryCardView card={card} theme={theme} id={id} />
}
