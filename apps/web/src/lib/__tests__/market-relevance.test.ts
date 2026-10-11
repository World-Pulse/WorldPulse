import { describe, it, expect } from 'vitest'
import { relevantMarkets, particularWords } from '../market-relevance'

describe('relevantMarkets', () => {
  const q = (question: string) => ({ question })
  it('drops markets that share nothing particular with the headline', () => {
    expect(particularWords('12 killed, 309 injured in Riyadh Airport attack')).toEqual(['riyadh', 'airport'])
    expect(relevantMarkets([q('NBA: Will the Mavericks beat the Grizzlies by more than 5.5 points?')],
      '12 killed, 309 injured in Riyadh Airport attack')).toEqual([])
  })

  it('keeps markets about someone or something the headline names', () => {
    const markets = [q('Will Zelenskyy leave office before 2027?'), q('Will the Lakers win the title?')]
    expect(relevantMarkets(markets, 'Trump says Ukraine should get new President as he blames Zelenskyy for diesel prices'))
      .toEqual([markets[0]])
  })
})
