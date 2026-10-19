import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/**
 * Phone «Назад» (owner, 17.10.2026: «при нажатии на любую кнопку, всегда должен быть возврат в то же место, то есть кнопка
 * назад»): every page the app went to can be left back to the page before it, scrolled to where it was.
 */

/** Where each page of the history was scrolled to (by the history entry's key), for this run of the app. */
const scrollByKey = new Map<string, number>()
const MAX_REMEMBERED = 80

/** The router's position in the history stack (react-router keeps `idx` in history.state); 0 at the first page. */
export function historyIndex(state: unknown = typeof window === 'undefined' ? null : window.history.state): number {
  const idx = (state as { idx?: unknown } | null)?.idx
  return typeof idx === 'number' && Number.isFinite(idx) ? idx : 0
}

export function remember(key: string, top: number) {
  scrollByKey.delete(key)
  scrollByKey.set(key, top)
  while (scrollByKey.size > MAX_REMEMBERED) scrollByKey.delete(scrollByKey.keys().next().value!)
}

export function rememberedScroll(key: string) {
  return scrollByKey.get(key)
}

/**
 * Lists that scroll inside the page, not with it (the PC's quest list, `.catalog-list`): their places are kept per
 * history entry too, in document order, so «Назад» lands in the same spot of the list (owner, 20.10.2026: «пролистал
 * квесты вниз… нажал назад — ты должен оказаться ровно в том же месте»).
 */
export const SCROLL_BOXES = '.catalog-list, [data-scroll-memory]'
const boxesByKey = new Map<string, number[]>()

function boxes(): HTMLElement[] {
  return typeof document === 'undefined' ? [] : [...document.querySelectorAll<HTMLElement>(SCROLL_BOXES)]
}

export function rememberBoxes(key: string, tops = boxes().map((box) => box.scrollTop)) {
  boxesByKey.delete(key)
  boxesByKey.set(key, tops)
  while (boxesByKey.size > MAX_REMEMBERED) boxesByKey.delete(boxesByKey.keys().next().value!)
}

export function rememberedBoxes(key: string) {
  return boxesByKey.get(key)
}

/**
 * The pages of the history by position: «Назад» goes to the last one with another path, so opening a quest, a card or
 * a point within a page (?selected=…, ?quest=…) adds no «Назад» (owner, 17.10.2026: «именно в меню, но не при
 * развертывании квестов»).
 */
const pathAt: string[] = []
const pathListeners = new Set<() => void>()

/** Re-renders when the remembered pages change (a new page, a step back). */
export function usePageHistory() {
  return useSyncExternalStore((listener) => { pathListeners.add(listener); return () => pathListeners.delete(listener) }, () => pathAt.join('|'), () => '')
}

export function recordPage(index: number, pathname: string, push: boolean) {
  pathAt[index] = pathname
  if (push) pathAt.length = index + 1
  pathListeners.forEach((listener) => listener())
}

/** How many steps back the previous page is (a negative delta for navigate), or null when there is none. */
export function backDelta(index = historyIndex()): number | null {
  const here = pathAt[index]
  for (let at = index - 1; at >= 0; at--) {
    if (pathAt[at] !== undefined && pathAt[at] !== here) return at - index
  }
  return null
}

/**
 * Keeps the scroll of every visited page and puts it back when the player returns with «Назад» (or the system back):
 * a new page opens at its top, a returned-to page where it was left. Pages that grow after their first render (lists
 * filled from the catalog) are scrolled again for a short while until the remembered place exists.
 */
export function useScrollMemory(enabled: boolean) {
  const location = useLocation()
  const type = useNavigationType()
  const key = location.key
  const keyRef = useRef(key)
  const pathRef = useRef(location.pathname)

  useEffect(() => {
    if (!enabled) return
    // Captured: the scroll of an inner list does not bubble to the window.
    const save = (event: Event) => {
      if (event.target instanceof HTMLElement) { if (event.target.matches(SCROLL_BOXES)) rememberBoxes(keyRef.current) }
      else remember(keyRef.current, window.scrollY)
    }
    // A press that may lead away keeps the places as they are now (an entry reached within the page, ?selected=…, had no
    // scroll of its own yet).
    const keep = () => { remember(keyRef.current, window.scrollY); rememberBoxes(keyRef.current) }
    document.addEventListener('scroll', save, { passive: true, capture: true })
    document.addEventListener('pointerdown', keep, { passive: true, capture: true })
    document.addEventListener('keydown', keep, { passive: true, capture: true })
    return () => {
      document.removeEventListener('scroll', save, { capture: true })
      document.removeEventListener('pointerdown', keep, { capture: true })
      document.removeEventListener('keydown', keep, { capture: true })
    }
  }, [enabled])

  useLayoutEffect(() => {
    recordPage(historyIndex(), location.pathname, type === 'PUSH')
    // The key moves first, so the scroll events of the switch are kept for the new entry, not the page left.
    const previousKey = keyRef.current
    keyRef.current = key
    const samePage = pathRef.current === location.pathname
    pathRef.current = location.pathname
    if (!enabled) return
    // Changes within one page (?quest=…, a chosen item) keep the place — the inner lists too, even when the page drew
    // them anew (the quest list after a quest is chosen); a new page starts at its top.
    if (type !== 'POP') {
      if (!samePage) { window.scrollTo(0, 0); return }
      const kept = rememberedBoxes(previousKey)
      if (kept) {
        boxes().forEach((box, index) => { const top = kept[index]; if (top != null && Math.abs(box.scrollTop - top) > 1) box.scrollTop = top })
        rememberBoxes(key, kept)
      }
      return
    }
    const target = rememberedScroll(key)
    const inner = rememberedBoxes(key)
    if (target == null && !inner) return
    // Lists filled after the first render get their place once they are long enough (a few frames at most).
    const apply = () => {
      if (target != null) window.scrollTo(0, target)
      boxes().forEach((box, index) => { const top = inner?.[index]; if (top != null) box.scrollTop = top })
    }
    const placed = () => {
      const found = boxes()
      // A list not rendered yet (the page fills after the first frames) is not «in place».
      if (inner && found.length < inner.length) return false
      return (target == null || Math.abs(window.scrollY - target) < 2) && found.every((box, index) => inner?.[index] == null || Math.abs(box.scrollTop - inner[index]!) < 2)
    }
    apply()
    let frames = 0
    let raf = 0
    const settle = () => {
      if (placed() || frames++ > 120) return
      apply()
      raf = requestAnimationFrame(settle)
    }
    raf = requestAnimationFrame(settle)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per history entry
  }, [enabled, key])
}

/** Where the floating «Назад» stands (owner, 17.10.2026: «сделай настройку кнопки назад… с выбором ее расположения»). */
export type BackButtonPlace = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export const BACK_BUTTON_PLACES: Array<{ id: BackButtonPlace; label: string }> = [
  { id: 'top-left', label: 'Вверху слева' },
  { id: 'top-right', label: 'Вверху справа' },
  { id: 'bottom-left', label: 'Внизу слева' },
  { id: 'bottom-right', label: 'Внизу справа' },
]
const PLACE_KEY = 'raidos-phone-back-place-v1'
const placeListeners = new Set<() => void>()

export function backButtonPlace(): BackButtonPlace {
  try {
    const saved = localStorage.getItem(PLACE_KEY)
    return BACK_BUTTON_PLACES.some((place) => place.id === saved) ? saved as BackButtonPlace : 'top-left'
  } catch { return 'top-left' }
}

export function setBackButtonPlace(place: BackButtonPlace) {
  try { localStorage.setItem(PLACE_KEY, place) } catch { /* storage blocked: this run only */ }
  placeListeners.forEach((listener) => listener())
}

export function useBackButtonPlace() {
  return useSyncExternalStore((listener) => { placeListeners.add(listener); return () => placeListeners.delete(listener) }, backButtonPlace, () => 'top-left' as BackButtonPlace)
}

