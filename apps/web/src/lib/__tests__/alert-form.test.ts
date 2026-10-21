/**
 * The /alerts page's alerts (plan 10, Oct 21, 2026): what a reader asks for
 * as POST /api/v1/alerts's body (routes/alerts.ts AlertSchema), and a saved
 * alert in a few words.
 */
import { describe, it, expect } from 'vitest'
import { alertBody, countryCodes, describeAlert, splitList, EMPTY_FORM, type AlertForm } from '../alert-form'

const form = (o: Partial<AlertForm>): AlertForm => ({ ...EMPTY_FORM, ...o })

describe('the lists a reader types', () => {
  it('splits on commas, semicolons and lines, each once', () => {
    expect(splitList(' Gaza, ceasefire;  Rafah   crossing\nGAZA ,, ')).toEqual(['Gaza', 'ceasefire', 'Rafah crossing'])
    expect(splitList('')).toEqual([])
  })
  it('countries by name or two-letter code; the unknown are named', () => {
    expect(countryCodes('Ukraine, sd, Sudan')).toEqual({ codes: ['UA', 'SD'], unknown: [] })
    expect(countryCodes('Atlantis, us')).toEqual({ codes: ['US'], unknown: ['Atlantis'] })
    expect(countryCodes('zz').unknown).toEqual(['zz'])
  })
})

describe('the body to save', () => {
  it('an alert that waits for 3 outlets, once a day', () => {
    const made = alertBody(form({ words: 'ceasefire, Rafah crossing', countries: 'Sudan', categories: ['conflict', 'nonsense'], minSeverity: 'high', when: 'verified-3', daily: true }))
    expect(made).toEqual({ body: {
      name: 'ceasefire, Rafah crossing, Sudan, Conflict',
      keywords: ['ceasefire', 'Rafah crossing'], categories: ['conflict'], countries: ['SD'], minSeverity: 'high',
      channels: { email: true, push: false, in_app: true, digest: 'daily', verified: true, min_outlets: 3 },
    } })
  })
  it('each new report, an email each time, with its own name', () => {
    const made = alertBody(form({ name: '  Kyiv  ', countries: 'UA', when: 'report', daily: false }))
    expect('body' in made && made.body).toMatchObject({ name: 'Kyiv', countries: ['UA'], channels: { email: true, push: false, in_app: true } })
    expect('body' in made && made.body.channels).not.toHaveProperty('verified')
    expect('body' in made && made.body.channels).not.toHaveProperty('digest')
  })
  it('says what to fix', () => {
    expect(alertBody(form({}))).toEqual({ error: 'Add words, countries or topics to watch.' })
    expect('error' in alertBody(form({ countries: 'Narnia' })) && alertBody(form({ countries: 'Narnia' }))).toMatchObject({ error: expect.stringContaining('Narnia') })
    expect(alertBody(form({ words: Array.from({ length: 21 }, (_, i) => `w${i}`).join(',') }))).toEqual({ error: 'Up to 20 words or phrases.' })
    expect(alertBody(form({ words: 'x'.repeat(101) }))).toEqual({ error: 'Each word or phrase can have up to 100 characters.' })
  })
  it('a long name is cut to the API\'s 100 characters', () => {
    const made = alertBody(form({ words: Array.from({ length: 20 }, (_, i) => `keyword number ${i}`).join(', ') }))
    expect('body' in made && made.body.name.length).toBe(100)
  })
})

describe('a saved alert in a few words', () => {
  it('what it watches, how serious, when and how often', () => {
    expect(describeAlert({ id: '1', name: 'Follow: NATO', keywords: ['NATO'], min_severity: 'low', channels: { email: true, digest: 'daily' } }))
      .toEqual(['Words: NATO', 'Everything', 'Each new report', 'One email a day'])
    expect(describeAlert({ id: '2', name: 'Sudan', countries: ['SD'], categories: ['conflict'], min_severity: 'high', channels: '{"email":true,"verified":true,"min_outlets":3}' }))
      .toEqual(['Countries: Sudan', 'Topics: Conflict', 'High and above', 'Once verified by 3+ outlets', 'An email each time (20 a day at most)'])
    expect(describeAlert({ id: '3', name: 'x', channels: null })).toEqual(['Medium and above', 'Each new report', 'An email each time (20 a day at most)'])
  })
})
