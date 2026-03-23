/**
 * Simple semaphore for bounding concurrent async operations.
 *
 * Usage:
 *   const limit = createSemaphore(10)
 *   await Promise.allSettled(items.map(item => limit(() => process(item))))
 */
export function createSemaphore(maxConcurrent: number) {
  if (maxConcurrent < 1) throw new RangeError('maxConcurrent must be >= 1')

  let running = 0
  const queue: Array<() => void> = []

  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (running >= maxConcurrent) {
      await new Promise<void>(resolve => queue.push(resolve))
    }
    running++
    try {
      return await fn()
    } finally {
      running--
      const next = queue.shift()
      if (next) next()
    }
  }
}
