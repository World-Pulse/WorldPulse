import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { logger } from '../lib/logger'
import { sendError } from '../lib/errors'
import {
  generateKeyPair,
  signBundle,
  verifyBundle,
  publicKeyToRawBytes,
} from '../lib/source-pack'

// ─── Constants ───────────────────────────────────────────────────────────────

const BUNDLE_CACHE_TTL = 60  // seconds
const BUNDLE_CACHE_KEY = 'bundle:current'
const SITE_URL         = process.env.SITE_URL ?? 'https://worldpulse.io'

// ─── Signing key ─────────────────────────────────────────────────────────────

interface SigningKeys {
  privateKey: string
  publicKey:  string
}

function loadSigningKeys(): SigningKeys {
  const envKey = process.env.WP_SIGNING_PRIVATE_KEY
  if (envKey) {
    // Derive public key from private key stored in env.
    // The private key env var stores only the PKCS8 DER private key.
    // We need to also store/derive the public key.
    // Convention: WP_SIGNING_PUBLIC_KEY companion var.
    const pubEnv = process.env.WP_SIGNING_PUBLIC_KEY
    if (!pubEnv) {
      // Derive from private — import then export public.
      const { createPrivateKey } = require('node:crypto') as typeof import('node:crypto')
      const keyObj  = createPrivateKey({ key: Buffer.from(envKey, 'base64url'), format: 'der', type: 'pkcs8' })
      const pubDer  = keyObj.export({ type: 'spki', format: 'der' }) as Buffer
      return { privateKey: envKey, publicKey: pubDer.toString('base64url') }
    }
    return { privateKey: envKey, publicKey: pubEnv }
  }

  // Ephemeral key — different on every process start.
  logger.warn(
    'WP_SIGNING_PRIVATE_KEY is not set — generating ephemeral Ed25519 key. ' +
    'Bundles will have different public keys on each process restart. ' +
    'Set WP_SIGNING_PRIVATE_KEY (and WP_SIGNING_PUBLIC_KEY) for stable signing.',
  )
  return generateKeyPair()
}

const SIGNING_KEYS: SigningKeys = loadSigningKeys()

// ─── Row type ────────────────────────────────────────────────────────────────

interface SignalRow {
  id:                string
  title:             string
  summary:           string | null
  severity:          string
  category:          string
  location_name:     string | null
  country_code:      string | null
  reliability_score: number | null
  alert_tier:        number | null
  created_at:        string | Date
}

// ─── Bundle builder ──────────────────────────────────────────────────────────

interface BundleSignal {
  id:                string
  title:             string
  summary:           string | null
  severity:          string
  category:          string
  location_name:     string | null
  country_code:      string | null
  reliability_score: number | null
  alert_tier:        number | null
  created_at:        string
  url:               string
}

interface BundlePayload {
  bundle_id:      string
  generated_at:   string
  schema_version: '1.0'
  signals:        BundleSignal[]
  metadata: {
    total_count: number
    source_name: string
    source_url:  string
    license:     string
  }
}

async function buildBundle(): Promise<BundlePayload> {
  const rows: SignalRow[] = await db('signals')
    .select([
      'id', 'title', 'summary', 'severity', 'category',
      'location_name', 'country_code', 'reliability_score',
      'alert_tier', 'created_at',
    ])
    .where('status', 'verified')
    .orderBy('created_at', 'desc')
    .limit(50)

  const signals: BundleSignal[] = rows.map((r) => ({
    id:                r.id,
    title:             r.title,
    summary:           r.summary,
    severity:          r.severity,
    category:          r.category,
    location_name:     r.location_name,
    country_code:      r.country_code,
    reliability_score: r.reliability_score,
    alert_tier:        r.alert_tier,
    created_at:        new Date(r.created_at).toISOString(),
    url:               `${SITE_URL}/signals/${r.id}`,
  }))

  return {
    bundle_id:      randomUUID(),
    generated_at:   new Date().toISOString(),
    schema_version: '1.0',
    signals,
    metadata: {
      total_count: signals.length,
      source_name: 'WorldPulse',
      source_url:  SITE_URL,
      license:     'CC-BY-4.0',
    },
  }
}

// ─── Signed response builder ─────────────────────────────────────────────────

interface SignedResponse extends BundlePayload {
  signature:  string
  public_key: string
  verify_url: string
}

function signedResponse(bundle: BundlePayload): SignedResponse {
  const signature = signBundle(bundle, SIGNING_KEYS.privateKey)
  return {
    ...bundle,
    signature,
    public_key: SIGNING_KEYS.publicKey,
    verify_url: '/api/v1/bundles/verify',
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export const registerBundleRoutes: FastifyPluginAsync = async (app) => {

  // Tag all routes for Swagger
  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['bundles']
  })

  // Override CORS for this entire plugin — allow any origin.
  app.addHook('onSend', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
  })

  // ── GET /current ────────────────────────────────────────────────────────────
  app.get('/current', {
    schema: {
      summary: 'Latest verified signal bundle (signed)',
      description:
        'Returns the 50 most recent verified signals as a signed bundle. ' +
        'The `signature` field is an Ed25519 signature over the bundle JSON. ' +
        'Verify authenticity with POST /api/v1/bundles/verify.',
      response: {
        200: { type: 'object', additionalProperties: true },
      },
    },
  }, async (_req, reply) => {
    // Try cache first
    const cached = await redis.get(BUNDLE_CACHE_KEY)
    if (cached) {
      return reply
        .header('Content-Type', 'application/json')
        .header('X-Cache', 'HIT')
        .send(cached)
    }

    const bundle   = await buildBundle()
    const response = signedResponse(bundle)
    const json     = JSON.stringify(response)

    await redis.setex(BUNDLE_CACHE_KEY, BUNDLE_CACHE_TTL, json)

    return reply
      .header('Content-Type', 'application/json')
      .header('X-Cache', 'MISS')
      .send(json)
  })

  // ── GET /current.json ────────────────────────────────────────────────────────
  app.get('/current.json', {
    schema: {
      summary: 'Download verified signal bundle as JSON file',
      description: 'Same as GET /current but forces a file download.',
      response: {
        200: { type: 'object', additionalProperties: true },
      },
    },
  }, async (_req, reply) => {
    const cached = await redis.get(BUNDLE_CACHE_KEY)
    const json   = cached ?? JSON.stringify(signedResponse(await buildBundle()))

    if (!cached) {
      await redis.setex(BUNDLE_CACHE_KEY, BUNDLE_CACHE_TTL, json)
    }

    return reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', 'attachment; filename="worldpulse-signals.json"')
      .send(json)
  })

  // ── POST /verify ─────────────────────────────────────────────────────────────
  app.post<{
    Body: { bundle: BundlePayload; signature: string; public_key: string }
  }>('/verify', {
    schema: {
      summary: 'Verify a signed bundle',
      description: 'Verifies the Ed25519 signature on a bundle returned by GET /current.',
      body: {
        type: 'object',
        required: ['bundle', 'signature', 'public_key'],
        properties: {
          bundle:     { type: 'object', additionalProperties: true },
          signature:  { type: 'string' },
          public_key: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        400: { type: 'object', additionalProperties: true },
      },
    },
  }, async (req, reply) => {
    const { bundle, signature, public_key } = req.body

    if (!bundle || !signature || !public_key) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Missing required fields: bundle, signature, public_key')
    }

    const valid = verifyBundle(bundle, signature, public_key)

    return reply.send({
      valid,
      bundle_id:    (bundle as BundlePayload).bundle_id   ?? null,
      generated_at: (bundle as BundlePayload).generated_at ?? null,
      signal_count: (bundle as BundlePayload).signals?.length ?? null,
    })
  })

  // ── GET /public-key ──────────────────────────────────────────────────────────
  app.get('/public-key', {
    schema: {
      summary: 'Current Ed25519 public key',
      description:
        'Returns the public key used to sign bundles in DER/base64url and JWK formats.',
      response: {
        200: { type: 'object', additionalProperties: true },
      },
    },
  }, async (_req, reply) => {
    const rawBytes = publicKeyToRawBytes(SIGNING_KEYS.publicKey)

    return reply.send({
      public_key_b64: SIGNING_KEYS.publicKey,
      public_key_jwk: {
        kty: 'OKP',
        crv: 'Ed25519',
        x:   rawBytes.toString('base64url'),
      },
      docs_url: 'https://worldpulse.io/developer/bundles',
    })
  })
}
