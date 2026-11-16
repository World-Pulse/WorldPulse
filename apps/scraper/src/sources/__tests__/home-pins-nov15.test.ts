import { describe, expect, it } from 'vitest'
import { HOME_PIN_SOURCES, NEWS_SOURCE_REGISTRY, inferGeo } from '../news-rss'

const src = (id: string) => NEWS_SOURCE_REGISTRY.find(s => s.id === id)!
const at = (id: string, title: string, body = '') => inferGeo(title, body, src(id))

// Nov 15, 2026: the weekly accuracy read found stories from these outlets with no pin at all
describe('home pins for national outlets (Nov 15)', () => {
  it('pins a placeless national story at home', () => {
    expect(at('rtp-noticias', 'Governo admite que país pode voltar a parar devido à meteorologia').countryCode).toBe('PT')
    expect(at('rtp-noticias', 'Reestruturação orgânica do Ministério da Saúde deve ser apresentada este mês').countryCode).toBe('PT')
    expect(at('juno7-ht', 'Inscriptions des candidats : le CEP attribue les perturbations à une panne d’Outlook').countryCode).toBe('HT')
  })
  it('keeps the Chilean feeds off the list (their foreign stories would sit in Santiago)', () => {
    expect(HOME_PIN_SOURCES.has('la-tercera-cl')).toBe(false)
    expect(HOME_PIN_SOURCES.has('cooperativa-cl')).toBe(false)
    expect(at('cooperativa-cl', 'Fiscalía mexicana investiga a cantante de corridos tumbados tras frenar su show en Querétaro').countryCode).not.toBe('CL')
  })
})
