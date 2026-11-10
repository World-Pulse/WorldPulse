/**
 * Severity in French, Spanish, Portuguese and German (Nov 10, 2026): the English rules rated "12 morts", "deja
 * 12 muertos", "12 mortos" and "12 Tote" low, 86% of 2,494 recent reports in these languages. Headlines from the
 * live feeds that day, read in their feed's language.
 */
import { describe, it, expect } from 'vitest'
import { rateSeverity } from '../severity'
import { foreignNumber } from '../severity-languages'

describe('the dead and injured in four more languages', () => {
  it('rates by the dead, as in English', () => {
    expect(rateSeverity('Ménaka : au moins 48 civils tués dans des attaques contre des campements', null, 'conflict', 'fr')).toBe('high')
    expect(rateSeverity('Sénégal : au moins 34 morts dans un naufrage de migrants au large de Kébémer', null, 'disaster', 'fr')).toBe('high')
    expect(rateSeverity("Ebola : l'épidémie a fait plus de 5 300 morts en Afrique, dont l'immense majorité en RDC", null, 'health', 'fr')).toBe('critical')
    expect(rateSeverity('Al menos 19 muertos en bombardeo militar contra campamento del ELN en Venezuela', null, 'conflict', 'es')).toBe('high')
    expect(rateSeverity('Cinco personas mueren por rabia humana en Zulia: Min Salud activa plan de vacunación masiva', null, 'health', 'es')).toBe('high')
    expect(rateSeverity('Terroristas matam 19 pessoas em dez dias em Cabo Delgado', null, 'conflict', 'pt')).toBe('high')
    expect(rateSeverity('Acidente na EN-100 provoca seis mortos e 14 feridos no Cuanza-Sul', null, 'disaster', 'pt')).toBe('high')
    expect(rateSeverity('Mindestens 12 Tote bei Erdbeben in der Türkei', null, 'disaster', 'de')).toBe('high')
    // one death, no number: medium
    expect(rateSeverity('Llegó muerta al hospital por un accidente doméstico', null, null, 'es')).toBe('medium')
  })

  it('reads counts as these languages write them', () => {
    expect(foreignNumber('5 300')).toBe(5300)
    expect(foreignNumber('1.236')).toBe(1236)
    expect(foreignNumber('dizaines')).toBe(24)
    expect(foreignNumber('cinco')).toBe(5)
  })

  it("counts a toll in the headline; the summary's tolls are often background, so there a death lifts to medium only", () => {
    expect(rateSeverity('Cabo Delgado. Ucrânia reafirma apoiar combate ao terrorismo',
      'Embaixador ucraniano visitou Cabo Delgado. Conflito já fez 6.600 mortos e 1,3 milhões de deslocados.', 'conflict', 'pt')).toBe('medium')
    expect(rateSeverity('Insécurité routière en Haïti : 88 victimes en sept jours', 'Une semaine: 29 accidents graves, six morts et 82 blessés.', null, 'fr')).toBe('medium')
  })
})

describe('the kinds of event in four more languages', () => {
  it('rates bombings, coups and massacres high, and protests, arrests and elections medium', () => {
    expect(rateSeverity('Atentado con camión bomba cerca de una base militar en Colombia', null, null, 'es')).toBe('high')
    expect(rateSeverity("Tentative de coup d'État déjouée au Burkina Faso", null, null, 'fr')).toBe('high')
    expect(rateSeverity('Luftangriff auf Kiew in der Nacht', null, null, 'de')).toBe('high')
    expect(rateSeverity('Manifestantes detidos no Porto pronunciam-se sobre o processo', null, null, 'pt')).toBe('medium')
    expect(rateSeverity("Haïti-Élections : des soupçons d'enregistrement clandestin d'électeurs signalés à Corail", null, null, 'fr')).toBe('medium')
    expect(rateSeverity('Trabajadores del INE se suman a paro nacional por aumento salarial', null, null, 'es')).toBe('medium')
  })

  it("doesn't take a bomb threat for a bombing, dead pigs for dead people, or a name for a killing", () => {
    expect(rateSeverity('Caracol Televisión evacúa sede en Bogotá por amenaza de atentado', null, null, 'es')).toBe('medium')
    expect(rateSeverity("Menace d'attentat : la gare évacuée", null, null, 'fr')).toBe('medium')
    expect(rateSeverity('1.236 tote Schweine in Amstetten: Staatsanwaltschaft klagt Bauern an', null, null, 'de')).not.toBe('critical')
    expect(rateSeverity('Juan Mata ficha por el Melbourne Victory', null, 'sports', 'es')).toBe('low')
    expect(rateSeverity('Desmatamento da Mata Atlântica cresce 10% em 2026', null, null, 'pt')).toBe('low')
    expect(rateSeverity('Comment gagner de la place dans une chambre grâce à un lit coffre ?', null, null, 'fr')).toBe('low')
  })

  it('reads English as before, and another language only for its own reports', () => {
    expect(rateSeverity('Tote bags are back in fashion')).toBe('low')
    expect(rateSeverity('Tote bags are back in fashion', null, null, 'en')).toBe('low')
    // a French toll in an English-language report isn't read as French
    expect(rateSeverity('Retour sur 12 morts', null, null)).toBe('low')
    expect(rateSeverity('Retour sur 12 morts', null, null, 'fr')).toBe('high')
  })
})
