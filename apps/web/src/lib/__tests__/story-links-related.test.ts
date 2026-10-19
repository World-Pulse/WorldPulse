import { describe, it, expect } from 'vitest'
import { rankRelated } from '../story-links'

const s = (id: string, category = 'security') => ({ id, category })

describe('rankRelated', () => {
  it('puts the same country first, the same topic within it, then the topic', () => {
    const out = rankRelated('x', 'security', [s('a', 'economy'), s('b', 'security')], [s('c'), s('d')])
    expect(out.map(r => r.id)).toEqual(['b', 'a', 'c', 'd'])
  })
  it('leaves out the story itself and repeats', () => {
    const out = rankRelated('x', 'security', [s('x'), s('a')], [s('a'), s('c')])
    expect(out.map(r => r.id)).toEqual(['a', 'c'])
  })
  it('keeps at most max', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => s(id))
    expect(rankRelated('x', 'security', many, [], 5)).toHaveLength(5)
  })
})
