/**
 * llm-models.ts — the non-Claude model names the API uses, in one place.
 * When a provider retires a model, change the default here (or set the env var).
 * Claude's names live in claude.ts (CLAUDE_SMALL, CLAUDE_WRITER).
 */

/** OpenAI chat model: summaries, thread summaries, briefing fallback */
export const OPENAI_CHAT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
/** OpenAI model for PULSE posts */
export const PULSE_OPENAI_MODEL = process.env.PULSE_OPENAI_MODEL || OPENAI_CHAT_MODEL
/** Google Gemini model (2.0-flash shut down 2026-06-01) */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash'
