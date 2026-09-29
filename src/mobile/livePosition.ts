/**
 * Phone «Мини Карта»: the player's position comes from the server, where the desktop app (which reads the EFT
 * screenshots) pushes it. Polled every few seconds while the screen is open and the app is visible.
 */
import { createContext, useContext, useEffect, useState } from 'react'
import type { RaidMode } from '../domain/types'
import { fetchServerPosition, POSITION_POLL_MS, type ServerPosition } from '../sync/serverSync'

export interface LivePositionValue {
  position: ServerPosition | null
  /** true while the position is fresh (see positionFreshness); a stale one is drawn dimmed. */
  fresh: boolean
  /** Keep the map centred on the player (the user dragging the map turns it off). */
  follow: boolean
  setFollow: (value: boolean) => void
}

/** Provided by the phone live-map screen; LivePlayerMarker uses it instead of the desktop screenshot feed. */
export const LivePositionContext = createContext<LivePositionValue | null>(null)

export function useLivePositionContext() {
  return useContext(LivePositionContext)
}

export interface PositionPollState {
  position: ServerPosition | null
  /** Time of the last successful answer (null = none yet or the server/account is not reachable). */
  checkedAt: number | null
  loading: boolean
}

function documentHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/** Polls GET /v1/me/position/:mode; pauses while the app is in the background. Keeps the last known position. */
export function useServerPositionPoll(mode: RaidMode, intervalMs = POSITION_POLL_MS): PositionPollState {
  const [result, setResult] = useState<PositionPollState & { mode: RaidMode }>({ mode, position: null, checkedAt: null, loading: true })

  useEffect(() => {
    let alive = true
    let timer: number | undefined
    let busy = false
    const tick = async () => {
      if (!alive || busy || documentHidden()) return
      busy = true
      try {
        const position = await fetchServerPosition(mode).catch(() => null)
        if (!alive) return
        setResult((current) => ({
          mode,
          // A failed poll keeps the last known position of this mode.
          position: position ?? (current.mode === mode ? current.position : null),
          checkedAt: position ? Date.now() : current.mode === mode ? current.checkedAt : null,
          loading: false,
        }))
      } finally {
        busy = false
      }
    }
    const start = () => {
      window.clearInterval(timer)
      void tick()
      timer = window.setInterval(() => void tick(), intervalMs)
    }
    const onVisibility = () => {
      if (documentHidden()) window.clearInterval(timer)
      else start()
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [mode, intervalMs])

  return result.mode === mode ? result : { position: null, checkedAt: null, loading: true }
}

/** «12 с назад» / «3 мин назад» — translated by uiText rules in English. */
export function formatAge(ms: number) {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} с назад`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} ч назад`
  return `${Math.round(hours / 24)} дн назад`
}
