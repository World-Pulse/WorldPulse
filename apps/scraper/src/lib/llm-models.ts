/**
 * llm-models.ts — the non-Claude model names the scraper uses, in one place.
 * When a provider retires a model, change the default here (or set the env var).
 * Claude's names live in claude.ts (CLAUDE_SMALL).
 */

/** OpenAI chat model: classification, verification, entity extraction */
export const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini'
/** Google Gemini model (2.0-flash shut down 2026-06-01) */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash'
