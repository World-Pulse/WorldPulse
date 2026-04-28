import {
  generateKeyPairSync,
  sign,
  verify,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
} from 'node:crypto'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface KeyPair {
  privateKey: string  // base64url-encoded PKCS8 DER
  publicKey:  string  // base64url-encoded SubjectPublicKeyInfo DER
}

// ─── Key generation ──────────────────────────────────────────────────────────

/**
 * Generates a fresh Ed25519 key pair.
 * Keys are returned as base64url-encoded DER buffers so they can be
 * stored in environment variables and round-tripped without loss.
 */
export function generateKeyPair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    publicKeyEncoding:  { type: 'spki',  format: 'der' },
  })

  return {
    privateKey: (privateKey as Buffer).toString('base64url'),
    publicKey:  (publicKey  as Buffer).toString('base64url'),
  }
}

// ─── Serialisation helpers ───────────────────────────────────────────────────

function payloadBytes(payload: unknown): Buffer {
  return Buffer.from(JSON.stringify(payload))
}

function importPrivateKey(b64url: string): KeyObject {
  return createPrivateKey({ key: Buffer.from(b64url, 'base64url'), format: 'der', type: 'pkcs8' })
}

function importPublicKey(b64url: string): KeyObject {
  return createPublicKey({ key: Buffer.from(b64url, 'base64url'), format: 'der', type: 'spki' })
}

// ─── Raw key bytes (32 bytes) for JWK export ────────────────────────────────

/**
 * Extracts the raw 32-byte public key from a base64url SPKI DER.
 * SPKI for Ed25519 is always 44 bytes: 12-byte header + 32-byte key.
 */
export function publicKeyToRawBytes(publicKeyB64url: string): Buffer {
  const der = Buffer.from(publicKeyB64url, 'base64url')
  // Ed25519 SPKI DER is exactly 44 bytes; the last 32 are the raw key.
  return der.subarray(der.length - 32)
}

// ─── Sign ────────────────────────────────────────────────────────────────────

/**
 * Signs a payload object with an Ed25519 private key.
 *
 * @param payload     - Any JSON-serialisable value
 * @param privateKey  - base64url-encoded PKCS8 DER private key
 * @returns           base64url-encoded 64-byte signature
 */
export function signBundle(payload: unknown, privateKey: string): string {
  const data = payloadBytes(payload)
  const key  = importPrivateKey(privateKey)
  const sig  = sign(null, data, key)
  return sig.toString('base64url')
}

// ─── Verify ──────────────────────────────────────────────────────────────────

/**
 * Verifies an Ed25519 signature over a payload object.
 *
 * @param payload    - The original payload object (will be JSON-serialised)
 * @param signature  - base64url-encoded signature returned by signBundle()
 * @param publicKey  - base64url-encoded SPKI DER public key
 * @returns          true if the signature is valid, false otherwise
 */
export function verifyBundle(
  payload:   unknown,
  signature: string,
  publicKey: string,
): boolean {
  try {
    const data = payloadBytes(payload)
    const key  = importPublicKey(publicKey)
    const sig  = Buffer.from(signature, 'base64url')
    return verify(null, data, key, sig)
  } catch {
    return false
  }
}
