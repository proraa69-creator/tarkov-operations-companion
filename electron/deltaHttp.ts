import type { DeltaSource } from './appDelta.js'
import type { DeltaInfo } from './deltaInfo.js'

/**
 * The release's /app-delta/ files over HTTPS for the partial update (electron/appDelta.ts stageDelta, which runs several
 * of these at once): Range requests of app.asar, unpacked files, the brotli copies and their index. A body is read piece
 * by piece and every piece reported (the update window's progress and speed; owner, 03.11.2026: «обновление загружается
 * очень медленно»); a request that receives nothing for `stallMs` is dropped — stageDelta asks again — and none lasts
 * longer than 10 minutes. No Electron imports (tests).
 */
const STALL_MS = 30_000
const REQUEST_MS = 10 * 60_000
/**
 * No answer after this long: the same request once more on another connection, and the first answer wins. A normal one
 * comes in 0.3–1.4 s; a connection whose first packets are lost waits 3–10 s (Bangkok ↔ the VPS, 03.11.2026: one
 * request in ~60 hung 10.5 s and failed, which held the whole update).
 */
const HEDGE_MS = 3_000

/** The response to the first of up to two identical requests (the second after `hedgeMs`); the other one is dropped. */
function firstAnswer(url: string, init: { headers?: Record<string, string>; signal: AbortSignal }, hedgeMs: number) {
  return new Promise<Response>((resolve, reject) => {
    const tries: AbortController[] = []
    let settled = false, failed = 0
    const send = () => {
      const own = new AbortController()
      tries.push(own)
      fetch(url, { headers: init.headers, cache: 'no-store', signal: AbortSignal.any([own.signal, init.signal]) }).then((response) => {
        if (settled) { void response.body?.cancel().catch(() => {}); return }
        settled = true
        clearTimeout(hedge)
        for (const other of tries) if (other !== own) other.abort()
        resolve(response)
      }, (error: unknown) => {
        // The other one may still answer; a failure before the second was sent is the request's own.
        if (settled || ++failed < tries.length) return
        settled = true
        clearTimeout(hedge)
        reject(error)
      })
    }
    const hedge = setTimeout(send, hedgeMs)
    send()
  })
}

export function httpDeltaSource(base: string, info: DeltaInfo, options: { stallMs?: number; hedgeMs?: number } = {}): DeltaSource {
  const stallMs = options.stallMs ?? STALL_MS
  const hedgeMs = options.hedgeMs ?? HEDGE_MS
  /** The body of `url`; `refuse` names what is wrong with the response (status, headers) before it is read. */
  async function get(url: string, headers: Record<string, string>, refuse: (response: Response) => string, onData?: (bytes: number) => void, limit = Infinity) {
    const stall = new AbortController()
    let timer: NodeJS.Timeout | undefined
    const wait = () => { clearTimeout(timer); timer = setTimeout(() => stall.abort(new Error('Сервер обновления перестал отвечать')), stallMs) }
    wait()
    try {
      const response = await firstAnswer(url, { headers, signal: AbortSignal.any([stall.signal, AbortSignal.timeout(REQUEST_MS)]) }, hedgeMs)
      const problem = refuse(response)
      if (problem) { await response.body?.cancel().catch(() => {}); throw new Error(problem) }
      if (!response.body) return Buffer.alloc(0)
      const reader = response.body.getReader()
      const chunks: Buffer[] = []
      let size = 0
      for (;;) {
        wait()
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > limit) { await reader.cancel().catch(() => {}); throw new Error('Сервер отдал не ту часть обновления') }
        chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
        onData?.(value.byteLength)
      }
      return Buffer.concat(chunks, size)
    } finally {
      clearTimeout(timer)
    }
  }
  const status = (response: Response) => response.ok ? '' : `HTTP ${response.status}`
  /** Bytes start…end (inclusive) of a file; `size`: the whole file's, when known (a release replaced meanwhile). */
  async function part(url: string, start: number, end: number, onData?: (bytes: number) => void, size?: number) {
    const data = await get(url, { Range: `bytes=${start}-${end}` }, (response) => {
      if (response.status !== 206) return `Сервер не отдал часть обновления: HTTP ${response.status}`
      const match = /^bytes ([0-9]+)-([0-9]+)\/([0-9]+|\*)$/.exec(response.headers.get('content-range') ?? '')
      if (match && size !== undefined && match[3] !== '*' && Number(match[3]) !== size) return 'На сервере уже другой выпуск, попробуйте ещё раз'
      return match && Number(match[1]) === start && Number(match[2]) === end ? '' : 'Сервер отдал не ту часть обновления'
    }, onData, end - start + 1)
    if (data.length !== end - start + 1) throw new Error('Сервер отдал неполный кусок обновления')
    return data
  }

  return {
    range: (start, end, onData) => part(`${base}/app-delta/app.asar`, start, end, onData, info.asar.size),
    async unpacked(path, onData, range) {
      const url = `${base}/app-delta/app.asar.unpacked/${path.split('/').map(encodeURIComponent).join('/')}`
      if (range) return part(url, range.start, range.end, onData)
      return get(url, {}, (response) => {
        const problem = status(response)
        return problem && `Сервер не отдал ${path}: ${problem}`
      }, onData)
    },
    async brotliIndex() {
      try {
        const response = await firstAnswer(`${base}/app-delta/brotli/index.json?build=${info.build}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) }, hedgeMs)
        return response.ok ? await response.json() as unknown : null
      } catch {
        return null // none published (the site answers with its page) or offline: everything plain
      }
    },
    async brotli(sha256, onData) {
      return get(`${base}/app-delta/brotli/${sha256}.br`, {}, status, onData)
    },
  }
}
