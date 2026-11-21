import { describe, it, expect } from 'vitest'
import { isLotteryResult } from '../news-rss'

describe('lottery draw results are not read as news (H-0064)', () => {
  it('skips result lists', () => {
    expect(isLotteryResult('Resultado da Mega-Sena concurso 2.850: prêmio de R$ 40 milhões')).toBe(true)
    expect(isLotteryResult('Lotofácil 3300: veja as dezenas sorteadas')).toBe(true)
    expect(isLotteryResult('Timemania: resultado do sorteio de hoje')).toBe(true)
    expect(isLotteryResult('Powerball winning numbers for Saturday')).toBe(true)
  })
  it('keeps stories that merely name a game', () => {
    expect(isLotteryResult('Homem é preso por fraude na Mega-Sena')).toBe(false)
    expect(isLotteryResult('Court rules on Powerball jackpot dispute')).toBe(false)
    expect(isLotteryResult('Resultado das eleições na Bolívia')).toBe(false)
    expect(isLotteryResult('')).toBe(false)
  })
})
