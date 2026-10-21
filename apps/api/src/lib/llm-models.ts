/**
 * llm-models.ts — the model names the API uses and Claude's prices, in one place.
 * When a provider retires a model, change the default here (or set the env var).
 * Claude's model names live in claude.ts (CLAUDE_SMALL, CLAUDE_WRITER); its prices are here.
 *
 * WorldPulse uses no OpenAI account (Oct 16, 2026): the writing is Claude's and
 * the text fingerprints are made in-house (lib/fingerprint.ts).
 */

/** Google Gemini model (2.0-flash shut down 2026-06-01) */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash'

/** A local Ollama model, when one is set up (summaries and briefings fall back to it) */
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2'

/**
 * Claude's prices, US dollars per million tokens, [input, output], for the
 * monthly cap's count (lib/claude.ts). Haiku 5.5's price is for prompts under
 * 100,000 tokens (Anthropic charges 5x above; WorldPulse's prompts are far
 * shorter). Kept here with the model names (plan 3, Oct 21, 2026).
 */
export const CLAUDE_PRICES: Readonly<Record<string, readonly [number, number]>> = {
  'claude-haiku-5-5':          [0.10, 0.50],
  'claude-sonnet-5-5':         [2, 10],
  'claude-haiku-4-5-20251001': [1, 5],
}
/** A model missing above is counted at the dearest price listed */
export const CLAUDE_UNKNOWN_PRICE: readonly [number, number] = [2, 10]
