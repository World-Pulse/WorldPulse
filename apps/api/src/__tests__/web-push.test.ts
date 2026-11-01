/**
 * Web push (lib/web-push.ts, Oct 31, 2026): the message encryption checked
 * against RFC 8291's own worked example, the VAPID signature against the
 * public key it sends, the key pair made from the server's secret, and the
 * addresses it will send to.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createPublicKey, verify, createECDH, hkdfSync, createDecipheriv } from 'node:crypto'
import {
  encryptPush, vapidKeys, vapidAuthorization, isPushEndpoint, validKeys, classifyStatus, pushTopic, sendPush,
  fromB64u, b64u, VAPID_SUBJECT,
} from '../lib/web-push'

const v = (s: string) => fromB64u(s.replace(/\s+/g, ''))

// RFC 8291, Appendix A (the example of Section 5)
const RFC = {
  plaintext: v('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'),
  asPrivate: v('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: v('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94'),
  salt: v('DGv6ra1nlYgDCS1FRnbzlw'),
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  header: v('DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8'),
  ciphertext: v('8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs bI_0LpXMuGvnzQ'),
}

/** What a browser does with a message: the receiver's side of RFC 8291 */
function decryptAsBrowser(body: Buffer, uaPrivate: Buffer, uaPublic: Buffer, auth: Buffer): Buffer {
  const salt = body.subarray(0, 16)
  const idlen = body.readUInt8(20)
  const asPublic = body.subarray(21, 21 + idlen)
  const sealed = body.subarray(21 + idlen)
  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(uaPrivate)
  const secret = ecdh.computeSecret(asPublic)
  const ikm = Buffer.from(hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0', 'latin1'), uaPublic, asPublic]), 32))
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'latin1'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'latin1'), 12))
  const d = createDecipheriv('aes-128-gcm', cek, nonce)
  d.setAuthTag(sealed.subarray(sealed.length - 16))
  const plain = Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()])
  expect(plain[plain.length - 1]).toBe(2)
  return plain.subarray(0, plain.length - 1)
}

describe('encryptPush (RFC 8291)', () => {
  it("matches RFC 8291's worked example byte for byte: the 86-byte header, then the ciphertext", () => {
    const body = encryptPush(RFC.plaintext, RFC.uaPublic, RFC.auth, { salt: RFC.salt, asPrivate: RFC.asPrivate })
    expect(RFC.header).toHaveLength(86)
    expect(body.subarray(0, 86).equals(RFC.header)).toBe(true)
    expect(body.equals(Buffer.concat([RFC.header, RFC.ciphertext]))).toBe(true)
  })

  it('makes a message only the browser can read, with a new salt and key each time', () => {
    const ua = createECDH('prime256v1')
    ua.generateKeys()
    const auth = Buffer.alloc(16, 7)
    const text = Buffer.from(JSON.stringify({ title: 'Verified by 3 outlets', url: 'https://world-pulse.io/signals/x' }))
    const a = encryptPush(text, b64u(ua.getPublicKey()), b64u(auth))
    const b = encryptPush(text, b64u(ua.getPublicKey()), b64u(auth))
    expect(a.equals(b)).toBe(false)
    expect(decryptAsBrowser(a, ua.getPrivateKey(), ua.getPublicKey(), auth).toString()).toBe(text.toString())
    expect(decryptAsBrowser(b, ua.getPrivateKey(), ua.getPublicKey(), auth).toString()).toBe(text.toString())
  })

  it('refuses keys that are not a P-256 point and a 16-byte secret', () => {
    expect(() => encryptPush(Buffer.from('x'), b64u(Buffer.alloc(64, 1)), RFC.auth)).toThrow()
    expect(validKeys(RFC.uaPublic, RFC.auth)).toBe(true)
    expect(validKeys(RFC.uaPublic, b64u(Buffer.alloc(8)))).toBe(false)
    expect(validKeys('not base64!', RFC.auth)).toBe(false)
  })
})

describe('the server key pair (VAPID, RFC 8292)', () => {
  beforeEach(() => { delete process.env.WEB_PUSH_SECRET; process.env.JWT_SECRET = 'test-secret-one' })

  it('is made from the server secret: the same secret gives the same key, another secret another', () => {
    const a = vapidKeys().publicKeyB64
    expect(fromB64u(a)).toHaveLength(65)
    expect(fromB64u(a)[0]).toBe(4)
    expect(vapidKeys().publicKeyB64).toBe(a)
    process.env.JWT_SECRET = 'test-secret-two'
    expect(vapidKeys().publicKeyB64).not.toBe(a)
    process.env.WEB_PUSH_SECRET = 'test-secret-one'
    expect(vapidKeys().publicKeyB64).toBe(a)
  })

  it("signs a JWT for the push service's origin that its public key verifies, valid 12 hours", () => {
    const now = Date.parse('2026-11-01T03:00:00Z')
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc:def', now)
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=([A-Za-z0-9_-]+)$/.exec(header)
    expect(m).not.toBeNull()
    const [, h, c, s, k] = m!
    expect(JSON.parse(fromB64u(h!).toString())).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(JSON.parse(fromB64u(c!).toString())).toEqual({ aud: 'https://fcm.googleapis.com', exp: now / 1000 + 12 * 3600, sub: VAPID_SUBJECT })
    const pub = fromB64u(k!)
    expect(k).toBe(vapidKeys().publicKeyB64)
    const key = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) } })
    expect(verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, fromB64u(s!))).toBe(true)
  })
})

describe('where it sends', () => {
  it('sends only to the push services browsers use', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/dKz:APA91b',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB',
      'https://wns2-bl2p.notify.windows.com/w/?token=BQYAAAB',
      'https://web.push.apple.com/QGuQyavXutnMH9Op',
    ]) expect(isPushEndpoint(ok), ok).toBe(true)
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://fcm.googleapis.com.evil.io/x',
      'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://api.world-pulse.io/api/v1/admin',
      'not a url', 42, `https://fcm.googleapis.com/${'x'.repeat(1100)}`,
    ]) expect(isPushEndpoint(bad), String(bad)).toBe(false)
  })

  it("reads the push service's answer: delivered, gone, try later or refused", () => {
    expect(classifyStatus(201)).toBe('sent')
    expect(classifyStatus(410)).toBe('gone')
    expect(classifyStatus(404)).toBe('gone')
    expect(classifyStatus(429)).toBe('retry')
    expect(classifyStatus(503)).toBe('retry')
    expect(classifyStatus(403)).toBe('failed')
    expect(pushTopic('story-123')).toMatch(/^[A-Za-z0-9_-]{32}$/)
  })

  it('posts one sealed message with the headers push services ask for', async () => {
    process.env.JWT_SECRET = 'test-secret-one'
    const ua = createECDH('prime256v1')
    ua.generateKeys()
    const auth = Buffer.alloc(16, 3)
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(null, { status: 201 }) }) as unknown as typeof fetch
    const r = await sendPush({ endpoint: 'https://web.push.apple.com/abc', p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) },
      { title: 'Hello' }, { ttl: 60, urgency: 'high', topic: pushTopic('s'), fetchImpl })
    expect(r).toEqual({ result: 'sent', status: 201 })
    const h = calls[0]!.init.headers as Record<string, string>
    expect(h['Content-Encoding']).toBe('aes128gcm')
    expect(h.TTL).toBe('60')
    expect(h.Urgency).toBe('high')
    expect(h.Authorization).toMatch(/^vapid t=.+, k=/)
    const body = calls[0]!.init.body as Buffer
    expect(JSON.parse(decryptAsBrowser(body, ua.getPrivateKey(), ua.getPublicKey(), auth).toString())).toEqual({ title: 'Hello' })
  })

  it('never posts to an address that is not a push service', async () => {
    let called = false
    const fetchImpl = (async () => { called = true; return new Response(null, { status: 201 }) }) as unknown as typeof fetch
    const r = await sendPush({ endpoint: 'https://example.com/x', p256dh: RFC.uaPublic, auth: RFC.auth }, { title: 'x' }, { fetchImpl })
    expect(r.result).toBe('gone')
    expect(called).toBe(false)
  })
})
