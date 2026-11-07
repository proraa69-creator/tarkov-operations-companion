import { useSyncExternalStore } from 'react'

/**
 * The phone's bottom bar is the player's own (owner, 07.11.2026: «зажимаем вооружение и держу… всплывает окно с разделами. И я могу
 * выбрать любой блок и добавить вместо вот этого… А тот, который я заменил, переносится в еще»). Kept on this device.
 */
export const DEFAULT_TABS: readonly string[] = ['/', '/quests', '/maps', '/gunsmith']

const STORAGE_KEY = 'raidos-mobile-tabs-v1'
const EVENT = 'raidos-mobile-tabs-changed'
const NONE: readonly string[] = []

let raw: string | null | undefined
let saved: readonly string[] = NONE

function parse(value: string | null): readonly string[] {
  if (!value) return NONE
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : NONE
  } catch {
    return NONE
  }
}

function read(): readonly string[] {
  let stored: string | null
  // No storage: only what this visit chose.
  try { stored = localStorage.getItem(STORAGE_KEY) } catch { return saved }
  if (stored !== raw) {
    raw = stored
    saved = parse(stored)
  }
  return saved
}

function write(next: readonly string[]) {
  saved = next
  try {
    raw = next.length ? JSON.stringify(next) : null
    if (raw === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, raw)
  } catch { /* no storage: for this visit */ }
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

export function useSavedTabs() {
  return useSyncExternalStore(subscribe, read, read)
}

/**
 * The bar for what this player may open: always one section per slot, none twice. A saved section he may not open (the owner's panel
 * while the account is still loading) keeps its place in the storage and comes back when it can be opened.
 */
export function tabsOf(chosen: readonly string[], available: readonly string[]): string[] {
  const usable = new Set(available)
  const kept = DEFAULT_TABS.map((_, slot) => {
    const id = chosen[slot]
    return id && usable.has(id) && chosen.indexOf(id) === slot ? id : null
  })
  const used = new Set(kept.filter((id): id is string => id !== null))
  return kept.flatMap((id, slot) => {
    if (id) return [id]
    const next = [DEFAULT_TABS[slot]!, ...available].find((entry) => usable.has(entry) && !used.has(entry))
    if (!next) return []
    used.add(next)
    return [next]
  })
}

/** The chosen section takes the slot; the one that stood there goes to «Ещё» by no longer being on the bar. */
export function replaceTab(current: readonly string[], slot: number, id: string) {
  if (current.includes(id) || slot < 0 || slot >= current.length) return
  write(current.map((entry, index) => (index === slot ? id : entry)))
}

export function clearMobileTabs() {
  write(NONE)
}
