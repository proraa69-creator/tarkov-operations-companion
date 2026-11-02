import { useEffect, useState } from 'react'
import { HALLOWEEN_2026_END } from '../data/curatedQuests'

/**
 * «Хеллоуин» (owner, 02.11.2026: «сделай кнопку Хеллоуин при открытии там вся информация о ивенте, квесты, просто инфа
 * какая то полезная»): the event of game version 1.3.0.0 from 29 October 2026. The game has not announced its end; the app
 * shows the button (HalloweenEventButton.tsx), the window (HalloweenEventWindow.tsx) and the event quests
 * (src/data/curatedQuests.ts HALLOWEEN_2026) until HALLOWEEN_2026_END, then hides them by itself.
 */
export const HALLOWEEN_EVENT_END = Date.parse(HALLOWEEN_2026_END)

export function halloweenEventActive(now: number = Date.now()): boolean {
  return now < HALLOWEEN_EVENT_END
}

/** Whether the event is on; turns false by itself when it ends while the app is open. */
export function useHalloweenActive() {
  const [active, setActive] = useState(() => halloweenEventActive())
  useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(() => setActive(false), Math.min(HALLOWEEN_EVENT_END - Date.now(), 2 ** 31 - 1))
    return () => window.clearTimeout(timer)
  }, [active])
  return active
}

/** The Overview button asks for the window with this window event. */
export const HALLOWEEN_OPEN_EVENT = 'raidos:halloween-event-open'

export const openHalloweenEvent = () => window.dispatchEvent(new Event(HALLOWEEN_OPEN_EVENT))
