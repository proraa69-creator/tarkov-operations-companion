/**
 * The owner app's side of the API ↔ app channel (server/src/services/ownerApp.ts). The API runs as a utility process
 * (electron/localServer.ts) and sends `{ channel: 'raidos', id?, type, payload }`; requests (with `id`) get one answer
 * `{ channel: 'raidos', replyTo: id, ok, data | error }`, events (no `id`) none. Only the types registered here are
 * handled, everything else is refused. No Electron imports (tested in apiChannel.test.ts).
 *
 * What the API may ask is deliberately small: the self-update status, «Проверить сейчас», «Установить сейчас» (only a
 * build the app downloaded and verified itself), «Откатить на предыдущую» (electron/selfUpdate.ts) and error events for the GitHub reporter (electron/errorReporter.ts). None of it can make the
 * app install anything it has not verified itself.
 */
export const API_CHANNEL = 'raidos'

type RequestHandler = (payload: unknown) => unknown
type EventHandler = (payload: unknown) => void

const requests = new Map<string, RequestHandler>()
const events = new Map<string, EventHandler>()

export function handleApiRequest(type: string, handler: RequestHandler) { requests.set(type, handler) }
export function onApiEvent(type: string, handler: EventHandler) { events.set(type, handler) }

/** Test hook. */
export function resetApiChannel() { requests.clear(); events.clear() }

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500)

/** One message from the API process; `reply` posts back to the same process. */
export async function dispatchApiMessage(message: unknown, reply: (answer: unknown) => void) {
  if (!message || typeof message !== 'object') return
  const { channel, id, type, payload } = message as { channel?: unknown; id?: unknown; type?: unknown; payload?: unknown }
  if (channel !== API_CHANNEL || typeof type !== 'string') return
  if (typeof id !== 'number') {
    try { events.get(type)?.(payload) } catch { /* an event never breaks the channel */ }
    return
  }
  const handler = requests.get(type)
  if (!handler) { reply({ channel: API_CHANNEL, replyTo: id, ok: false, error: 'Неизвестный запрос' }); return }
  try {
    reply({ channel: API_CHANNEL, replyTo: id, ok: true, data: await handler(payload) })
  } catch (error) {
    reply({ channel: API_CHANNEL, replyTo: id, ok: false, error: errorText(error) })
  }
}
