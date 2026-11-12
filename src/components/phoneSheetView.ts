/**
 * The quest window over the map on the phone (owner, 12.11.2026: «сделай разные варианты, также в меню, только для
 * телефона… где шестеренка… несколько видов, адаптированных под телефон»). The gear lists these on the phone instead of the
 * PC's three:
 * - «Шторка»: the window at the bottom, its handle (a tap or a swipe) makes it tall or low again;
 * - «Вкладки»: one stage at a time under its tab;
 * - «Только цели»: the quest's name and its objectives with their ticks, the rest under «Подробнее».
 * Turned sideways the window stands on the right of the map in each of them. Kept on this device.
 */
import { useSyncExternalStore } from 'react'

export const PHONE_SHEET_VIEWS = ['drawer', 'tabs', 'compact'] as const
export type PhoneSheetView = typeof PHONE_SHEET_VIEWS[number]
export const PHONE_SHEET_VIEW_LABELS: Record<PhoneSheetView, string> = { drawer: 'Шторка', tabs: 'Вкладки', compact: 'Только цели' }

const KEY = 'raidos-phone-sheet-view-v1'
const listeners = new Set<() => void>()

function read(): PhoneSheetView {
  try {
    const saved = localStorage.getItem(KEY)
    return (PHONE_SHEET_VIEWS as readonly string[]).includes(saved ?? '') ? saved as PhoneSheetView : 'drawer'
  } catch {
    return 'drawer'
  }
}

export function setPhoneSheetView(view: PhoneSheetView) {
  try {
    if (view === 'drawer') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, view)
  } catch { /* the choice lasts until the window closes */ }
  current = view
  listeners.forEach((listener) => listener())
}

let current: PhoneSheetView | null = null
const snapshot = () => (current ??= read())
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function usePhoneSheetView(): PhoneSheetView {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
