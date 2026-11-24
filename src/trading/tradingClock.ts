import { useEffect, useState, useSyncExternalStore } from 'react'

/** The current time, moving once a minute: enough for «N hours ago» and for a raid flag going stale. */
export function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

let signalCount = 0
const listeners = new Set<() => void>()
export function setTradingSignalCount(next: number) {
  if (next === signalCount) return
  signalCount = next
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
/** How many signals of this mode pass the player's own threshold now: the number beside «Торговля» in the menu. */
export const useTradingSignalCount = () => useSyncExternalStore(subscribe, () => signalCount, () => 0)
