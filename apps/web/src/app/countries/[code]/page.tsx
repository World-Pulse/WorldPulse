import CountryDetail from './CountryDetail'
import { fetchCountryStories } from '@/lib/country-stories'

// A country's page (plan 14, Oct 20, 2026): the server fetches the country's
// top stories, with how many outlets carry each, so they are in the page's
// first HTML; the rest of the page loads in the browser as before
// (CountryDetail.tsx). Its title and description: layout.tsx.

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const stories = await fetchCountryStories(code)
  return <CountryDetail code={code} topStories={stories ?? []} />
}
