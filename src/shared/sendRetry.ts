/**
 * Messages to support, bug reports and ideas are tried again while the server restarts (owner, 16.10.2026: a player's
 * report failed with «Сервер недоступен» during a release switch, which takes ten to thirty seconds). Only a request the
 * server never took is tried again: no connection, or the proxy's 502/503/504 in front of a stopped server. A timed-out
 * request may have reached the server, so it is not sent twice.
 */

/** Paths whose POST is tried again: the bug report / idea and the support chat messages (player's and owner's). */
const RETRIED = /^\/v1\/(?:bug-reports|me\/support\/messages|accounts\/me\/admin\/support\/threads\/[a-f0-9]{24}\/messages)$/

export function retriesWhileRestarting(method: string, path: string) {
  return method === 'POST' && RETRIED.test(path)
}

/** Waits between the tries: about 40 s in all, longer than a restart. */
export const SEND_RETRY_DELAYS_MS: readonly number[] = [2_000, 4_000, 8_000, 12_000, 14_000]

/** A proxy's answer while the server behind it is stopped. */
export function restartingStatus(status: number) {
  return status === 502 || status === 503 || status === 504
}

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) })

/** `attempt` again after each delay while `retryable` says the server never took it; the last error otherwise. */
export async function retryWhileRestarting<T>(
  attempt: () => Promise<T>, retryable: (error: unknown) => boolean,
  delays: readonly number[] = SEND_RETRY_DELAYS_MS, wait: (ms: number) => Promise<void> = sleep,
): Promise<T> {
  for (let index = 0; ; index += 1) {
    try {
      return await attempt()
    } catch (error) {
      if (index >= delays.length || !retryable(error)) throw error
      await wait(delays[index]!)
    }
  }
}
