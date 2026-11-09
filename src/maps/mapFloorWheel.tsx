import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'

/** Wheel travel (pixels) that makes one floor step: a mouse notch is about 100, a touchpad sends many small ones. */
const STEP = 60
/** After a step, the rest of the same flick is let go. */
const PAUSE_MS = 180

/**
 * Alt + the mouse wheel over the map steps the floors (owner, 08.11.2026: «по комбинации клавиш зажатия Alt и прокручивания
 * ролика вверх-вниз. Это переключение этажей на карте… основной этаж, подвал, второй, третий»; the idea of report №55
 * «"Alt+scrollUP" "alt+scrollDOWN". Вверх соответственно этаж выше, вниз этаж ниже»). Up is the floor above, down the floor
 * below, stopping at the top and the bottom; the map does not zoom while Alt is held. For the accounts the owner gave it to
 * only (src/account/trialFeatures.ts `mapFloorWheel`). `floors`: bottom up.
 */
export function MapFloorWheel({ floors, floor, onPick }: { floors: readonly string[]; floor: string; onPick: (floor: string) => void }) {
  const map = useMap()
  const latest = useRef({ floors, floor, onPick })
  useEffect(() => { latest.current = { floors, floor, onPick } })
  useEffect(() => {
    const container = map.getContainer()
    let travel = 0
    let pausedUntil = 0
    const onWheel = (event: WheelEvent) => {
      if (!event.altKey) return
      // the map's own wheel zoom never sees it
      event.preventDefault()
      event.stopPropagation()
      const now = event.timeStamp || Date.now()
      if (now < pausedUntil) return
      const { floors: list, floor: current, onPick: pick } = latest.current
      if (list.length < 2) return
      travel += event.deltaMode === 1 ? event.deltaY * 40 : event.deltaMode === 2 ? event.deltaY * 800 : event.deltaY
      if (Math.abs(travel) < STEP) return
      const next = steppedFloor(list, current, travel < 0 ? 1 : -1)
      travel = 0
      pausedUntil = now + PAUSE_MS
      if (next !== current) pick(next)
    }
    container.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => container.removeEventListener('wheel', onWheel, { capture: true })
  }, [map])
  return null
}

/** The floor above (`step` 1) or below (−1) in a bottom-up list, stopping at the ends. */
export function steppedFloor(floors: readonly string[], floor: string, step: 1 | -1): string {
  const at = Math.max(0, floors.indexOf(floor))
  return floors[Math.min(floors.length - 1, Math.max(0, at + step))] ?? floor
}

/**
 * The same from the game (owner, 08.11.2026: «не переключаясь из игры, он может перелистать этаж карты»): while the map page is
 * open, the PC app listens to Alt + the wheel when the game, not the app, has the focus (electron/mapFloorWheel.ts) and sends
 * the steps here.
 */
export function useGameFloorWheel(on: boolean, floors: readonly string[], floor: string, onPick: (floor: string) => void) {
  const latest = useRef({ floors, floor, onPick })
  useEffect(() => { latest.current = { floors, floor, onPick } })
  useEffect(() => {
    const api = typeof window === 'undefined' ? undefined : window.tarkovDesktop?.mapFloorWheel
    if (!on || !api) return
    api.enable(true)
    const stop = api.onStep((step) => {
      const { floors: list, floor: current, onPick: pick } = latest.current
      const next = steppedFloor(list, current, step)
      if (next !== current) pick(next)
    })
    return () => { stop(); api.enable(false) }
  }, [on])
}
