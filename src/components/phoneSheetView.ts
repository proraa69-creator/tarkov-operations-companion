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

/**
 * The height of the quest window held upright (owner, 12.11.2026: «настройку высоты… до середины экрана, на 25% меньше и еще на
 * 25%… Кому-то удобнее, чтобы на пол экрана, кому-то… меньше»): half the map, a quarter lower, and lower again.
 */
export const PHONE_SHEET_HEIGHTS = ['half', 'mid', 'low'] as const
export type PhoneSheetHeight = typeof PHONE_SHEET_HEIGHTS[number]
export const PHONE_SHEET_HEIGHT_LABELS: Record<PhoneSheetHeight, string> = { half: 'До середины', mid: 'Ниже на 25%', low: 'Ниже на 50%' }
const HEIGHT_KEY = 'raidos-phone-sheet-height-v1'
const heightListeners = new Set<() => void>()
let currentHeight: PhoneSheetHeight | null = null

function readHeight(): PhoneSheetHeight {
  try {
    const saved = localStorage.getItem(HEIGHT_KEY)
    return (PHONE_SHEET_HEIGHTS as readonly string[]).includes(saved ?? '') ? saved as PhoneSheetHeight : 'mid'
  } catch {
    return 'mid'
  }
}

export function setPhoneSheetHeight(height: PhoneSheetHeight) {
  try {
    if (height === 'mid') localStorage.removeItem(HEIGHT_KEY)
    else localStorage.setItem(HEIGHT_KEY, height)
  } catch { /* the choice lasts until the window closes */ }
  currentHeight = height
  heightListeners.forEach((listener) => listener())
}

const heightSnapshot = () => (currentHeight ??= readHeight())
const subscribeHeight = (listener: () => void) => { heightListeners.add(listener); return () => { heightListeners.delete(listener) } }

export function usePhoneSheetHeight(): PhoneSheetHeight {
  return useSyncExternalStore(subscribeHeight, heightSnapshot, heightSnapshot)
}

/** The phone held upright (the height choice is for that only). */
const portraitQuery = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(orientation: portrait)') : null)
const subscribePortrait = (listener: () => void) => {
  const query = portraitQuery()
  query?.addEventListener?.('change', listener)
  return () => query?.removeEventListener?.('change', listener)
}
export function usePortrait() {
  return useSyncExternalStore(subscribePortrait, () => portraitQuery()?.matches ?? true, () => true)
}
