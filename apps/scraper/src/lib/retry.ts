/**
 * Exponential backoff retry helper.
 *
 * Default schedule: 3 retries with delays of 1 s, 5 s, 30 s (4 total attempts).
 */

const RETRY_DELAYS_MS: readonly number[] = [1_000, 5_000, 30_000]

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  delays: readonly number[] = RETRY_DELAYS_MS,
): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt < delays.length) {
        await sleep(delays[attempt])
      }
    }
  }

  throw lastError
}
