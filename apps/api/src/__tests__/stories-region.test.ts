/**
 * GET /api/v1/stories?region= (Nov 10, 2026, for region_top_stories): a region's stories, one query over its
 * countries (lib/regions.ts), the same ranking as the world's and a country's.
 */
import { describe, it, expect } from 'vitest'
import { REGIONS, REGION_IDS, regionCountries, allRegionCountries } from '../lib/regions'
import { StoryListQuerySchema } from '../lib/query-schemas'
import { storyListSql } from '../routes/stories'

describe('the regions', () => {
  it('are the ones the story list takes', () => {
    expect([...REGION_IDS].sort()).toEqual([...StoryListQuerySchema.shape.region.unwrap().options].sort())
    expect(StoryListQuerySchema.parse({ region: 'middle-east' }).region).toBe('middle-east')
    expect(() => StoryListQuerySchema.parse({ region: 'atlantis' })).toThrow()
  })

  it('hold two-letter codes, each once in a region, Egypt in Africa and the Middle East', () => {
    for (const id of REGION_IDS) {
      const codes = regionCountries(id)
      for (const c of codes) expect(c, `${id} ${c}`).toMatch(/^[A-Z]{2}$/)
      expect(new Set(codes).size, id).toBe(codes.length)
    }
    expect(regionCountries('africa')).toContain('EG')
    expect(regionCountries('middle-east')).toContain('EG')
    expect(regionCountries('europe')).toEqual(expect.arrayContaining(['RU', 'XK', 'UA', 'CY']))
    expect(regionCountries('asia')).toEqual(expect.arrayContaining(['GE', 'AM', 'AZ', 'TW']))
    // every country but Egypt in one region only
    const all = REGION_IDS.flatMap(regionCountries)
    expect(all.length - new Set(all).size).toBe(1)
    expect(allRegionCountries().length).toBeGreaterThan(230)
    expect(REGIONS['middle-east'].label).toBe('the Middle East')
  })
})

describe('the story list query', () => {
  it("takes a region's countries as one binding", () => {
    const sql = storyListSql(true, 'countries')
    expect(sql).toContain('country_code = ANY(?::bpchar[]) AND ')
    expect(storyListSql(true, 'country')).toContain('country_code = ? AND ')
    expect(storyListSql(true)).not.toContain('country_code = ANY')
  })
})
