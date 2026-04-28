/**
 * Gemini 3.1 intelligence layer for WorldPulse scraper.
 * Uses Gemini Flash for fast, cheap signal enrichment.
 * Falls back gracefully if API key not set.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? ''
const GEMINI_MODEL   = 'gemini-2.0-flash'
const GEMINI_BASE    = 'https://generativelanguage.googleapis.com/v1beta'
const ENABLED        = Boolean(GEMINI_API_KEY)

export interface GeminiEnrichment {
  enhancedSummary: string
  keyEntities:     string[]   // people, orgs, locations mentioned
  threatLevel:     'critical' | 'high' | 'medium' | 'low' | 'info'
  geopoliticalContext: string
  verificationFlags:   string[]  // red flags for misinformation
  confidence:          number    // 0-1
}

/**
 * Enrich a signal using Gemini intelligence analysis.
 * Returns null if Gemini is not configured or the request fails.
 */
export async function enrichSignalWithGemini(
  title: string,
  body:  string,
  locationName?: string | null,
): Promise<GeminiEnrichment | null> {
  if (!ENABLED) return null

  const prompt = `You are an intelligence analyst for a real-time global signals platform.
Analyze this news signal and return a JSON object with these fields:
- enhancedSummary: 2-3 sentence intelligence-grade summary (concise, factual, no speculation)
- keyEntities: array of key named entities (people, organizations, locations, up to 6)
- threatLevel: one of "critical", "high", "medium", "low", "info" based on geopolitical impact
- geopoliticalContext: 1 sentence on broader significance
- verificationFlags: array of potential misinformation indicators (empty if none)
- confidence: 0.0-1.0 confidence this is a real verifiable event

Signal title: ${title}
${locationName ? `Location: ${locationName}` : ''}
Content: ${body.slice(0, 2000)}

Return ONLY valid JSON, no markdown.`

  try {
    const res = await fetch(
      `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature:     0.1,
            maxOutputTokens: 512,
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(8000),
      },
    )

    if (!res.ok) return null

    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return null

    return JSON.parse(text) as GeminiEnrichment
  } catch {
    return null
  }
}

/**
 * Use Gemini to analyze geographic context for the map intelligence layer.
 * Returns enhanced location metadata including country, region, and strategic context.
 */
export async function analyzeLocationIntelligence(
  title: string,
  locationName: string,
): Promise<{ strategicContext: string; affectedRegions: string[]; conflictZone: boolean } | null> {
  if (!ENABLED) return null

  const prompt = `Intelligence analysis: Given this event title and location, return JSON with:
- strategicContext: 1 sentence on strategic/geopolitical significance of this location
- affectedRegions: array of neighboring regions/countries that could be affected (up to 4)
- conflictZone: boolean — is this an active conflict zone or high-tension area?

Title: ${title}
Location: ${locationName}

Return ONLY valid JSON.`

  try {
    const res = await fetch(
      `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
        }),
        signal: AbortSignal.timeout(5000),
      },
    )
    if (!res.ok) return null
    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return null
    return JSON.parse(text) as { strategicContext: string; affectedRegions: string[]; conflictZone: boolean }
  } catch {
    return null
  }
}

export const geminiEnabled = ENABLED
