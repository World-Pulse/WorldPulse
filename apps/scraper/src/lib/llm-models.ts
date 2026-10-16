/**
 * llm-models.ts — the non-Claude model settings the scraper can use, in one place.
 * Claude's names live in claude.ts (CLAUDE_SMALL).
 *
 * WorldPulse itself uses Claude and no OpenAI account (Oct 16, 2026). Without a
 * Claude key, a self-hosted model server that speaks the common chat-completions
 * format (Ollama, vLLM, llama.cpp and the like) can take the AI steps instead:
 * set LLM_API_URL (e.g. http://localhost:11434/v1) and LLM_MODEL, and LLM_API_KEY
 * if the server wants one. Read at call time, so tests can set them.
 */

/** The self-hosted server's base URL, without a trailing slash ('' when unset) */
export function llmApiUrl(): string {
  return (process.env.LLM_API_URL || '').replace(/\/+$/, '')
}
/** The model name to ask the self-hosted server for ('' when unset) */
export function llmModel(): string {
  return process.env.LLM_MODEL || ''
}
/** Optional key for the self-hosted server */
export function llmApiKey(): string {
  return process.env.LLM_API_KEY || ''
}
/** Whether a self-hosted model server is set up (both its URL and a model name) */
export function selfHostedLlmConfigured(): boolean {
  return !!(llmApiUrl() && llmModel())
}
/** Request headers for the self-hosted server */
export function llmHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  const key = llmApiKey()
  if (key) h.Authorization = `Bearer ${key}`
  return h
}

/** Google Gemini model (2.0-flash shut down 2026-06-01) */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash'
