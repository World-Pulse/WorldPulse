/**
 * Topics in French, Spanish, Portuguese and German (Nov 10, 2026): the topic rules read English only, so these
 * languages' reports kept their outlet's own topic, mostly Politics, and some of their words were read as English
 * ones (a German "war", "was", as conflict). Headlines from the live feeds that day, read in their feed's language.
 */
import { describe, it, expect, vi } from 'vitest'
import { categorizeText } from '../categories'

vi.mock('../../lib/redis', () => ({ redis: {} }))

const { detectNewsCategory } = await import('../../sources/news-rss')

describe('topics in four more languages', () => {
  it('reads French', () => {
    expect(categorizeText('Sénégal : au moins 34 morts dans un naufrage de migrants au large de Kébémer', '', 'fr')).toBe('disaster')
    expect(categorizeText("Elim/CAN 2027: Les Léopards, à deux succès d'une qualification avant l'heure", '', 'fr')).toBe('sports')
    expect(categorizeText('RDC : la justice militaire condamne 66 soldats à mort', '', 'fr')).toBe('conflict')
    expect(categorizeText("Haïti : la sécurité et les élections au menu d'une rencontre entre Fils-Aimé et les diplomates", '', 'fr')).toBe('elections')
    expect(categorizeText('Mali : 125 milliards de francs CFA débloqués pour les hôpitaux et les projets prioritaires', '', 'fr')).toBe('health')
  })

  it('reads Spanish', () => {
    expect(categorizeText('Un policía fallecido y seis heridos deja un atentado con explosivos en suroeste colombiano', '', 'es')).toBe('conflict')
    expect(categorizeText('Venezuela vapulea a Cuba en el Mundial Sub-23 de béisbol y lo deja sin posibilidad de medallas', '', 'es')).toBe('sports')
    expect(categorizeText('Incendios en la Amazonía brasileña se dispararon un 140% en octubre', '', 'es')).toBe('disaster')
    expect(categorizeText('Delcy Rodríguez promete elecciones en Venezuela con una autoridad "renovada"', '', 'es')).toBe('elections')
    expect(categorizeText('Francia adelanta la subida del salario mínimo ante las protestas y la presión sindical', '', 'es')).toBe('economy')
  })

  it('reads Portuguese', () => {
    expect(categorizeText('Wiliete vence São Salvador e reforça liderança do Girabola com 19 pontos', '', 'pt')).toBe('sports')
    expect(categorizeText('Disponíveis 250 talhões para reassentar famílias afectadas pelas inundações em Maputo', '', 'pt')).toBe('disaster')
    expect(categorizeText('Terrorismo: menor morre após accionar explosivo em Macomia', '', 'pt')).toBe('security')
    expect(categorizeText('CNE defende transparência e partilha de informação na preparação das eleições de 2027', '', 'pt')).toBe('elections')
  })

  it('reads German', () => {
    expect(categorizeText('A1 Richtung Wien nach Lkw-Unfall stundenlang gesperrt', '', 'de')).toBe('disaster')
    expect(categorizeText('Eishockey-WM der Frauen: Österreich gegen die Schweiz jetzt im Liveticker', '', 'de')).toBe('sports')
    expect(categorizeText('CO2-Emissionen steigen trotz sinkendem Ölverbrauch', '', 'de')).toBe('climate')
    expect(categorizeText('Gesundheitszustand von Linzer Altbischof Ludwig Schwarz verschlechtert', '', 'de')).toBe('health')
  })

  it("files a murder and a bomb threat as security, an armed group's attack as conflict", () => {
    expect(categorizeText('Vinculan a proceso a estudiante por feminicidio de universitaria en Hidalgo', '', 'es')).toBe('security')
    expect(categorizeText('Caracol Televisión evacúa sede en Bogotá por amenaza de atentado', '', 'es')).toBe('security')
    expect(categorizeText('Europa enfrenta una nueva ola de falsas amenazas de bomba en aeropuertos y vuelos', '', 'es')).toBe('security')
    expect(categorizeText('“No nos van a intimidar”: Abelardo tras nuevo ataque con drones en Cauca', '', 'es')).toBe('conflict')
  })

  it('keeps the English words ("Champions League", "Hamas", "tsunami") for these languages too', () => {
    expect(categorizeText('Tsunami-Warnung nach Erdbeben vor Japan', '', 'de')).toBe('disaster')
    expect(categorizeText('Hamas libère deux otages', '', 'fr')).toBe('conflict')
    expect(categorizeText('Earthquake hits Turkey', '', 'es')).toBe('disaster')
  })
})

describe("these languages' false friends", () => {
  it("aren't read as the English words they look like", () => {
    // German "war" (was) and "Siege" (victories); the English rules called both conflict
    expect(categorizeText('Getötete 13-Jährige in Berlin war offenbar Zufallsopfer')).toBe('conflict')
    expect(categorizeText('Getötete 13-Jährige in Berlin war offenbar Zufallsopfer', '', 'de')).toBeNull()
    expect(categorizeText('Zwei Siege in Folge für Salzburg', '', 'de')).not.toBe('conflict')
    expect(categorizeText('Russell Brand wegen Vergewaltigung schuldig gesprochen', '', 'de')).not.toBe('disaster')
    // French "j'ai" (AI), "inauguration" (of a market), "militants" (activists)
    expect(categorizeText("Mali: «À un moment, j'ai arrêté de compter les décès», témoigne un ancien détenu", '', 'fr')).not.toBe('technology')
    expect(categorizeText("Le ministre procède à l'inauguration du nouveau marché de Daloa", '', 'fr')).toBeNull()
    expect(categorizeText('Les militants du parti se mobilisent à Dakar', '', 'fr')).toBeNull()
    // Spanish "esa" (that) isn't the European Space Agency, Mexican "tenis" are sneakers
    expect(categorizeText('Casi la mitad del camarón que consume España es de Ecuador; esa es la cifra', '', 'es')).toBeNull()
    expect(categorizeText('My Melody y Kuromi llegan a Converse; así son los tenis de la colaboración', '', 'es')).toBeNull()
    // Portuguese "tornado público" (made public), "manga" (a mango)
    expect(categorizeText('O relatório foi tornado público ontem', '', 'pt')).toBeNull()
    expect(categorizeText('Preço da manga sobe nas feiras de Petrolina', '', 'pt')).not.toBe('culture')
  })

  it("doesn't take a figure of speech, a rank or an exam for the thing", () => {
    expect(categorizeText('Enseignants-chercheurs : la grève universitaire entre dans sa troisième semaine', '', 'fr')).not.toBe('science')
    expect(categorizeText("Décès du père du Président de la République : le Général d'Armée Assimi Goïta endeuillé", '', 'fr')).not.toBe('conflict')
    expect(categorizeText("La Côte d'Ivoire renforce son offensive de conquête du marché britannique", '', 'fr')).not.toBe('conflict')
    expect(categorizeText('Bac 2026 : 150 000 candidats au baccalauréat cette année', '', 'fr')).not.toBe('elections')
    expect(categorizeText('Turismo abre concurso público com 45 oportunidades para candidatos qualificados', '', 'pt')).not.toBe('elections')
  })

  it('reads "IA" and "KI" only as written: a Portuguese "ia" is "went"', () => {
    expect(categorizeText('Governo espera que IA possa ajudar a criar habitação', '', 'pt')).toBe('technology')
    expect(categorizeText('AT&S meldet Rekordumsatz: KI-Boom', '', 'de')).toBe('technology')
    expect(categorizeText('O homem que ia ao mercado foi detido', '', 'pt')).not.toBe('technology')
  })
})

describe('where the words are read', () => {
  it("reads a language's own words in the headline only: its summaries name a footer's Internet or a war's toll", () => {
    expect(categorizeText('Bamako mérite mieux', 'Retrouvez nos articles sur Internet et sur notre application.', 'fr')).toBeNull()
    expect(categorizeText('Bamako mérite mieux', 'Après la guerre, la ville se reconstruit.', 'fr')).toBeNull()
  })

  it('reads English as before, and the other languages only for their own reports', () => {
    expect(categorizeText('Earthquake hits Turkey')).toBe('disaster')
    expect(categorizeText('Krieg in der Ukraine')).toBeNull()
    expect(categorizeText('Krieg in der Ukraine', '', 'de')).toBe('conflict')
    // a language without its own words reads English only
    expect(categorizeText('Krieg in der Ukraine', '', 'it')).toBeNull()
  })

  it("is the reader's topic for a report in its feed's language", () => {
    expect(detectNewsCategory('Sénégal : au moins 34 morts dans un naufrage de migrants', '', 'geopolitics', 'fr')).toBe('disaster')
    expect(detectNewsCategory('Bamako mérite mieux', '', 'geopolitics', 'fr')).toBe('geopolitics')
  })
})
