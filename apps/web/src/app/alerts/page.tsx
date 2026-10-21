'use client'

/**
 * Your alerts (plan 10; Devon, Oct 21, 2026: alerts "Free for everyone").
 * Until now this page kept its settings in the browser, where nothing read
 * them, and listed the reader's saved alerts as if they were messages. It
 * now makes, lists and deletes real alerts (GET, POST and DELETE
 * /api/v1/alerts): words, countries and topics to watch, how serious, when
 * (each new report, or once a story is verified by 2, 3 or 5 outlets) and
 * how often (one email a day, or one for each match). The "+ Follow" button
 * on a person's, place's or organisation's page makes one too.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { authHref } from '@/lib/auth-next'
import { authHeaders } from '@/lib/story-follow'
import {
  ALERT_CATEGORIES, SEVERITY_CHOICES, WHEN_CHOICES, EMPTY_FORM, alertBody, describeAlert,
  type AlertForm, type SavedAlert,
} from '@/lib/alert-form'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const MAX_ALERTS = 20

const field = 'w-full bg-wp-s2 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[13px] text-wp-text placeholder:text-wp-text3 focus:outline-none focus:border-wp-amber'
const chip = (on: boolean) => `px-3 py-1.5 rounded-full border text-[12px] transition-all ${on
  ? 'border-wp-amber bg-[rgba(245,166,35,0.1)] text-wp-amber'
  : 'border-[rgba(255,255,255,0.08)] text-wp-text2 hover:border-[rgba(255,255,255,0.18)]'}`

export default function AlertsPage() {
  const [headers, setHeaders] = useState<Record<string, string> | null>(null)
  const [ready, setReady] = useState(false)
  const [alerts, setAlerts] = useState<SavedAlert[]>([])
  const [emailReady, setEmailReady] = useState<boolean | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState<AlertForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    const h = authHeaders(typeof window === 'undefined' ? null : window.localStorage)
    setHeaders(h)
    setReady(true)
    if (!h) return
    fetch(`${API_URL}/api/v1/alerts`, { headers: h })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { success?: boolean; data?: SavedAlert[]; emailReady?: boolean }) => {
        setAlerts(Array.isArray(d.data) ? d.data : [])
        setEmailReady(typeof d.emailReady === 'boolean' ? d.emailReady : null)
      })
      .catch(() => setLoadError('Your alerts could not be loaded. Try again in a minute.'))
  }, [])

  const set = <K extends keyof AlertForm>(key: K, value: AlertForm[K]) => setForm(f => ({ ...f, [key]: value }))

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!headers) return
    const made = alertBody(form)
    if ('error' in made) { setFormError(made.error); return }
    setSaving(true)
    setFormError(null)
    try {
      const res = await fetch(`${API_URL}/api/v1/alerts`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(made.body),
      })
      // the API's one error body: { success: false, code, error, statusCode } (plan V3f)
      const d = await res.json().catch(() => ({})) as { data?: SavedAlert; error?: unknown }
      if (!res.ok || !d.data) {
        setFormError(res.status === 429 ? `You have ${MAX_ALERTS} alerts, the most there can be: delete one first.`
          : typeof d.error === 'string' && d.error ? `The alert could not be saved: ${d.error.replace(/\.$/, '')}.` : 'The alert could not be saved. Try again.')
        return
      }
      setAlerts(list => [d.data!, ...list])
      setForm(EMPTY_FORM)
    } catch {
      setFormError('The alert could not be saved. Try again.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!headers) return
    if (deleting !== id) { setDeleting(id); return }
    const res = await fetch(`${API_URL}/api/v1/alerts/${encodeURIComponent(id)}`, { method: 'DELETE', headers }).catch(() => null)
    setDeleting(null)
    if (res?.ok) setAlerts(list => list.filter(a => a.id !== id))
  }

  if (ready && !headers) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-[22px] font-bold text-wp-text mb-6">Alerts</h1>
        <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-8 text-center">
          <Bell className="w-10 h-10 text-wp-text3 mx-auto mb-3" />
          <div className="text-[16px] font-semibold text-wp-text mb-2">Sign in to set up alerts</div>
          <p className="text-[13px] text-wp-text3 mb-5">Free: get an email when the news you follow is reported, or once it&apos;s verified by several outlets.</p>
          <div className="flex gap-3 justify-center">
            <Link href={authHref('login', '/alerts')} className="px-5 py-2 rounded-lg border border-[rgba(255,255,255,0.15)] text-[13px] text-wp-text2 hover:border-wp-amber hover:text-wp-amber transition-all">Sign In</Link>
            <Link href={authHref('register', '/alerts')} className="px-5 py-2 rounded-lg bg-wp-amber text-black text-[13px] font-bold hover:bg-[#ffb84d] transition-all">Join Free</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-[22px] font-bold text-wp-text">Alerts</h1>
        <p className="text-[13px] text-wp-text3 mt-1">
          Free. An email when the news you follow is reported, or once it&apos;s verified by several independent outlets.
        </p>
        {emailReady === false && (
          <p className="mt-2 text-[12px] text-wp-amber">Alert emails are being switched on: your alerts are saved and will start sending soon.</p>
        )}
      </div>

      {/* ── Your alerts ─────────────────────────────────────────────────── */}
      <section aria-labelledby="your-alerts" className="space-y-2">
        <h2 id="your-alerts" className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase">Your alerts ({alerts.length} of {MAX_ALERTS})</h2>
        {loadError && <p className="text-[13px] text-wp-red">{loadError}</p>}
        {!loadError && alerts.length === 0 && (
          <p className="text-[13px] text-wp-text3">None yet. Make one below, or press &ldquo;+ Follow&rdquo; on a person&apos;s, place&apos;s or organisation&apos;s page.</p>
        )}
        {alerts.map(a => (
          <div key={a.id} className="flex items-start gap-3 p-4 rounded-xl border border-[rgba(255,255,255,0.08)] bg-wp-surface">
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold text-wp-text break-words">{a.name}</div>
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[12px] text-wp-text3">
                {describeAlert(a).map(part => <span key={part}>{part}</span>)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => { void remove(a.id) }}
              onBlur={() => { if (deleting === a.id) setDeleting(null) }}
              className={`shrink-0 px-3 py-1.5 rounded-lg border text-[12px] transition-all ${deleting === a.id
                ? 'border-wp-red text-wp-red' : 'border-[rgba(255,255,255,0.1)] text-wp-text3 hover:text-wp-text2'}`}
            >
              {deleting === a.id ? 'Delete it?' : 'Delete'}
            </button>
          </div>
        ))}
      </section>

      {/* ── A new alert ─────────────────────────────────────────────────── */}
      <form onSubmit={e => { void save(e) }} aria-labelledby="new-alert" className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-5 space-y-5">
        <h2 id="new-alert" className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase">A new alert</h2>

        <label className="block space-y-1.5">
          <span className="text-[13px] text-wp-text">Words or phrases</span>
          <input className={field} value={form.words} onChange={e => set('words', e.target.value)} placeholder="ceasefire, Rafah crossing, IAEA" />
          <span className="block text-[11px] text-wp-text3">Matched as whole words in the headline or summary. Separate them with commas.</span>
        </label>

        <label className="block space-y-1.5">
          <span className="text-[13px] text-wp-text">Countries</span>
          <input className={field} value={form.countries} onChange={e => set('countries', e.target.value)} placeholder="Sudan, Ukraine" />
        </label>

        <fieldset className="space-y-2">
          <legend className="text-[13px] text-wp-text mb-1">Topics</legend>
          <div className="flex flex-wrap gap-2">
            {ALERT_CATEGORIES.map(c => {
              const on = form.categories.includes(c.id)
              return (
                <button key={c.id} type="button" aria-pressed={on} className={chip(on)}
                  onClick={() => set('categories', on ? form.categories.filter(x => x !== c.id) : [...form.categories, c.id])}>
                  {c.label}
                </button>
              )
            })}
          </div>
          <span className="block text-[11px] text-wp-text3">Words, countries and topics all have to match; leave one empty to take everything.</span>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-[13px] text-wp-text mb-1">How serious</legend>
          <div className="flex flex-wrap gap-2">
            {SEVERITY_CHOICES.map(s => (
              <button key={s.id} type="button" aria-pressed={form.minSeverity === s.id} className={chip(form.minSeverity === s.id)} onClick={() => set('minSeverity', s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-[13px] text-wp-text mb-1">When</legend>
          <div className="flex flex-wrap gap-2">
            {WHEN_CHOICES.map(w => (
              <button key={w.id} type="button" aria-pressed={form.when === w.id} title={w.help} className={chip(form.when === w.id)} onClick={() => set('when', w.id)}>
                {w.label}
              </button>
            ))}
          </div>
          <span className="block text-[11px] text-wp-text3">{WHEN_CHOICES.find(w => w.id === form.when)?.help}</span>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-[13px] text-wp-text mb-1">How often</legend>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={form.daily} className={chip(form.daily)} onClick={() => set('daily', true)}>One email a day, 7 AM New York</button>
            <button type="button" aria-pressed={!form.daily} className={chip(!form.daily)} onClick={() => set('daily', false)}>An email each time</button>
          </div>
          {!form.daily && <span className="block text-[11px] text-wp-text3">Up to 20 a day; past that, the rest come in the next morning&apos;s email.</span>}
        </fieldset>

        <label className="block space-y-1.5">
          <span className="text-[13px] text-wp-text">Name <span className="text-wp-text3">(optional)</span></span>
          <input className={field} value={form.name} maxLength={100} onChange={e => set('name', e.target.value)} placeholder="Made from what it watches" />
        </label>

        {formError && <p role="alert" className="text-[13px] text-wp-red">{formError}</p>}
        <button type="submit" disabled={saving || !headers || alerts.length >= MAX_ALERTS}
          className="w-full py-3 rounded-xl bg-wp-amber text-black font-bold text-[14px] hover:bg-[#ffb84d] transition-all disabled:opacity-50">
          {saving ? 'Saving…' : alerts.length >= MAX_ALERTS ? `${MAX_ALERTS} alerts: delete one to add another` : 'Save the alert'}
        </button>
      </form>
    </div>
  )
}
