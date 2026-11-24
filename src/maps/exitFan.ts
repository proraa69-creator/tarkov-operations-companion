import type { MapMarker } from '../domain/types'

/**
 * Exits of one place stand side by side, each with its own icon (owner, 06.11.2026: «если там есть выход только для ЧВК, значок
 * ЧВК, и если есть совместный выход, то еще значок совместного выхода. Они должны быть рядом»). The sideways step is in screen
 * pixels, so they stay next to each other at any zoom. One name under them when they share it; names that differ take turns
 * in height, so they do not lie on each other.
 */
const SAME_PLACE_M = 6
const STEP_PX = 30
const LEFT_TO_RIGHT = ['extract.pmc', 'extract.scav', 'extract.coop', 'transit']

export interface ExitFan {
  shift: number
  /** Another mark of the place carries the shared name. */
  noName?: boolean
  /** Inline CSS for the name under the icon. */
  nameStyle?: string
}

const order = (marker: MapMarker) => {
  const place = LEFT_TO_RIGHT.indexOf(marker.layerId ?? '')
  return place < 0 ? LEFT_TO_RIGHT.length : place
}

export function exitFanOut(markers: readonly MapMarker[]) {
  const fan = new Map<string, ExitFan>()
  const groups: MapMarker[][] = []
  for (const marker of markers) {
    const group = groups.find((entry) => entry.some((other) => Math.hypot(other.position[0] - marker.position[0], other.position[1] - marker.position[1]) <= SAME_PLACE_M))
    if (group) group.push(marker)
    else groups.push([marker])
  }
  for (const group of groups) {
    if (group.length < 2) continue
    const ordered = [...group].sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id))
    const oneName = new Set(ordered.map((marker) => marker.title.trim().toLowerCase())).size === 1
    ordered.forEach((marker, index) => {
      const shift = (index - (ordered.length - 1) / 2) * STEP_PX
      if (oneName) fan.set(marker.id, index === 0 ? { shift, nameStyle: `left:calc(50% + ${-shift}px)` } : { shift, noName: true })
      else fan.set(marker.id, index % 2 ? { shift, nameStyle: 'top:calc(100% + 12px)' } : { shift })
    })
  }
  return fan
}
