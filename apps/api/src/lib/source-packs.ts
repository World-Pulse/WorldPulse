/**
 * source-packs.ts
 * Cryptographically signed signal bundles for AI agent pipelines.
 *
 * Uses Node.js built-in `crypto` (Ed25519) — no additional npm packages.
 */

import crypto from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { logger } from './logger'

// ─── Exported types ─────────────────────────────────────────────────────────

export interface PackSignal {
  id:                string
  title:             string
  summary:           string | null
  severity:          string
  category:          string
  reliability_score: number
  location_name:     string | null
  country_code:      string | null
  created_at:        string
  url:               string
}

export interface SignedPack {
  id:             string
  version:        '1'
  category:       string
  generated_at:   string
  signal_count:   number
  signals:        PackSignal[]
  signature:      string
  public_key_pem: string  // base64-encoded SPKI DER (despite the name)
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PackSignalInput {
  id:                string
  title:             string
  summary:           string | null
  severity:          string
  category:          string
  reliability_score: number | null
  location_name:     string | null
  country_code:      string | null
  created_at:        string | Date
  url:               string
}

interface Keypair {
  privateKeyPem: string
  publicKeyPem:  string
}

// ─── Key management ─────────────────────────────────────────────────────────

let _cached: Keypair | null = null

/**
 * Returns the Ed25519 keypair. Reads ED25519_PRIVATE_KEY from env (base64-encoded PEM).
 * If the env var is absent, generates a fresh keypair and logs the keys so they
 * can be persisted (useful for first-run/dev environments).
 */
export function getOrCreateKeypair(): Keypair {
  if (_cached) return _cached

  const envKey = process.env.ED25519_PRIVATE_KEY
  if (envKey) {
    // Env stores the PEM base64-encoded to safely embed newlines in env vars
    const privateKeyPem = Buffer.from(envKey, 'base64').toString('utf8')
    const privateKey    = crypto.createPrivateKey(privateKeyPem)
    const publicKey     = crypto.createPublicKey(privateKey)
    const publicKeyPem  = publicKey.export({ type: 'spki', format: 'pem' }) as string
    _cached = { privateKeyPem, publicKeyPem }
    return _cached
  }

  // Generate a fresh keypair and log it so operators can persist it
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  const publicKeyPem  = publicKey.export({ type: 'spki',  format: 'pem' }) as string

  const encodedPrivate = Buffer.from(privateKeyPem).toString('base64')
  const encodedPublic  = Buffer.from(publicKeyPem).toString('base64')

  logger.warn(
    { encodedPrivate, encodedPublic },
    'ED25519_PRIVATE_KEY not set — generated ephemeral keypair. ' +
    'Set ED25519_PRIVATE_KEY (base64-encoded PEM) in your env to persist across restarts.',
  )

  _cached = { privateKeyPem, publicKeyPem }
  return _cached
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Converts standard base64 to base64url (RFC 4648 §5). */
function toBase64Url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Builds a deterministic canonical JSON string (sorted top-level keys). */
function canonicalJson(obj: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key]
  }
  return JSON.stringify(sorted)
}

// ─── Core crypto ────────────────────────────────────────────────────────────

/**
 * Signs a UTF-8 string with the Ed25519 private key.
 * Returns a base64url-encoded signature.
 */
export function signPack(payload: string): string {
  const { privateKeyPem } = getOrCreateKeypair()
  const key       = crypto.createPrivateKey(privateKeyPem)
  const sigBuffer = crypto.sign(null, Buffer.from(payload, 'utf8'), key)
  return toBase64Url(sigBuffer.toString('base64'))
}

/**
 * Verifies a base64url signature against a UTF-8 payload using a PEM public key.
 */
export function verifyPack(
  payload:      string,
  signature:    string,
  publicKeyPem: string,
): boolean {
  try {
    // Restore base64url → base64
    const b64     = signature.replace(/-/g, '+').replace(/_/g, '/')
    const sigBuf  = Buffer.from(b64, 'base64')
    const key     = crypto.createPublicKey(publicKeyPem)
    return crypto.verify(null, Buffer.from(payload, 'utf8'), key, sigBuf)
  } catch {
    return false
  }
}

// ─── Pack builder ───────────────────────────────────────────────────────────

/**
 * Builds a SignedPack from an array of DB signal rows.
 * The `payload` that is signed is the canonical JSON of all fields
 * except `signature` and `public_key_pem`.
 */
export function buildSignedPack(
  signals:   PackSignalInput[],
  category?: string,
): SignedPack {
  const { publicKeyPem } = getOrCreateKeypair()

  const packSignals = signals.map(s => ({
    id:                s.id,
    title:             s.title,
    summary:           s.summary ?? null,
    severity:          s.severity,
    category:          s.category,
    reliability_score: s.reliability_score ?? 0,
    location_name:     s.location_name ?? null,
    country_code:      s.country_code ?? null,
    created_at:        new Date(s.created_at).toISOString(),
    url:               s.url,
  }))

  const partial = {
    id:           randomUUID(),
    version:      '1' as const,
    category:     category ?? 'all',
    generated_at: new Date().toISOString(),
    signal_count: packSignals.length,
    signals:      packSignals,
  }

  // Sign the canonical JSON of the pack payload (excluding signature + public_key_pem)
  const payload   = canonicalJson(partial as unknown as Record<string, unknown>)
  const signature = signPack(payload)

  // Store the public key as base64 DER for easy verification by consumers
  const pubKeyObj    = crypto.createPublicKey(publicKeyPem)
  const pubKeyDer    = pubKeyObj.export({ type: 'spki', format: 'der' }) as Buffer
  const publicKeyB64 = pubKeyDer.toString('base64')

  return {
    ...partial,
    signature,
    public_key_pem: publicKeyB64,
  }
}
