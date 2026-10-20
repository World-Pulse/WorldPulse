/**
 * NOAA space weather reports are titled by what happened, not by the
 * message's first header line: every one was called "Space Weather Message
 * Code: WATA20" (or ALTK04, WARK04...).
 */
import { describe, it, expect } from 'vitest'
import { extractAlertTitle, alertSummary } from '../spaceweather'

const msg = (line: string) => `Space Weather Message Code: WATA20\nSerial Number: 1132\nIssue Time: 2026 Oct 20 1912 UTC\n\n${line}\n\nHighest Storm Level Predicted by Day:\nOct 21:  None (Below G1)   Oct 22:  G1 (Minor)\n\nTHIS SUPERSEDES ANY/ALL PRIOR WATCHES IN EFFECT`

describe('extractAlertTitle', () => {
  it('takes the line that says what happened', () => {
    expect(extractAlertTitle(msg('WATCH: Geomagnetic Storm Category G1 Predicted'))).toBe('Space weather watch: Geomagnetic Storm Category G1 Predicted')
    expect(extractAlertTitle(msg('ALERT: Geomagnetic K-index of 4'))).toBe('Space weather alert: Geomagnetic K-index of 4')
    expect(extractAlertTitle(msg('WARNING: Geomagnetic K-index of 5 expected'))).toBe('Space weather warning: Geomagnetic K-index of 5 expected')
    expect(extractAlertTitle(msg('SUMMARY: Geomagnetic Sudden Impulse'))).toBe('Space weather summary: Geomagnetic Sudden Impulse')
  })

  it('says when a warning is extended, an alert continues or a watch is cancelled', () => {
    expect(extractAlertTitle(msg('EXTENDED WARNING: Geomagnetic K-index of 4 expected'))).toBe('Space weather extended warning: Geomagnetic K-index of 4 expected')
    expect(extractAlertTitle(msg('CONTINUED ALERT: Electron 2MeV Integral Flux exceeded 1000pfu'))).toBe('Space weather continued alert: Electron 2MeV Integral Flux exceeded 1000pfu')
    expect(extractAlertTitle(msg('CANCEL WATCH: Geomagnetic Storm Category G1 Predicted'))).toBe('Space weather watch cancelled: Geomagnetic Storm Category G1 Predicted')
  })

  it('never takes a header line, and has a title without a message', () => {
    expect(extractAlertTitle('Space Weather Message Code: XYZ\nSerial Number: 1\nSomething unusual happened')).toBe('Something unusual happened')
    expect(extractAlertTitle('Space Weather Message Code: XYZ\nSerial Number: 1')).toBe('Space weather alert')
    expect(extractAlertTitle('')).toBe('Space weather alert')
  })
})

describe('alertSummary', () => {
  it('leaves out the header lines, and stays within 300 characters', () => {
    const text = alertSummary(msg('WATCH: Geomagnetic Storm Category G1 Predicted'))
    expect(text.startsWith('WATCH: Geomagnetic Storm Category G1 Predicted\nHighest Storm Level Predicted by Day:')).toBe(true)
    expect(text).not.toMatch(/Message Code|Serial Number|Issue Time/)
    expect(alertSummary(msg('x'.repeat(400))).length).toBe(300)
  })
})
