import { useEffect, useSyncExternalStore } from 'react'

/**
 * One window at a time (owner, 03.11.2026: «почему все окна одновременно, нужно что бы они открывались по очереди, не
 * должно быть такого что бы одно перекрывало другое»). The windows that open by themselves — the owner's announcements
 * and surveys, «Перезапустите Escape from Tarkov», the subscription reminder, the first-run guide, the «Новое: …» tips,
 * an event's intro — take this turn before they show and give it back when they close; the next one in line opens
 * after. Each of them used to look every 500 ms whether another one was on screen, so several due at the same moment
 * all saw an empty screen and opened together. A window the player opens by pressing something does not wait, and the
 * gates that stop the app («Укажите страну», the device limit) go first anyway: the tips wait for any open dialog.
 */
let holder: string | null = null
const waiting: string[] = []
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function advance() {
  if (holder !== null || waiting.length === 0) return
  holder = waiting.shift() ?? null
  notify()
}

/** `id` asks for the turn: it gets it now when nobody holds it, else after the ones that asked before it. */
export function requestWindowTurn(id: string) {
  if (holder === id || waiting.includes(id)) return
  waiting.push(id)
  advance()
}

/** `id` no longer wants the turn: it leaves the line, and the turn passes on when it held it. */
export function releaseWindowTurn(id: string) {
  const at = waiting.indexOf(id)
  if (at >= 0) waiting.splice(at, 1)
  if (holder !== id) return
  holder = null
  notify()
  advance()
}

/** The window holding the turn now, if any. */
export function windowTurnHolder() {
  return holder
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * True while the window `id` holds the turn. `wanted`: the window is due or open — it queues up, and it gives the turn
 * back once it is not wanted any more (closed, another page) or is gone.
 */
export function useWindowTurn(id: string, wanted: boolean) {
  const current = useSyncExternalStore(subscribe, windowTurnHolder, windowTurnHolder)
  useEffect(() => {
    if (!wanted) return
    requestWindowTurn(id)
    return () => releaseWindowTurn(id)
  }, [id, wanted])
  return wanted && current === id
}
