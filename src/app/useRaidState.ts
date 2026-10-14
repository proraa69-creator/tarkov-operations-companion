import { useEffect, useState } from 'react'
import type { RaidState } from '../import/raidState'

/**
 * The raid state the main process reads from the game's logs (electron/main.ts `game:raid-state`), desktop app only:
 * null elsewhere and until the first answer.
 */
export function useRaidState(): RaidState | null {
  const [state, setState] = useState<RaidState | null>(null)
  useEffect(() => {
    const desktop = typeof window === 'undefined' ? undefined : window.tarkovDesktop
    if (!desktop?.getRaidState || !desktop.onRaidStateChanged) return
    let alive = true
    let changed = false
    const stop = desktop.onRaidStateChanged((next) => { changed = true; if (alive) setState(next) })
    void desktop.getRaidState().then((next) => { if (alive && !changed) setState(next) }).catch(() => {})
    return () => { alive = false; stop() }
  }, [])
  return state
}

/**
 * A raid flag older than this is a raid whose end never reached the logs (the game crashed or the logs stopped): it no
 * longer holds background work back. No raid lasts this long, loading included.
 */
export const RAID_HOLD_MAX_MS = 2 * 60 * 60 * 1000

/** Whether a raid is running now, by the logs. */
export function raidRunning(state: RaidState | null | undefined, now: number) {
  return Boolean(state?.inRaid && (state.since === undefined || now - state.since < RAID_HOLD_MAX_MS))
}
