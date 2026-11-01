/**
 * Web push: notifications on readers' computers and phones from the website,
 * with no app and no account (Devon, Oct 31, 2026, 11:11 PM: "Yes" to web
 * push first). It works in Chrome, Edge and Firefox on computers and Android,
 * in Safari on the Mac, and on iPhone and iPad (iOS 16.4 and later) once the
 * site is added to the Home Screen.
 *
 * Three standards, written here with Node's own crypto (no package):
 * - VAPID (RFC 8292): each request is signed with the server's key pair, so
 *   the browser's push service knows the messages come from us. The pair is
 *   derived from the server's secret (WEB_PUSH_SECRET, else JWT_SECRET, as
 *   the email links do), so nobody keeps or pastes a key and it stays the
 *   same across deploys; a new secret means readers turn alerts on again.
 * - Message encryption (RFC 8291, aes128gcm): only the reader's browser can
 *   read a message; the push service carries it sealed.
 * - The push protocol (RFC 8030): one POST to the address the browser gave.
 *   Those addresses are checked against the known push services, so nobody
 *   can make the server send requests elsewhere.
 */

import { createCipheriv, createECDH, createHash, createPrivateKey, hkdfSync, randomBytes, sign, type KeyObject } from 'node:crypto'

/** Who to contact about our messages, as push services ask (support@ reaches Devon) */
export const VAPID_SUBJECT = 'mailto:support@world-pulse.io'
/** How long a signature stays valid (push services refuse more than 24 hours) */
export const VAPID_TTL_S = 12 * 3600
/** The record size written in a message's header (RFC 8188); one record holds a whole message */
const RECORD_SIZE = 4096
/** The longest message we send: push services take 4,096 bytes with the 86-byte header and the 17 bytes encryption adds */
export const MAX_PAYLOAD_BYTES = 3000

const P256_ORDER = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551')

export const b64u = (b: Uint8Array): string => Buffer.from(b).toString('base64url')
export const fromB64u = (s: string): Buffer => Buffer.from(s.replace(/=+$/, ''), 'base64url')

/** The secret the key pair comes from: its own, or the one the email links use (lib/subscribers.ts) */
function seed(): string {
  return process.env.WEB_PUSH_SECRET || process.env.JWT_SECRET || 'dev_secret_change_in_prod'
}

interface VapidKeys {
  /** the 65-byte public key (uncompressed P-256 point) */
  publicKey: Buffer
  /** the same, base64url, as browsers take it (applicationServerKey) */
  publicKeyB64: string
  privateKey: KeyObject
}

let cached: { seedHash: string; keys: VapidKeys } | null = null

/** A P-256 private key from the secret: HKDF, counted on until it falls below the curve's order (almost always the first) */
function deriveScalar(secret: string): Buffer {
  for (let i = 0; i < 64; i++) {
    const d = Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from('worldpulse-web-push'), Buffer.from(`vapid-p256-${i}`), 32))
    const n = BigInt(`0x${d.toString('hex')}`)
    if (n > 0n && n < P256_ORDER) return d
  }
  throw new Error('web push: no key from this secret')
}

/** The server's VAPID key pair (made once per process from the secret) */
export function vapidKeys(): VapidKeys {
  const s = seed()
  const seedHash = createHash('sha256').update(s).digest('hex')
  if (cached?.seedHash === seedHash) return cached.keys
  const d = deriveScalar(s)
  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(d)
  const publicKey = ecdh.getPublicKey()
  const privateKey = createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', d: b64u(d), x: b64u(publicKey.subarray(1, 33)), y: b64u(publicKey.subarray(33, 65)) },
  })
  const keys = { publicKey, publicKeyB64: b64u(publicKey), privateKey }
  cached = { seedHash, keys }
  return keys
}

/** The Authorization header for a request to `endpoint` (RFC 8292: a JWT for the push service's origin, signed ES256) */
export function vapidAuthorization(endpoint: string, now: number = Date.now()): string {
  const { publicKeyB64, privateKey } = vapidKeys()
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64u(Buffer.from(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + VAPID_TTL_S,
    sub: VAPID_SUBJECT,
  })))
  const signed = `${header}.${claims}`
  const signature = sign('sha256', Buffer.from(signed), { key: privateKey, dsaEncoding: 'ieee-p1363' })
  return `vapid t=${signed}.${b64u(signature)}, k=${publicKeyB64}`
}

/**
 * A message sealed for one browser (RFC 8291 with RFC 8188's aes128gcm):
 * the reader's public key (p256dh) and auth secret come with its subscription.
 * `salt` and `asPrivate` are for tests (RFC 8291's Appendix A); left out, both are new for every message.
 */
export function encryptPush(plaintext: Uint8Array, p256dh: string, auth: string, opts: { salt?: Buffer; asPrivate?: Buffer } = {}): Buffer {
  const uaPublic = fromB64u(p256dh)
  const authSecret = fromB64u(auth)
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('web push: bad p256dh')
  if (authSecret.length < 16) throw new Error('web push: bad auth')
  if (plaintext.length > RECORD_SIZE - 17) throw new Error('web push: message too long')
  const salt = opts.salt ?? randomBytes(16)
  const ecdh = createECDH('prime256v1')
  if (opts.asPrivate) ecdh.setPrivateKey(opts.asPrivate)
  else ecdh.generateKeys()
  const asPublic = ecdh.getPublicKey()
  const ecdhSecret = ecdh.computeSecret(uaPublic)
  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'latin1'), uaPublic, asPublic])
  const ikm = Buffer.from(hkdfSync('sha256', ecdhSecret, authSecret, keyInfo, 32))
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'latin1'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'latin1'), 12))
  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  // one record, so the last-record delimiter 0x02 and no padding
  const sealed = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()])
  const header = Buffer.alloc(21)
  salt.copy(header, 0)
  header.writeUInt32BE(RECORD_SIZE, 16)
  header.writeUInt8(asPublic.length, 20)
  return Buffer.concat([header, asPublic, sealed])
}

/** The push services browsers use: Google (Chrome, Edge on Android, Samsung, Opera), Mozilla, Microsoft (Edge on Windows), Apple (Safari) */
const PUSH_HOSTS: RegExp[] = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
]

/** Whether an address is a real push service's (https, a known host, no credentials, no other port) */
export function isPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return false
  try {
    const u = new URL(endpoint)
    return u.protocol === 'https:' && !u.username && !u.password && (u.port === '' || u.port === '443')
      && PUSH_HOSTS.some(h => h.test(u.hostname))
  } catch {
    return false
  }
}

/** Whether a subscription's keys are well formed: a 65-byte P-256 point and a 16-byte auth secret */
export function validKeys(p256dh: unknown, auth: unknown): boolean {
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return false
  if (!/^[A-Za-z0-9_-]+=*$/.test(p256dh) || !/^[A-Za-z0-9_-]+=*$/.test(auth)) return false
  const k = fromB64u(p256dh)
  return k.length === 65 && k[0] === 4 && fromB64u(auth).length === 16
}

export interface PushTarget { endpoint: string; p256dh: string; auth: string }

/** What a send came to: delivered, the subscription is gone (unsubscribed or expired), worth another try later, or refused */
export type PushResult = 'sent' | 'gone' | 'retry' | 'failed'

export function classifyStatus(status: number): PushResult {
  if (status >= 200 && status < 300) return 'sent'
  if (status === 404 || status === 410) return 'gone'
  if (status === 429 || status >= 500) return 'retry'
  return 'failed'
}

/** A push service's Topic header (at most 32 base64url characters): a newer message with the same topic replaces one still waiting */
export function pushTopic(key: string): string {
  return createHash('sha256').update(key).digest('base64url').slice(0, 32)
}

/** Send one message to one subscription */
export async function sendPush(
  target: PushTarget,
  message: object,
  opts: { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; topic?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ result: PushResult; status: number }> {
  if (!isPushEndpoint(target.endpoint) || !validKeys(target.p256dh, target.auth)) return { result: 'gone', status: 0 }
  const json = Buffer.from(JSON.stringify(message))
  if (json.length > MAX_PAYLOAD_BYTES) throw new Error('web push: message too long')
  const body = encryptPush(json, target.p256dh, target.auth)
  try {
    const res = await (opts.fetchImpl ?? fetch)(target.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        TTL: String(opts.ttl ?? 21_600),
        Urgency: opts.urgency ?? 'normal',
        ...(opts.topic ? { Topic: opts.topic } : {}),
        Authorization: vapidAuthorization(target.endpoint),
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    return { result: classifyStatus(res.status), status: res.status }
  } catch {
    return { result: 'retry', status: 0 }
  }
}
