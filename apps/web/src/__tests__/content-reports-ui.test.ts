/**
 * Reporting a post or community (plan C6; Devon, Oct 21, 2026: "Yes, add the
 * table"): where the report goes, and the review list's line on /admin.
 */
import { describe, it, expect } from 'vitest'
import { reportUrl } from '@/components/community/ReportModal'
import { reportLine } from '@/components/admin/ReportReview'

describe('reporting', () => {
  it('a post\'s and a community\'s report go to their own API addresses', () => {
    expect(reportUrl('post', 'abc')).toMatch(/\/api\/v1\/posts\/abc\/report$/)
    expect(reportUrl('community', 'c 1')).toMatch(/\/api\/v1\/communities\/c%201\/report$/)
  })
  it('the review list says how many readers and why, the commonest reason first', () => {
    expect(reportLine(4, { abuse: 1, spam: 3 })).toBe('4 readers: spam 3, abuse 1')
    expect(reportLine(1, {})).toBe('1 reader')
  })
})
