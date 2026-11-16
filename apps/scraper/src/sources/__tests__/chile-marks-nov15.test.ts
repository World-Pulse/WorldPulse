import { describe, expect, it } from 'vitest'
import { HOME_PIN_SOURCES, NEWS_SOURCE_REGISTRY, inferGeo } from '../news-rss'

const src = (id: string) => NEWS_SOURCE_REGISTRY.find(s => s.id === id)!
const at = (id: string, title: string, body = '') => inferGeo(title, body, src(id))

// Nov 15, 2026: La Tercera and Cooperativa carry much foreign news, so a placeless story is Chile's only when it
// names something Chilean and no other country
describe('Chilean outlets pin home only on Chilean names', () => {
  it('pins a placeless Chilean story at home', () => {
    expect(at('la-tercera-cl', 'Criteria: aprobación del Presidente Kast llega al 18% y desaprobación se ubica en 72%').countryCode).toBe('CL')
    expect(at('la-tercera-cl', 'Vodanovic (PS) cuestiona negociación con camioneros y apunta a falta de conducción política').countryCode).toBe('CL')
    expect(at('la-tercera-cl', 'Senapred llama a evitar la ribera del río en la provincia del Limarí').countryCode).toBe('CL')
  })
  it('leaves foreign and placeless-foreign stories alone', () => {
    expect(at('la-tercera-cl', 'Reportan que Jensen Huang está considerando regresar como CEO de Nvidia a solo días de su renuncia').countryCode).not.toBe('CL')
    expect(at('la-tercera-cl', 'Milei confirma que va por la reelección en medio de caída de aprobación', 'El presidente argentino anunció en Buenos Aires').countryCode).not.toBe('CL')
    expect(at('la-tercera-cl', 'Alexander Zverev derriba a Rafael Jódar y se estrena con un triunfo en las ATP Finals').countryCode).not.toBe('CL')
    expect(at('la-tercera-cl', 'El Congreso argentino aprueba el presupuesto').countryCode).not.toBe('CL')
  })
  it('stays off the plain home-pin list', () => {
    expect(HOME_PIN_SOURCES.has('la-tercera-cl')).toBe(false)
    expect(HOME_PIN_SOURCES.has('cooperativa-cl')).toBe(false)
  })
})
