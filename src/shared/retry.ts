/**
 * Run `task`; if it fails and `shouldRetry(error)` agrees, wait `delayMs` and run it once more.
 * The second failure (or a failure not worth retrying) is thrown to the caller.
 */
export async function retryOnce<T>(task: () => Promise<T>, options: { delayMs?: number; shouldRetry?: (error: unknown) => boolean; onRetry?: (error: unknown) => void } = {}): Promise<T> {
  try {
    return await task()
  } catch (error) {
    if (options.shouldRetry && !options.shouldRetry(error)) throw error
    options.onRetry?.(error)
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
    if (options.shouldRetry && !options.shouldRetry(error)) throw error
    return await task()
  }
}
