import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { serviceClient } from '../account/nicknameBinding'
import { PLACEMENTS_KEY } from './mapBossPlacements'
import { OVERRIDES_KEY } from './questPointOverrides'
import { QUEST_TEXTS_KEY } from './questTextOverrides'
import { QUEST_REQUIREMENTS_KEY } from './questRequirementOverrides'
import { EVENT_QUESTS_KEY } from './eventQuests'

/** Pause after a failed wait (no server, an older server without the route, no network). */
const RETRY_MS = 30_000
/**
 * An unchanged version answered at once (the server's waiting room for this address is full, or a proxy cut the wait
 * short) is not a reason to ask again right away: a short pause keeps such a loop from hammering the server.
 */
const QUICK_ANSWER_MS = 2_000
const QUICK_PAUSE_MS = 5_000

type Request = NonNullable<ReturnType<typeof serviceClient>>

/**
 * «Правки карты сразу у всех»: waits on the server for the owner's next map correction (server/src/routes/mapUpdates.ts)
 * and calls `changed` each time the version moves. Runs until `signal` aborts.
 */
export async function watchMapUpdates(request: Request, changed: () => void, signal: AbortSignal, retryMs = RETRY_MS) {
  return watchVersion(request, '/v1/map-updates', changed, signal, retryMs)
}

/**
 * Long polling of a server version (`path` answers { version } at once, `path?since=<version>` when it moves or after
 * ~25 s): calls `changed` each time the version moves. Runs until `signal` aborts.
 */
export async function watchVersion(request: Request, path: string, changed: () => void, signal: AbortSignal, retryMs = RETRY_MS) {
  let version: number | undefined
  const pause = (ms: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
  while (!signal.aborted) {
    try {
      const asked = Date.now()
      const answer = await request('GET', version === undefined ? path : `${path}?since=${version}`) as { version?: unknown } | null
      if (signal.aborted) return
      const next = typeof answer?.version === 'number' && Number.isSafeInteger(answer.version) ? answer.version : undefined
      if (next === undefined) { await pause(retryMs); continue }
      const same = next === version
      if (version !== undefined && next !== version) changed()
      version = next
      if (same && Date.now() - asked < QUICK_ANSWER_MS) await pause(Math.min(QUICK_PAUSE_MS, retryMs))
    } catch {
      await pause(retryMs)
    }
  }
}

/** Window event after every server-side change (a map correction or a Goons sighting): the Goons card listens to it. */
export const LIVE_UPDATE_EVENT = 'raidos:live-update'

/** Re-reads the owner's quest points, quest texts, quest requirements, event quests and boss placements the moment the server says they changed — no reload needed. */
export function useLiveMapUpdates(enabled = true) {
  const client = useQueryClient()
  useEffect(() => {
    const request = enabled ? serviceClient() : undefined
    if (!request) return
    const stop = new AbortController()
    void watchMapUpdates(request, () => {
      void client.invalidateQueries({ queryKey: OVERRIDES_KEY })
      void client.invalidateQueries({ queryKey: PLACEMENTS_KEY })
      void client.invalidateQueries({ queryKey: QUEST_TEXTS_KEY })
      void client.invalidateQueries({ queryKey: QUEST_REQUIREMENTS_KEY })
      void client.invalidateQueries({ queryKey: EVENT_QUESTS_KEY })
      window.dispatchEvent(new Event(LIVE_UPDATE_EVENT))
    }, stop.signal)
    return () => stop.abort()
  }, [client, enabled])
}
