/**
 * Word rules for a news item's category (pipeline/categories.ts), shared by
 * the RSS reader and classify.ts. Headlines from the live site, Oct 10–11, 2026.
 */

import { describe, it, expect } from 'vitest'
import { categorizeText, categorizeArticle, lede } from '../categories'

describe('categorizeText', () => {
  it('files the stories the old rules got wrong', () => {
    expect(categorizeText('Pope Leo XIV to undergo surgery to remove lump on lung')).toBe('health')
    expect(categorizeText('Children among 109 dead after boat capsizes off Djibouti, UN says')).toBe('disaster')
    expect(categorizeText('Riyadh airport strike kills 12, Saudi Arabia threatens decisive response')).toBe('conflict')
    expect(categorizeText('Shooter kills 8 people and himself in Pennsylvania — police')).toBe('conflict')
    expect(categorizeText('Escalating fighting in Yemen worsens food security crisis')).toBe('conflict')
    expect(categorizeText('Nursing shortage prompts Philly schools to offer loan repayment')).toBe('health')
    expect(categorizeText('Tunisia\'s Carthage Music Days puts its faith in the local scene')).toBe('culture')
  })

  it('reads care words in a headline only, and not "rushed to hospital"', () => {
    expect(categorizeText('Two Carlton players treated in hospital after needing care')).toBeNull()
    // The description's "medical evacuation" doesn't make a sea standoff health news
    expect(categorizeText(
      "Marcos sees 'new phase' of escalation in West Philippine Sea",
      "President Marcos said China's obstruction of a medical evacuation mission signalled a new phase.",
    )).toBeNull()
  })

  it('leaves names and figures of speech alone', () => {
    // "Oscar" the man, a "novel approach", a career "derailed", a "bestselling" car
    expect(categorizeText('Anti-ICE protests in New York', 'Protesters demand action after officers shot Oscar Belgal.')).toBeNull()
    expect(categorizeText('Case study: Apartment solar? A novel approach from Bucharest')).toBeNull()
    expect(categorizeText('Ex-TV host recalls washing dishes', 'A drug scandal derailed his entertainment career.')).toBeNull()
    expect(categorizeText("The EU's China dilemma", "The Jaecoo 7 became Britain's bestselling car.")).toBeNull()
    // "who" the pronoun isn't the WHO
    expect(categorizeText('A Working-Class Marxist Who Faced the Apocalypse')).toBeNull()
  })

  it('keeps an animal attack out of conflict', () => {
    expect(categorizeText('Man dies after entering tiger enclosure at UK zoo')).toBe('other')
  })
})

describe('categorizeArticle', () => {
  it('reads the headline, then the opening', () => {
    expect(categorizeArticle('Ruas confirmed as governor with 50.88%', 'Ruas won the runoff election on Sunday.')).toBe('elections')
    expect(categorizeArticle('Panama counts the damage', 'A powerful earthquake shook the country overnight.')).toBe('disaster')
  })

  it('falls back to politics, then urgent wording, then "other"', () => {
    expect(categorizeArticle('Trump urges Zelensky replacement as diesel row rages', null)).toBe('geopolitics')
    expect(categorizeArticle('India braces for second day of major protests', null)).toBe('geopolitics')
    expect(categorizeArticle('Residents told to leave', 'An evacuation order was issued at noon.')).toBe('breaking')
    expect(categorizeArticle("Love Island's Anton Danyluk hard launches new girlfriend", null)).toBe('other')
    expect(categorizeArticle('How Philly’s best ice cream gets made', '')).toBe('other')
  })

  it("doesn't read the rest of a long article", () => {
    const body = `${'The novelist spent a decade on the book, she said. '.repeat(10)}Her late uncle fought in the war.`
    expect(categorizeArticle('Alicia Malone mixes popcorn and blood in her first mystery', body)).toBe('culture')
  })
})

describe('lede', () => {
  it('keeps short text and cuts long text at a word', () => {
    expect(lede('  A short\n opening. ')).toBe('A short opening.')
    expect(lede(null)).toBe('')
    const cut = lede('word '.repeat(200), 50)
    expect(cut.length).toBeLessThanOrEqual(50)
    expect(cut.endsWith('word')).toBe(true)
  })
})
