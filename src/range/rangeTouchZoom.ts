import type { ScopeMode } from './rangeScope'

/**
 * The phone's sliders in the scope (owner, 24.11.2026: «в режиме прицеливания должен быть ползунок для увеличения дистанции до
 * персонажа и увеличение кратности прицела если она есть на нем»): the distance, and the scope's magnification where it has more
 * than one — a variable mode smoothly over its range, a scope of fixed magnifications from one to the next (the first mode of
 * each, as the wheel steps on the computer).
 */
export const DISTANCE_MIN = 5
export const DISTANCE_MAX = 1000
export const DISTANCE_STEP = 5

export const distanceShare = (distance: number) => (distance - DISTANCE_MIN) / (DISTANCE_MAX - DISTANCE_MIN)
export function distanceAt(share: number) {
  const raw = DISTANCE_MIN + clamp(share) * (DISTANCE_MAX - DISTANCE_MIN)
  return Math.min(DISTANCE_MAX, Math.max(DISTANCE_MIN, Math.round(raw / DISTANCE_STEP) * DISTANCE_STEP))
}

export interface ZoomSlider {
  /** Where the slider stands now, 0 (the least) … 1 (the most). */
  share: number
  /** What the slider at `share` sets: a variable mode's magnification, or the mode of the fixed magnification. */
  at(share: number): { zoom: number } | { mode: number }
  /** Fixed magnifications: their count (the slider steps); a variable mode: none. */
  stops?: number
}

/** The magnification slider for the mode in use, or none where the sight has one magnification only. */
export function zoomSlider(modes: ScopeMode[], modeIndex: number, zoom: number): ZoomSlider | undefined {
  const mode = modes[modeIndex]
  if (!mode) return undefined
  if (mode.zoomMax && mode.zoomMax > mode.zoom) {
    const low = mode.zoom
    const high = mode.zoomMax
    return {
      share: clamp((zoom - low) / (high - low)),
      at: (share) => ({ zoom: Math.round((low + clamp(share) * (high - low)) * 10) / 10 }),
    }
  }
  const firsts = fixedZooms(modes)
  if (firsts.length < 2) return undefined
  const place = Math.max(0, firsts.findIndex((entry) => entry.zoom === mode.zoom))
  return {
    share: place / (firsts.length - 1),
    at: (share) => ({ mode: firsts[Math.round(clamp(share) * (firsts.length - 1))].index }),
    stops: firsts.length,
  }
}

/** The scope's magnifications, least first, each with the first mode that has it. */
export function fixedZooms(modes: ScopeMode[]) {
  const firsts = new Map<number, number>()
  modes.forEach((entry, index) => { if (!firsts.has(entry.zoom)) firsts.set(entry.zoom, index) })
  return [...firsts].map(([zoom, index]) => ({ zoom, index })).sort((a, b) => a.zoom - b.zoom)
}

const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
