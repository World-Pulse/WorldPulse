/**
 * Fact-checks of claims about a story on its page (Nov 11, 2026): the checkers' own headlines, claims and
 * ratings, credited and linked, in the page's own HTML; nothing when no check is about the story. From the
 * Florida jet crash and the two checks the API found for it that day (Full Fact's and PolitiFact's).
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FactChecksView, StoryFactChecks, checkDay, hasFactChecks, type StoryFactChecksData } from '@/app/signals/[id]/StoryFactChecks'

const DATA: StoryFactChecksData = {
  storyId: '11111111-1111-4111-8111-111111111111',
  available: true,
  checks: [
    {
      checker: 'Full Fact', checkerUrl: 'https://fullfact.org',
      title: 'Florida Learjet plane crash was real, not faked to cover up a missile strike',
      url: 'https://fullfact.org/us/florida-private-jet-crash-real-not-faked/', published: '2026-11-04T16:00:49.000Z',
      claim: null, rating: null, summary: 'False claims that a private jet crash in Florida was faked have spread online.',
    },
    {
      checker: 'PolitiFact', checkerUrl: 'https://www.politifact.com',
      title: 'Palm Beach plane crash footage isn’t AI-generated, despite social media claims',
      url: 'https://politifact.com/factchecks/2026/nov/02/tweets/palm-beach-florida-plane-crash-video-ai/', published: '2026-11-02T21:14:05.000Z',
      claim: 'Footage of the Nov. 1 plane crash “was 100%” generated with AI.', rating: 'Pants on Fire!', summary: null,
    },
  ],
}

describe("a story's fact-checks", () => {
  it("shows each checker's headline, linked, with its claim and rating as it wrote them", () => {
    const html = renderToStaticMarkup(<FactChecksView data={DATA} />)
    expect(html).toContain('Fact-checks')
    expect(html).toContain('WorldPulse doesn’t rule on claims')
    expect(html).toContain('href="https://fullfact.org/us/florida-private-jet-crash-real-not-faked/"')
    expect(html).toContain('Florida Learjet plane crash was real, not faked to cover up a missile strike ↗')
    expect(html).toContain('False claims that a private jet crash in Florida was faked have spread online.')
    expect(html).toContain('rated it <span class="text-wp-text2">Pants on Fire!</span>')
    expect(html).toContain('The claim it checked: Footage of the Nov. 1 plane crash “was 100%” generated with AI.')
    expect(html).toContain('>PolitiFact</a>')
    // dates in UTC, the same on the server and in the browser
    expect(html).toContain('· Nov 4')
    expect(html).toContain('· Nov 2')
  })

  it('is in the page\'s own HTML when the page brings the checks, and empty without any', () => {
    expect(renderToStaticMarkup(<StoryFactChecks storyKey="x" initial={DATA} />)).toContain('Learjet')
    expect(renderToStaticMarkup(<StoryFactChecks storyKey="x" initial={{ ...DATA, checks: [] }} />)).toBe('')
    expect(renderToStaticMarkup(<StoryFactChecks storyKey="x" initial={null} ask />)).toBe('')
  })

  it('shows only checks with a secure link and a headline', () => {
    const odd = { ...DATA, checks: [{ ...DATA.checks[0]!, url: 'javascript:alert(1)' }, { ...DATA.checks[1]!, title: '' }] }
    expect(hasFactChecks(odd)).toBe(false)
    expect(renderToStaticMarkup(<FactChecksView data={odd} />)).toBe('')
    expect(checkDay('not a date')).toBe('')
    expect(checkDay('2026-11-04T23:59:00-05:00')).toBe('Nov 5')
  })
})
