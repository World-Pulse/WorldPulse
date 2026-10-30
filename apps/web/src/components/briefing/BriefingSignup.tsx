'use client'

/**
 * Sign-up for the 7 AM email briefing, for any visitor (plan G4, Oct 11,
 * 2026). It shows only once the server can send email (GET
 * /api/v1/digest/config), so no one signs up for something that can't
 * arrive. The API emails a confirmation link; the briefing starts once the
 * address's owner taps it. The links in those emails land back on /briefing
 * with ?subscribed= or ?unsubscribed=, which this box answers.
 *
 * Readers pick every morning or once a week (plan G11 slice 2, Oct 30, 2026):
 * the weekly email goes on Mondays at 7 AM with last week's stories as the
 * WorldPulse Week page ranks them, the busiest countries and a link to the page.
 * They can also follow up to 5 countries, whose stories lead each email (plan
 * G13, Oct 30, 2026).
 */

import { useEffect, useMemo, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.world-pulse.io'

type Notice = { tone: 'ok' | 'warn'; text: string }

type Frequency = 'daily' | 'weekly'

/** At most this many followed countries (the API's limit too) */
const MAX_COUNTRIES = 5
/** The countries a reader can follow (ISO codes; the names come from the browser) */
const COUNTRY_CODES = ('AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD '
  + 'CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HK HU IS IN ID IR IQ IE IL IT JM JP JO '
  + 'KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM '
  + 'PK PW PS PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TW TJ TZ TH TL TG TO '
  + 'TT TN TR TM TV UG UA AE GB US UY UZ VU VA VE VN YE ZM ZW').split(' ')

/** "France" for "FR" (the code itself where the browser has no names) */
function countryLabel(code: string): string {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code } catch { return code }
}

/** What the box says for each choice */
const SIGNUP_COPY: Record<Frequency, { choice: string; title: string; blurb: string; button: string }> = {
  daily: {
    choice: 'Every morning',
    title: 'The 7 AM briefing',
    blurb: 'The stories several outlets confirmed overnight, and how many back each one. Free, every morning; one click to unsubscribe.',
    button: 'Get the briefing',
  },
  weekly: {
    choice: 'Once a week',
    title: 'The week, every Monday',
    blurb: 'Last week’s stories that the most outlets confirmed, the busiest countries, and how many back each one. Free, Mondays at 7 AM New York time; one click to unsubscribe.',
    button: 'Get the week',
  },
}

function noticeFromAddress(): Notice | null {
  const q = new URLSearchParams(window.location.search)
  const sub = q.get('subscribed')
  const unsub = q.get('unsubscribed')
  if (sub === '1') return { tone: 'ok', text: 'You’re subscribed. Your first briefing arrives at 7 AM New York time.' }
  if (sub === 'weekly') return { tone: 'ok', text: 'You’re subscribed. Your first weekly email arrives on Monday at 7 AM New York time.' }
  if (sub === 'invalid') return { tone: 'warn', text: 'That confirmation link didn’t work. Sign up again below and use the newest email.' }
  if (unsub === '1') return { tone: 'ok', text: 'You’re unsubscribed. No more briefings will be sent.' }
  if (unsub === 'invalid') return { tone: 'warn', text: 'That unsubscribe link didn’t work. Use the link in your latest briefing.' }
  return null
}

export function BriefingSignup({ source, compact = false, className = '' }: { source: string; compact?: boolean; className?: string }) {
  const [enabled, setEnabled] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [email, setEmail] = useState('')
  const [frequency, setFrequency] = useState<Frequency>('daily')
  const [countries, setCountries] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const countryOptions = useMemo(
    () => (picking ? COUNTRY_CODES.map(code => ({ code, name: countryLabel(code) })).sort((a, b) => a.name.localeCompare(b.name)) : []),
    [picking],
  )
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    setNotice(noticeFromAddress())
    let alive = true
    fetch(`${API_URL}/api/v1/digest/config`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: { data?: { enabled?: boolean } } | null) => { if (alive) setEnabled(Boolean(d?.data?.enabled)) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (state === 'sending') return
    setState('sending')
    try {
      const res = await fetch(`${API_URL}/api/v1/digest/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, frequency, countries, source }),
      })
      const data = await res.json().catch(() => null) as { message?: string; error?: string | { message?: string } } | null
      if (res.ok) {
        setState('sent')
        setMessage(data?.message ?? 'Check your inbox and tap the link to confirm.')
      } else {
        setState('error')
        const err = data?.error
        setMessage(res.status === 429
          ? 'Too many tries. Please wait a minute and try again.'
          : (typeof err === 'string' ? err : err?.message) ?? 'That didn’t work. Please try again.')
      }
    } catch {
      setState('error')
      setMessage('Couldn’t reach WorldPulse. Please check your connection and try again.')
    }
  }

  if (!enabled && !notice) return null

  return (
    <section
      aria-label="The morning briefing by email"
      className={`rounded-xl border border-wp-amber/25 bg-wp-amber/[0.06] ${compact ? 'p-4' : 'p-5'} ${className}`}
    >
      {notice && (
        <p role="status" className={`mb-3 text-[13px] font-medium ${notice.tone === 'ok' ? 'text-wp-green' : 'text-wp-amber'}`}>
          {notice.text}
        </p>
      )}
      {enabled && (
        <>
          <h3 className="font-semibold text-wp-text text-[15px]">{SIGNUP_COPY[frequency].title}</h3>
          <p className="mt-1 text-[13px] text-wp-text2 leading-relaxed">{SIGNUP_COPY[frequency].blurb}</p>
          {state === 'sent' ? (
            <p role="status" className="mt-3 text-[13px] text-wp-green">{message}</p>
          ) : (
            <>
            <div role="radiogroup" aria-label="How often" className="mt-3 inline-flex rounded-lg border border-white/10 bg-black/20 p-0.5">
              {(['daily', 'weekly'] as const).map(f => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={frequency === f}
                  onClick={() => setFrequency(f)}
                  className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ${frequency === f ? 'bg-wp-amber/90 text-black' : 'text-wp-text2 hover:text-wp-text'}`}
                >
                  {SIGNUP_COPY[f].choice}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {countries.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCountries(cs => cs.filter(x => x !== c))}
                  aria-label={`Stop following ${countryLabel(c)}`}
                  className="inline-flex items-center gap-1 rounded-full border border-wp-amber/40 bg-wp-amber/10 px-2.5 py-1 text-[12px] text-wp-text hover:border-wp-amber/70"
                >
                  {countryLabel(c)} <span aria-hidden="true" className="text-wp-text3">×</span>
                </button>
              ))}
              {countries.length < MAX_COUNTRIES && (picking ? (
                <select
                  aria-label="Add a country"
                  autoFocus
                  value=""
                  onChange={e => {
                    const v = e.target.value
                    if (v) setCountries(cs => (cs.includes(v) ? cs : [...cs, v].slice(0, MAX_COUNTRIES)))
                    setPicking(false)
                  }}
                  className="max-w-[220px] rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12.5px] text-wp-text focus:outline-none focus:border-wp-amber/60"
                >
                  <option value="">Add a country…</option>
                  {countryOptions.filter(o => !countries.includes(o.code)).map(o => <option key={o.code} value={o.code}>{o.name}</option>)}
                </select>
              ) : (
                <button type="button" onClick={() => setPicking(true)} className="text-[12.5px] font-medium text-wp-amber hover:underline">
                  {countries.length ? '+ Another country' : '+ Follow your countries (optional)'}
                </button>
              ))}
            </div>
            {countries.length > 0 && (
              <p className="mt-1 text-[11.5px] text-wp-text3">Their stories come first in each email.</p>
            )}
            <form onSubmit={e => { void submit(e) }} className="mt-2.5 flex flex-col sm:flex-row gap-2">
              <label htmlFor={`briefing-email-${source}`} className="sr-only">Email address</label>
              <input
                id={`briefing-email-${source}`}
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={e => { setEmail(e.target.value); if (state === 'error') setState('idle') }}
                placeholder="you@example.com"
                className="flex-1 min-w-0 bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-[14px] text-wp-text placeholder:text-wp-text3 focus:outline-none focus:border-wp-amber/60"
              />
              <button
                type="submit"
                disabled={state === 'sending'}
                className="shrink-0 rounded-lg bg-wp-amber px-4 py-2.5 text-[14px] font-semibold text-black hover:bg-[#ffb84d] disabled:opacity-60 transition-colors"
              >
                {state === 'sending' ? 'Sending…' : SIGNUP_COPY[frequency].button}
              </button>
            </form>
            </>
          )}
          {state === 'error' && <p role="alert" className="mt-2 text-[12px] text-wp-red">{message}</p>}
        </>
      )}
    </section>
  )
}
