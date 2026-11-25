import { useSyncExternalStore } from 'react'
import type { MapWorkFilter } from '../progression/mapPriority'

/**
 * «Приоритет карт» counts all quests, the «Задания» or the «Устранения» only (report 230: «сделать фильтр для выбора карт с
 * устранениями или с обычными»). Kept on this device.
 */
const KEY = 'raidos-map-priority-filter-v1'
const EVENT = 'raidos-map-priority-filter-changed'
const FILTERS: readonly MapWorkFilter[] = ['all', 'tasks', 'kills']

function read(): MapWorkFilter {
  try {
    const value = localStorage.getItem(KEY)
    return FILTERS.includes(value as MapWorkFilter) ? value as MapWorkFilter : 'all'
  } catch { return 'all' }
}

export function setMapWorkFilter(filter: MapWorkFilter) {
  try { localStorage.setItem(KEY, filter) } catch { /* no storage: for this visit only */ }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useMapWorkFilter() {
  return useSyncExternalStore(subscribe, read, read)
}
