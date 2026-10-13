/**
 * Entity page addresses (lib/entity-links.ts, Oct 13, 2026):
 * /entities/<name>-<id>, the id after the last dash.
 */
import { describe, it, expect } from 'vitest'
import { entitySlug, entityPath, entityIdFromSlug, entityTypeLabel } from '../entity-links'

describe('entity page addresses', () => {
  it('turns names into plain lowercase words', () => {
    expect(entitySlug('Médecins Sans Frontières')).toBe('medecins-sans-frontieres')
    expect(entitySlug('AT&T')).toBe('at-and-t')
    expect(entitySlug('  U.S. Department of Defense ')).toBe('u-s-department-of-defense')
    expect(entitySlug('东京')).toBe('')
  })

  it('puts the id last, so the page can find the entity whatever the name', () => {
    expect(entityPath('a84d671cb97c1d91', 'Houthis')).toBe('/entities/houthis-a84d671cb97c1d91')
    expect(entityPath('a84d671cb97c1d91', '东京')).toBe('/entities/a84d671cb97c1d91')
    expect(entityIdFromSlug('houthis-a84d671cb97c1d91')).toBe('a84d671cb97c1d91')
    expect(entityIdFromSlug('a84d671cb97c1d91')).toBe('a84d671cb97c1d91')
    expect(entityIdFromSlug('old-name-a84d671cb97c1d91')).toBe('a84d671cb97c1d91')
  })

  it('refuses addresses without an id', () => {
    expect(entityIdFromSlug('houthis-')).toBeNull()
    expect(entityIdFromSlug('%E0%A4%A')).toBeNull()
    expect(entityIdFromSlug('x-<script>')).toBeNull()
  })

  it('names the kinds in plain words', () => {
    expect(entityTypeLabel('organisation')).toBe('Organization')
    expect(entityTypeLabel('weapon_system')).toBe('Weapon system')
    expect(entityTypeLabel('something')).toBe('Entity')
  })
})
