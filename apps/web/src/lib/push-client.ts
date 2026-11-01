/**
 * Push alerts in the reader's browser (Oct 31, 2026; Devon, 11:11 PM: "Yes"
 * to web push). No account: the browser makes a push subscription with the
 * server's public key, and the API (apps/api routes/push.ts) keeps it with
 * what the reader asked for, breaking news and countries. The server sends a
 * story once it's verified (apps/api lib/push-scan.ts) and public/sw.js
 * shows it. Works in Chrome, Edge and Firefox, Safari on the Mac, and on
 * iPhone and iPad (16.4 and later) once WorldPulse is on the Home Screen.
 */

export const PUSH_API = `${process.env.NEXT_PUBLIC_API_URL || 'https://api.world-pulse.io'}/api/v1/push`

/** ok: it can; ios-home-screen: iPhone or iPad in the browser, which can only from the Home Screen; unsupported: it can't */
export type PushSupport = 'ok' | 'ios-home-screen' | 'unsupported'

export interface PushState {
  subscribed: boolean
  breaking: boolean
  countries: string[]
}

export const PUSH_OFF: PushState = { subscribed: false, breaking: false, countries: [] }

interface NavLike { userAgent?: string; platform?: string; maxTouchPoints?: number; standalone?: boolean; serviceWorker?: unknown }
interface WinLike { matchMedia?: (q: string) => { matches: boolean }; PushManager?: unknown; Notification?: unknown }

/** Whether this browser can take push alerts (iPhone and iPad only from the Home Screen) */
export function pushSupport(nav: NavLike | undefined, win: WinLike | undefined): PushSupport {
  if (!nav || !win) return 'unsupported'
  const ua = String(nav.userAgent || '')
  // iPadOS asks for the desktop site and calls itself a Mac, with a touch screen
  const ios = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && Number(nav.maxTouchPoints || 0) > 1)
  const standalone = nav.standalone === true || (typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches)
  if (ios && !standalone) return 'ios-home-screen'
  return 'serviceWorker' in nav && 'PushManager' in win && 'Notification' in win ? 'ok' : 'unsupported'
}

/** A base64url key as the bytes PushManager.subscribe takes */
export function keyBytes(b64u: string): Uint8Array {
  const b64 = (b64u + '='.repeat((4 - (b64u.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Whether two keys are the same bytes */
export function sameKey(a: ArrayBuffer | Uint8Array | null | undefined, b: Uint8Array): boolean {
  if (!a) return false
  const x = a instanceof Uint8Array ? a : new Uint8Array(a)
  return x.length === b.length && x.every((v, i) => v === b[i])
}

/** What a browser asks for after a press: the breaking-news switch, or one country added or taken away */
export function nextWant(state: PushState, press: { breaking: true } | { country: string }): { breaking: boolean; countries: string[] } {
  if ('breaking' in press) {
    const on = state.subscribed && state.breaking
    return { breaking: !on, countries: state.subscribed ? state.countries : [] }
  }
  const has = state.subscribed && state.countries.includes(press.country)
  const countries = state.subscribed ? state.countries.filter(c => c !== press.country) : []
  return { breaking: state.subscribed ? state.breaking : false, countries: has ? countries : [...countries, press.country] }
}

/** Why turning alerts on didn't work, in the reader's words */
export class PushError extends Error {
  constructor(public reason: 'denied' | 'dismissed' | 'failed') {
    super(reason)
  }
}

export function pushErrorText(e: unknown): string {
  const reason = e instanceof PushError ? e.reason : 'failed'
  if (reason === 'denied') return 'Notifications are blocked for WorldPulse in this browser’s settings. Allow them there, then try again.'
  if (reason === 'dismissed') return 'Alerts stay off: the browser’s question was closed without an answer.'
  return 'Alerts couldn’t be turned on just now. Please try again in a minute.'
}

async function post(path: string, body: unknown): Promise<PushState> {
  const res = await fetch(`${PUSH_API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new PushError('failed')
  const d = (await res.json()) as { data?: PushState }
  return d.data ?? PUSH_OFF
}

/** The server's public key, fetched ahead so a press goes straight to the browser's question */
export async function getKey(): Promise<string> {
  const res = await fetch(`${PUSH_API}/key`)
  if (!res.ok) throw new PushError('failed')
  const d = (await res.json()) as { data?: { publicKey?: string } }
  if (!d.data?.publicKey) throw new PushError('failed')
  return d.data.publicKey
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
  return navigator.serviceWorker.ready
}

/** This browser's push subscription, if it has one */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration()
  return reg ? reg.pushManager.getSubscription() : null
}

/** What the server has for this browser */
export async function readState(): Promise<PushState> {
  const sub = await currentSubscription()
  return sub ? post('status', { endpoint: sub.endpoint }) : PUSH_OFF
}

/**
 * Turn alerts on, or change what they're for. Call it straight from the press:
 * browsers (Safari above all) ask the reader only in answer to a tap or click.
 */
export async function turnOn(want: { breaking: boolean; countries: string[] }, key: string): Promise<PushState> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new PushError(permission === 'denied' ? 'denied' : 'dismissed')
  const reg = await registration()
  const bytes = keyBytes(key)
  let sub = await reg.pushManager.getSubscription()
  // made with an older key (the server's secret changed): start again
  if (sub && !sameKey(sub.options?.applicationServerKey ?? null, bytes)) {
    await sub.unsubscribe().catch(() => false)
    sub = null
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes as BufferSource })
  return post('subscribe', { subscription: sub.toJSON(), ...want })
}

/** Turn alerts off on this browser */
export async function turnOff(): Promise<PushState> {
  const sub = await currentSubscription()
  if (!sub) return PUSH_OFF
  const state = await post('unsubscribe', { endpoint: sub.endpoint }).catch(() => PUSH_OFF)
  await sub.unsubscribe().catch(() => false)
  return state
}
