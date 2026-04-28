/**
 * Quick Twitter API connection test.
 * Run: npx tsx apps/api/src/lib/pulse/agents/twitter-test.ts
 *
 * Tests OAuth 1.0a auth by fetching the authenticated user's profile.
 * Does NOT post anything — safe to run repeatedly.
 */
import crypto from 'crypto'

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
}

function buildOAuthHeader(
  method: string,
  url: string,
  apiKey: string,
  apiSecret: string,
  accessToken: string,
  accessSecret: string,
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = crypto.randomBytes(16).toString('hex')

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: '1.0',
  }

  const sortedKeys = Object.keys(oauthParams).sort()
  const paramString = sortedKeys
    .map(k => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`)
    .join('&')

  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(paramString),
  ].join('&')

  const signingKey = `${percentEncode(apiSecret)}&${percentEncode(accessSecret)}`

  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(baseString)
    .digest('base64')

  oauthParams['oauth_signature'] = signature

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(', ')

  return `OAuth ${headerParts}`
}

async function testConnection() {
  console.log('=== PULSE Twitter Connection Test ===\n')

  const apiKey       = process.env.TWITTER_API_KEY
  const apiSecret    = process.env.TWITTER_API_SECRET
  const accessToken  = process.env.TWITTER_ACCESS_TOKEN
  const accessSecret = process.env.TWITTER_ACCESS_SECRET

  // Check env vars
  console.log(`TWITTER_API_KEY:       ${apiKey ? '✓ set (' + apiKey.slice(0, 6) + '...)' : '✗ MISSING'}`)
  console.log(`TWITTER_API_SECRET:    ${apiSecret ? '✓ set (' + apiSecret.slice(0, 6) + '...)' : '✗ MISSING'}`)
  console.log(`TWITTER_ACCESS_TOKEN:  ${accessToken ? '✓ set (' + accessToken.slice(0, 6) + '...)' : '✗ MISSING'}`)
  console.log(`TWITTER_ACCESS_SECRET: ${accessSecret ? '✓ set (' + accessSecret.slice(0, 6) + '...)' : '✗ MISSING'}`)
  console.log()

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    console.log('❌ Missing env vars. Set all 4 TWITTER_* vars and try again.')
    process.exit(1)
  }

  // Test: GET /2/users/me — returns the authenticated user's profile
  const url = 'https://api.x.com/2/users/me'
  const authHeader = buildOAuthHeader('GET', url, apiKey, apiSecret, accessToken, accessSecret)

  console.log('Testing connection to X API...')

  try {
    const res = await fetch(url, {
      headers: { Authorization: authHeader },
    })

    const data = await res.json() as {
      data?: { id: string; name: string; username: string }
      errors?: Array<{ message: string }>
      detail?: string
    }

    if (res.ok && data.data) {
      console.log(`\n✅ Connected! Authenticated as:`)
      console.log(`   Name:     ${data.data.name}`)
      console.log(`   Handle:   @${data.data.username}`)
      console.log(`   User ID:  ${data.data.id}`)
      console.log(`\n🚀 PULSE Twitter agent is ready to post.`)
    } else {
      console.log(`\n❌ Auth failed (HTTP ${res.status}):`)
      console.log(`   ${data.errors?.[0]?.message ?? data.detail ?? JSON.stringify(data)}`)

      if (res.status === 401) {
        console.log('\n   Possible fixes:')
        console.log('   - Regenerate your Access Token with "Read and write" permissions')
        console.log('   - Make sure Consumer Key and Secret match the app')
      }
      if (res.status === 403) {
        console.log('\n   Your app may not have the right permissions.')
        console.log('   Go to developer.x.com → App Settings → User authentication → Read and write')
      }
    }
  } catch (err) {
    console.log(`\n❌ Network error: ${err instanceof Error ? err.message : err}`)
  }
}

testConnection()
