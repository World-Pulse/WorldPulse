# Verified Source Packs

Verified Source Packs are cryptographically signed JSON bundles containing WorldPulse's latest verified signals. Each bundle is signed with an Ed25519 private key so that any downstream consumer — AI agent pipeline, news aggregator, or fact-checker — can independently verify that the data originated from WorldPulse and has not been tampered with in transit. The signature covers the entire bundle payload (including `bundle_id`, `generated_at`, and all signal fields), providing end-to-end integrity guarantees with no external dependency beyond Node.js's built-in `crypto` module.

---

## Quick Start

### Fetch and verify with curl

```bash
# 1. Fetch the current bundle
curl -s https://api.worldpulse.io/api/v1/bundles/current > bundle.json

# 2. Inspect the bundle
cat bundle.json | jq '{bundle_id, generated_at, signal_count: (.signals | length), public_key}'

# 3. Verify the signature via the API
curl -s -X POST https://api.worldpulse.io/api/v1/bundles/verify \
  -H 'Content-Type: application/json' \
  -d @- <<EOF
{
  "bundle":     $(cat bundle.json | jq 'del(.signature, .public_key, .verify_url)'),
  "signature":  "$(cat bundle.json | jq -r '.signature')",
  "public_key": "$(cat bundle.json | jq -r '.public_key')"
}
EOF
```

### Fetch and verify with Node.js

```js
import { createPublicKey, verify } from 'node:crypto'

const res    = await fetch('https://api.worldpulse.io/api/v1/bundles/current')
const signed = await res.json()

const { signature, public_key, verify_url, ...bundle } = signed

// Re-serialise the bundle exactly as the server did
const data      = Buffer.from(JSON.stringify(bundle))
const sig       = Buffer.from(signature, 'base64url')
const publicKey = createPublicKey({
  key:    Buffer.from(public_key, 'base64url'),
  format: 'der',
  type:   'spki',
})

const valid = verify(null, data, publicKey, sig)
console.log('Signature valid:', valid)
console.log('Signals:', bundle.signals.length)
```

### Download as a file

```bash
curl -OJ https://api.worldpulse.io/api/v1/bundles/current.json
# Saves as: worldpulse-signals.json
```

---

## Bundle Schema Reference

```jsonc
{
  // Unique identifier for this bundle (UUIDv4)
  "bundle_id": "550e8400-e29b-41d4-a716-446655440000",

  // ISO 8601 timestamp when the bundle was generated
  "generated_at": "2026-03-26T12:00:00.000Z",

  // Schema version — currently always "1.0"
  "schema_version": "1.0",

  // Array of up to 50 most recent verified signals
  "signals": [
    {
      "id":                "sig_abc123",           // Signal UUID
      "title":             "Magnitude 6.2 earthquake strikes southern Turkey",
      "summary":           "A 6.2-magnitude earthquake struck 40 km south of ...",
      "severity":          "high",                 // critical | high | medium | low | info
      "category":          "disaster",             // conflict | climate | politics | health | ...
      "location_name":     "Gaziantep, Turkey",    // Human-readable location (may be null)
      "country_code":      "TR",                   // ISO 3166-1 alpha-2 (may be null)
      "reliability_score": 0.91,                   // 0.0–1.0 (may be null)
      "alert_tier":        2,                      // 1=breaking, 2=high, 3=standard (may be null)
      "created_at":        "2026-03-26T11:55:00.000Z",
      "url":               "https://worldpulse.io/signals/sig_abc123"
    }
    // ... up to 49 more signals
  ],

  // Bundle-level metadata
  "metadata": {
    "total_count": 50,                             // Number of signals in this bundle
    "source_name": "WorldPulse",
    "source_url":  "https://worldpulse.io",
    "license":     "CC-BY-4.0"                    // Creative Commons Attribution 4.0
  },

  // Ed25519 signature over the bundle JSON (base64url, 86 chars / 64 bytes)
  "signature":   "Abc123...",

  // SPKI DER public key in base64url — use this to verify the signature
  "public_key":  "MCowBQYDK2Vw...",

  // Endpoint to verify this bundle server-side
  "verify_url":  "/api/v1/bundles/verify"
}
```

---

## How to Verify Signatures

The signature is computed as:

```
Ed25519.sign(privateKey, UTF-8(JSON.stringify(bundle)))
```

where `bundle` is the full response object **minus** the `signature`, `public_key`, and `verify_url` fields. The JSON serialisation uses the exact output of `JSON.stringify` — no whitespace normalisation.

### Node.js (TypeScript / ESM)

```ts
import { createPublicKey, verify } from 'node:crypto'

async function verifySignedBundle(signedBundle: Record<string, unknown>): Promise<boolean> {
  const { signature, public_key, verify_url, ...bundle } = signedBundle

  const data = Buffer.from(JSON.stringify(bundle))
  const sig  = Buffer.from(signature as string, 'base64url')

  const publicKey = createPublicKey({
    key:    Buffer.from(public_key as string, 'base64url'),
    format: 'der',
    type:   'spki',
  })

  return verify(null, data, publicKey, sig)
}
```

### Python

```python
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
import base64, json

def verify_bundle(signed_bundle: dict) -> bool:
    bundle = {k: v for k, v in signed_bundle.items()
              if k not in ('signature', 'public_key', 'verify_url')}
    data      = json.dumps(bundle, separators=(',', ':')).encode()
    sig_bytes = base64.urlsafe_b64decode(signed_bundle['signature'] + '==')
    pub_bytes = base64.urlsafe_b64decode(signed_bundle['public_key'] + '==')
    pub_key   = Ed25519PublicKey.from_public_bytes(pub_bytes[-32:])  # last 32 bytes of SPKI
    try:
        pub_key.verify(sig_bytes, data)
        return True
    except Exception:
        return False
```

> **Note for Python**: `json.dumps` with `separators=(',', ':')` is required to match the compact serialisation produced by JavaScript's `JSON.stringify`.

### Retrieve the public key in JWK format

```bash
curl -s https://api.worldpulse.io/api/v1/bundles/public-key | jq .
```

```json
{
  "public_key_b64": "MCowBQYDK2Vw...",
  "public_key_jwk": {
    "kty": "OKP",
    "crv": "Ed25519",
    "x": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"
  },
  "docs_url": "https://worldpulse.io/developer/bundles"
}
```

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/bundles/current` | Latest 50 verified signals (JSON, cached 60 s) |
| `GET` | `/api/v1/bundles/current.json` | Same as above, forces file download |
| `POST` | `/api/v1/bundles/verify` | Server-side signature verification |
| `GET` | `/api/v1/bundles/public-key` | Current public key (DER/base64url + JWK) |

All bundle endpoints allow any CORS origin and require no authentication.

---

## Use Cases

### AI Agent Pipelines

AI agents that consume real-world event data can cryptographically verify that signals originated from WorldPulse before acting on them. This prevents prompt injection via forged event feeds and provides an audit trail.

```js
// LangChain / LLM agent example
const bundle = await fetchAndVerifyBundle()
if (!bundle.valid) throw new Error('Bundle signature invalid — rejecting')
const context = bundle.signals.map(s => `[${s.severity}] ${s.title}`).join('\n')
// Pass verified context to your LLM
```

### News Aggregators

Aggregators can use the `CC-BY-4.0` licensed bundle to populate their own databases with attribution, knowing the data is authentic and unmodified.

### Fact-Checkers

Fact-checking workflows can verify a cached or forwarded bundle against the WorldPulse public key to confirm the signal data has not been altered since publication.

### Offline / Air-Gapped Environments

Download `current.json` and verify locally without network access to the WorldPulse API — the public key is embedded in the bundle itself.
