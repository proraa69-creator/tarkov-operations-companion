/**
 * Requests to our server over a path that loses the first packets of a new connection (owner, 15.11.2026: «связь с сервером
 * не должна обрываться… люди хотят написать поддержку или отправить скриншот, а у них не получается»). Measured that day:
 * from the owner's PC (Cloudflare WARP) a new TCP connection to raidos.app took ~20 s in two tries of three (the OS resends
 * the lost SYN after 3, 6 and 12 s), while check-host.net's nodes in 12 countries connected in 0.1–0.3 s and the server
 * answered in 0.3 s once connected. The app gave the health check 3 s and the account 5 s, so such a PC saw «нет связи».
 *
 * `hedgedFetch`: a read that has no answer after `hedgeMs` goes once more on a new connection, up to `attempts` in all; the
 * first answer wins and the others are aborted (a new connection is what helps: it is a new chance for the first packet).
 * Only for requests that may run twice (GET). `warmConnection` does it for a /health read before a write, so the write
 * (a support message, a screenshot) then goes once over the connection that is already up — fetch keeps it a few seconds.
 * No Electron imports (tests).
 */
export const HEDGE_MS = 1_500
export const HEDGE_ATTEMPTS = 4

export interface HedgeOptions {
  hedgeMs?: number
  attempts?: number
  fetcher?: typeof fetch
}

export function hedgedFetch(url: string, init: RequestInit & { signal: AbortSignal }, options: HedgeOptions = {}) {
  const hedgeMs = options.hedgeMs ?? HEDGE_MS
  const attempts = Math.max(1, options.attempts ?? HEDGE_ATTEMPTS)
  const fetcher = options.fetcher ?? fetch
  return new Promise<Response>((resolve, reject) => {
    const tries: AbortController[] = []
    let settled = false, failed = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = () => { settled = true; clearTimeout(timer); init.signal.removeEventListener('abort', aborted) }
    const aborted = () => {
      if (settled) return
      stop()
      for (const own of tries) own.abort()
      reject(init.signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
    }
    const send = () => {
      if (settled) return
      const own = new AbortController()
      tries.push(own)
      if (tries.length < attempts) timer = setTimeout(send, hedgeMs)
      fetcher(url, { ...init, signal: AbortSignal.any([own.signal, init.signal]) }).then((response) => {
        if (settled) { void response.body?.cancel().catch(() => {}); return }
        stop()
        for (const other of tries) if (other !== own) other.abort()
        resolve(response)
      }, (error: unknown) => {
        if (settled) return
        // Another try may still answer.
        if (++failed < tries.length) return
        // Every try so far failed: the next one now instead of waiting, or the request fails when none is left.
        if (tries.length < attempts) { clearTimeout(timer); send(); return }
        stop()
        reject(error)
      })
    }
    if (init.signal.aborted) { reject(init.signal.reason); return }
    init.signal.addEventListener('abort', aborted)
    send()
  })
}

/** A connection to `base` that is up right now, or nothing (errors are swallowed: the write that follows reports its own). */
export async function warmConnection(base: string, options: HedgeOptions & { timeoutMs?: number } = {}) {
  try {
    const response = await hedgedFetch(`${base}/health`, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) }, options)
    // read to the end: only then does the connection go back to the pool for the next request
    await response.arrayBuffer().catch(() => undefined)
    return response.ok
  } catch {
    return false
  }
}
