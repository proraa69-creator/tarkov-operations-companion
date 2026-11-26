import { useSyncExternalStore } from 'react'

/**
 * «Настройки карты» → «Документы боевого пропуска» → «Спрашивать после рейда» (owner, 27.11.2026: «по окончанию рейда вылезает окно
 * и предлагает добавить документы, сколько их. Сколько вынес за рейд, столько и добавляешь. И можно включить, чтобы эта функция
 * появлялась и чтобы она не появлялась в настройках карты»): on until turned off, on this device, as the other switches there.
 */
const KEY = 'raidos-documents-after-raid'
const EVENT = 'raidos-documents-after-raid-changed'
/** The end of the raid the window asked about last: a reload, or the app's second window, does not ask again. */
const ASKED_KEY = 'raidos-documents-after-raid-asked'
/** A raid over longer ago than this (the app was opened later) is not asked about. */
export const ASK_WITHIN_MS = 30 * 60_000

export function readDocumentsAfterRaid() {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
}

export function setDocumentsAfterRaid(on: boolean) {
  try {
    if (on) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, 'off')
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === KEY) listener() }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', onStorage) }
}

export function useDocumentsAfterRaid() {
  return useSyncExternalStore(subscribe, readDocumentsAfterRaid, () => true)
}

/** Whether to ask about the raid that ended at `ended`: once per raid, and only soon after it. */
export function takeRaidToAsk(ended: number, now = Date.now()) {
  if (!Number.isFinite(ended) || now - ended > ASK_WITHIN_MS) return false
  try {
    if (Number(localStorage.getItem(ASKED_KEY) ?? 0) >= ended) return false
    localStorage.setItem(ASKED_KEY, String(ended))
  } catch { /* storage unavailable: asked this once */ }
  return true
}
