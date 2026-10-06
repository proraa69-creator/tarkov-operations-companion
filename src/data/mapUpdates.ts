import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { serviceClient } from '../account/nicknameBinding'
import { PLACEMENTS_KEY } from './mapBossPlacements'
import { OVERRIDES_KEY } from './questPointOverrides'

/** Pause after a failed wait (no server, an older server without the route, no network). */
const RETRY_MS = 30_000

type Request = NonNullable<ReturnType<typeof serviceClient>>

/**
 * «Правки карты сразу у всех»: waits on the server for the owner's next map correction (server/src/routes/mapUpdates.ts)
 * and calls `changed` each time the version moves. Runs until `signal` aborts.
 */
export async function watchMapUpdates(request: Request, changed: () => void, signal: AbortSignal, retryMs = RETRY_MS) {
  let version: number | undefined
  const pause = (ms: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
  while (!signal.aborted) {
    try {
      const answer = await request('GET', version === undefined ? '/v1/map-updates' : `/v1/map-updates?since=${version}`) as { version?: unknown } | null
      if (signal.aborted) return
      const next = typeof answer?.version === 'number' && Number.isSafeInteger(answer.version) ? answer.version : undefined
      if (next === undefined) { await pause(retryMs); continue }
      if (version !== undefined && next !== version) changed()
      version = next
    } catch {
      await pause(retryMs)
    }
  }
}

/** Re-reads the owner's quest points and boss placements the moment the server says they changed — no reload needed. */
export function useLiveMapUpdates(enabled = true) {
  const client = useQueryClient()
  useEffect(() => {
    const request = enabled ? serviceClient() : undefined
    if (!request) return
    const stop = new AbortController()
    void watchMapUpdates(request, () => {
      void client.invalidateQueries({ queryKey: OVERRIDES_KEY })
      void client.invalidateQueries({ queryKey: PLACEMENTS_KEY })
    }, stop.signal)
    return () => stop.abort()
  }, [client, enabled])
}
