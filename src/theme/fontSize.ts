import { useSyncExternalStore } from 'react'

/**
 * «Размер шрифта» in Settings → «Интерфейс» (owner, 21.11.2026: «шрифт будет стандартный, это который у нас сейчас, и увеличенный
 * шрифт. Сделай его чуть больше»). Every font size of the app's stylesheets is `calc(<px> * var(--font-scale, 1))` (vite.config.ts,
 * fontScaleCss), so «Увеличенный» only sets the scale on the root: the text grows, the layout around it follows. Kept on this device.
 */
export type FontSize = 'standard' | 'large'

export const FONT_SIZES: readonly FontSize[] = ['standard', 'large']
export const FONT_SIZE_LABELS: Record<FontSize, string> = { standard: 'Стандартный', large: 'Увеличенный' }
/** How much larger «Увеличенный» is. */
export const LARGE_FONT_SCALE = 1.12

const KEY = 'raidos-font-size-v1'
const EVENT = 'raidos-font-size-changed'

export function currentFontSize(): FontSize {
  try { return localStorage.getItem(KEY) === 'large' ? 'large' : 'standard' } catch { return 'standard' }
}

/** The scale on the root element: none for the standard size. */
export function applyFontSize(size: FontSize = currentFontSize(), root: HTMLElement = document.documentElement) {
  if (size === 'large') {
    root.setAttribute('data-font-size', 'large')
    root.style.setProperty('--font-scale', String(LARGE_FONT_SCALE))
  } else {
    root.removeAttribute('data-font-size')
    root.style.removeProperty('--font-scale')
  }
}

export function setFontSize(size: FontSize) {
  try { localStorage.setItem(KEY, size) } catch { /* no storage: for this visit only */ }
  applyFontSize(size)
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(onChange: () => void) {
  const changed = () => { applyFontSize(); onChange() }
  window.addEventListener(EVENT, onChange)
  window.addEventListener('storage', changed)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('storage', changed)
  }
}

export function useFontSize() {
  return useSyncExternalStore(subscribe, currentFontSize, currentFontSize)
}
