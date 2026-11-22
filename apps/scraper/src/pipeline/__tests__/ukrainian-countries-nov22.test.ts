/**
 * Nov 22, 2026 live read: a Ukrainian outlet's "Російський корвет «Меркурій» у Лівії міг бути уражений українськими
 * дронами" sat at Ukraine (the outlet's home) because Libya, Syria, Sudan, Italy, Japan, Georgia and most capitals
 * were not in the Ukrainian list. They are read with their endings now.
 */
import { describe, it, expect } from 'vitest'
import { placeFromText } from '../geo'
import { withLocalNames } from '../local-names'

const uk = (text: string) => placeFromText(withLocalNames(text, 'uk'))

describe('Ukrainian headlines naming other countries', () => {
  it('pins the corvette story in Libya, not at the outlet', () => {
    expect(uk('Російський корвет «Меркурій» у Лівії міг бути уражений українськими дронами').countryCode).toBe('LY')
  })
  it('reads countries and capitals with their endings', () => {
    expect(uk('Удар по Сирії: загинули десятки людей').countryCode).toBe('SY')
    expect(uk('Бої у Судані: дрони атакували Хартум').countryCode).toBe('SD')
    expect(uk('Матч в Італії завершився внічию').countryCode).toBe('IT')
    expect(uk('Землетрус у Японії').countryCode).toBe('JP')
    expect(uk('Переговори у Тбілісі зірвано').countryCode).toBe('GE')
    expect(uk('Вибори в Грузії: опозиція протестує').countryCode).toBe('GE')
    expect(uk('Саміт у Анталії завершився без рішення').countryCode).toBe('TR')
    expect(uk('Лідер Північної Кореї заявив про готовність').countryCode).toBe('KP')
  })
  it('leaves words that only look like places', () => {
    expect(uk('Ліві партії програли вибори').point).toBeFalsy()
    expect(uk('Об’єм куба збільшили вдвічі').point).toBeFalsy()
    expect(uk('Римського папу зустріли у Ватикані').countryCode).not.toBe('UA')
  })
  it('still pins Ukraine at home', () => {
    expect(uk('Київ: вибухи вночі').countryCode).toBe('UA')
  })
})
