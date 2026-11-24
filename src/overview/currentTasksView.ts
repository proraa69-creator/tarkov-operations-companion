import { useSyncExternalStore } from 'react'

/**
 * How «Текущие задания» of the PC's Overview shows a long list (owner, 07.11.2026: «И добавь настройку… Разворачивать список или
 * прокручивать список»). Kept on this computer: the phone's list is another thing.
 */
export type CurrentTasksView = 'scroll' | 'expand'

const KEY = 'raidos-current-tasks-view-v1'
const EVENT = 'raidos-current-tasks-view-changed'

function read(): CurrentTasksView {
  try { return localStorage.getItem(KEY) === 'expand' ? 'expand' : 'scroll' } catch { return 'scroll' }
}

export function setCurrentTasksView(view: CurrentTasksView) {
  try { localStorage.setItem(KEY, view) } catch { /* no storage: for this visit it stays as it was */ }
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

export function useCurrentTasksView() {
  return useSyncExternalStore(subscribe, read, read)
}
