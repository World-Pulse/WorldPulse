'use client'

/**
 * Push alerts on this device (Oct 31, 2026; lib/push-client.ts): on /alerts,
 * breaking news, a story confirmed by several independent outlets; on a
 * country's page, its major stories. No account. On an iPhone or iPad in the
 * browser it says how to add WorldPulse to the Home Screen, where they work.
 */

import { useEffect, useState } from 'react'
import { Bell, BellRing } from 'lucide-react'
import {
  pushSupport, getKey, readState, turnOn, turnOff, nextWant, pushErrorText, PUSH_OFF,
  type PushSupport, type PushState,
} from '@/lib/push-client'

const HOME_SCREEN = 'On iPhone or iPad: tap Share, then “Add to Home Screen”, and open WorldPulse from your Home Screen to turn alerts on there.'
const UNSUPPORTED = 'This browser can’t show alerts. Chrome, Edge, Firefox and Safari can.'

function countryNames(codes: string[]): string {
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'region' })
    return codes.map(c => names.of(c) ?? c).join(', ')
  } catch {
    return codes.join(', ')
  }
}

function usePush() {
  const [support, setSupport] = useState<PushSupport | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const [state, setState] = useState<PushState>(PUSH_OFF)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    const s = pushSupport(navigator, window as unknown as Parameters<typeof pushSupport>[1])
    setSupport(s)
    if (s !== 'ok') return
    getKey().then(setKey).catch(() => setKey(null))
    readState().then(setState).catch(() => {})
  }, [])

  async function press(p: { breaking: true } | { country: string }, onText: string) {
    if (busy || !key) return
    setBusy(true)
    setNote(null)
    try {
      const want = nextWant(state, p)
      const next = !want.breaking && want.countries.length === 0 ? await turnOff() : await turnOn(want, key)
      setState(next)
      if (next.subscribed && !state.subscribed) setNote(onText)
    } catch (e) {
      setNote(pushErrorText(e))
    } finally {
      setBusy(false)
    }
  }
  return { support, key, state, busy, note, setNote, press }
}

/** The card on /alerts: breaking news on this device */
export function PushAlertsCard() {
  const { support, key, state, busy, note, press } = usePush()
  const on = state.subscribed && state.breaking
  return (
    <section aria-labelledby="device-alerts" className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-5">
      <div className="flex items-start gap-3">
        {on
          ? <BellRing className="w-5 h-5 text-wp-amber flex-shrink-0 mt-0.5" aria-hidden="true" />
          : <Bell className="w-5 h-5 text-wp-text3 flex-shrink-0 mt-0.5" aria-hidden="true" />}
        <div className="flex-1 min-w-0">
          <h2 id="device-alerts" className="text-[15px] font-semibold text-wp-text">Breaking news on this device</h2>
          <p className="text-[13px] text-wp-text3 mt-1">
            A notification when a major story is confirmed by several independent outlets. No account needed; 6 a day at most.
          </p>
          {support === 'ios-home-screen' && <p className="text-[12px] text-wp-amber mt-2">{HOME_SCREEN}</p>}
          {support === 'unsupported' && <p className="text-[12px] text-wp-text3 mt-2">{UNSUPPORTED}</p>}
          {state.subscribed && state.countries.length > 0 && (
            <p className="text-[12px] text-wp-text3 mt-2">Also on for {countryNames(state.countries)} (set on their country pages).</p>
          )}
          {note && <p role="status" className="text-[12px] text-wp-amber mt-2">{note}</p>}
        </div>
        {support === 'ok' && (
          <button
            type="button"
            onClick={() => press({ breaking: true }, 'Alerts are on. A first one is on its way.')}
            disabled={busy || !key}
            aria-pressed={on}
            className={on
              ? 'flex-shrink-0 px-4 py-2 rounded-lg border border-wp-amber text-wp-amber text-[13px] font-semibold hover:bg-[rgba(245,166,35,0.1)] transition-all disabled:opacity-50'
              : 'flex-shrink-0 px-4 py-2 rounded-lg bg-wp-amber text-black text-[13px] font-bold hover:bg-[#ffb84d] transition-all disabled:opacity-50'}
          >
            {busy ? '…' : on ? 'On · Turn off' : 'Turn on'}
          </button>
        )}
      </div>
    </section>
  )
}

/** The button on a country's page: its major stories on this device */
export function PushCountryButton({ code, name }: { code: string; name: string }) {
  const { support, key, state, busy, note, setNote, press } = usePush()
  const on = state.subscribed && state.countries.includes(code)
  if (support === null || support === 'unsupported') return null
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => support === 'ios-home-screen'
          ? setNote(HOME_SCREEN)
          : press({ country: code }, `Alerts are on for ${name}: its major stories, once confirmed.`)}
        disabled={busy || (support === 'ok' && !key)}
        aria-pressed={on}
        title={on ? `Turn off alerts for ${name}` : `Get a notification when a major story in ${name} is confirmed`}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] transition-all disabled:opacity-50 ${on
          ? 'border-wp-amber bg-[rgba(245,166,35,0.1)] text-wp-amber'
          : 'border-[rgba(255,255,255,0.12)] text-wp-text2 hover:border-wp-amber hover:text-wp-amber'}`}
      >
        {on ? <BellRing className="w-3.5 h-3.5" aria-hidden="true" /> : <Bell className="w-3.5 h-3.5" aria-hidden="true" />}
        {busy ? '…' : on ? 'Alerts on' : 'Alerts'}
      </button>
      {note && <p role="status" className="text-[11px] text-wp-text3 max-w-[240px] text-right">{note}</p>}
    </div>
  )
}
