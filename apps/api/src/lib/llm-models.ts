/**
 * llm-models.ts — the non-Claude model names the API uses, in one place.
 * When a provider retires a model, change the default here (or set the env var).
 * Claude's names live in claude.ts (CLAUDE_SMALL, CLAUDE_WRITER).
 *
 * WorldPulse uses no OpenAI account (Oct 16, 2026): the writing is Claude's and
 * the text fingerprints are made in-house (lib/fingerprint.ts). The two OpenAI
 * names below are still read by older analysis modules, which only call OpenAI
 * when an OPENAI_API_KEY is set (the server no longer passes one); they go
 * when those modules are reworked.
 */

/** OpenAI chat model (older analysis modules only; unused without OPENAI_API_KEY) */
export const OPENAI_CHAT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
/** Google Gemini model (2.0-flash shut down 2026-06-01) */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash'
/** OpenAI embedding model (older analysis modules only; unused without OPENAI_API_KEY) */
export const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small'
