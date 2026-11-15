/**
 * How a part opens on the phone's «Оружейник» page (owner, 16.11.2026: «по умолчанию сделай, чтобы открывалось окно с
 * квестом… и была кнопка назад, а в настройках можно изменить, чтобы раскладывалось»):
 * - «Окно»: the part on the whole screen, «Назад» returns to the same place of the list;
 * - «Раскладывать»: the part unfolds right under its row, a cross in the row closes it.
 * The phone only; kept on this device.
 */
import { useSyncExternalStore } from 'react'

export const PHONE_GUNSMITH_VIEWS = ['window', 'expand'] as const
export type PhoneGunsmithView = typeof PHONE_GUNSMITH_VIEWS[number]
export const PHONE_GUNSMITH_VIEW_LABELS: Record<PhoneGunsmithView, string> = { window: 'Окно', expand: 'Раскладывать' }

const KEY = 'raidos-phone-gunsmith-view-v1'
const listeners = new Set<() => void>()
let current: PhoneGunsmithView | null = null

function read(): PhoneGunsmithView {
  try {
    return localStorage.getItem(KEY) === 'expand' ? 'expand' : 'window'
  } catch {
    return 'window'
  }
}

export function setPhoneGunsmithView(view: PhoneGunsmithView) {
  try {
    if (view === 'window') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, view)
  } catch { /* the choice lasts until the window closes */ }
  current = view
  listeners.forEach((listener) => listener())
}

const snapshot = () => (current ??= read())
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function usePhoneGunsmithView(): PhoneGunsmithView {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** Tests: forget the remembered choice. */
export function resetPhoneGunsmithViewForTests() { current = null }
