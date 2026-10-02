/**
 * The message channel to the owner app's main process. On the server laptop the API runs as an Electron utility
 * process (electron/localServer.ts), which has `process.parentPort`; electron/apiChannel.ts answers on the other side.
 * Run on its own (npm run server:dev, tests) there is no parent and `available` is false.
 *
 *   API → app request:  { channel: 'raidos', id, type, payload }      → { channel: 'raidos', replyTo: id, ok, data | error }
 *   API → app event:    { channel: 'raidos', type, payload }           (no answer; e.g. 'error-report')
 *
 * The app trusts these messages only as far as the API's own checks go: «Проверить сейчас», «Установить сейчас» and «Откатить» are owner
 * actions the API has authorised (routes/selfUpdate.ts); nothing the API sends can make the app install a build whose
 * signature it has not checked itself with the key built into it.
 */
export const OWNER_APP_CHANNEL = 'raidos'

interface ParentPort {
  postMessage(message: unknown): void
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown
}

export interface OwnerAppLink {
  readonly available: boolean
  request<T = unknown>(type: string, payload?: unknown, timeoutMs?: number): Promise<T>
  post(type: string, payload?: unknown): void
}

export class OwnerAppError extends Error {}

/** A link over `port` (default: this process's parentPort, if any). Tests pass a fake port. */
export function createOwnerAppLink(port: ParentPort | undefined = (process as unknown as { parentPort?: ParentPort }).parentPort): OwnerAppLink {
  if (!port) {
    return {
      available: false,
      request: () => Promise.reject(new OwnerAppError('Сервер запущен не из приложения владельца: эта функция работает только на ноутбуке-сервере.')),
      post: () => {},
    }
  }
  let next = 1
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  port.on('message', (event) => {
    const message = (event && typeof event === 'object' && 'data' in event ? event.data : event) as Record<string, unknown> | null
    if (!message || message.channel !== OWNER_APP_CHANNEL || typeof message.replyTo !== 'number') return
    const waiting = pending.get(message.replyTo)
    if (!waiting) return
    pending.delete(message.replyTo)
    clearTimeout(waiting.timer)
    if (message.ok === true) waiting.resolve(message.data)
    else waiting.reject(new OwnerAppError(typeof message.error === 'string' ? message.error.slice(0, 500) : 'Приложение владельца не выполнило запрос'))
  })
  return {
    available: true,
    request<T>(type: string, payload?: unknown, timeoutMs = 15_000) {
      const id = next++
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new OwnerAppError('Приложение владельца не ответило вовремя')) }, timeoutMs)
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
        try { port.postMessage({ channel: OWNER_APP_CHANNEL, id, type, payload }) } catch (error) { pending.delete(id); clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))) }
      })
    },
    post(type: string, payload?: unknown) {
      try { port.postMessage({ channel: OWNER_APP_CHANNEL, type, payload }) } catch { /* best effort */ }
    },
  }
}

let shared: OwnerAppLink | null = null
/** The process-wide link (one parentPort per process). */
export function ownerApp(): OwnerAppLink {
  shared ??= createOwnerAppLink()
  return shared
}

/**
 * An error for «Отчёты об ошибках (GitHub)» (electron/errorReporter.ts): sent raw to the owner app, which sanitizes it
 * (IP, e-mail, tokens, paths) before anything leaves the laptop. No request bodies, headers or query strings.
 */
export function reportErrorToOwnerApp(kind: 'exception' | 'rejection' | '5xx', error: unknown, context: { method?: string; path?: string; status?: number } = {}, link: OwnerAppLink = ownerApp()) {
  if (!link.available) return
  const value = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Non-error thrown')
  link.post('error-report', {
    source: 'api', kind, name: value.name || 'Error', message: String(value.message ?? '').slice(0, 2000), stack: String(value.stack ?? '').slice(0, 8000),
    ...(context.method ? { method: context.method.slice(0, 10) } : {}), ...(context.path ? { path: context.path.split('?')[0]!.slice(0, 200) } : {}),
    ...(context.status ? { status: context.status } : {}),
  })
}
