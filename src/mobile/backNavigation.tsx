import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { uiText } from '../i18n/renderText'

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
 * The pages of the history by position: «Назад» goes to the last one with another path, so opening a quest, a card or
 * a point within a page (?selected=…, ?quest=…) adds no «Назад» (owner, 17.10.2026: «именно в меню, но не при
 * развертывании квестов»).
 */
const pathAt: string[] = []
const pathListeners = new Set<() => void>()

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
    const save = () => remember(keyRef.current, window.scrollY)
    window.addEventListener('scroll', save, { passive: true })
    return () => window.removeEventListener('scroll', save)
  }, [enabled])

  useLayoutEffect(() => {
    recordPage(historyIndex(), location.pathname, type === 'PUSH')
    // The key moves first, so the scroll events of the switch are kept for the new entry, not the page left.
    keyRef.current = key
    const samePage = pathRef.current === location.pathname
    pathRef.current = location.pathname
    if (!enabled) return
    // Changes within one page (?quest=…, a chosen item) keep the place; a new page starts at its top.
    if (type !== 'POP') {
      if (!samePage) window.scrollTo(0, 0)
      return
    }
    const target = rememberedScroll(key)
    if (target == null) return
    window.scrollTo(0, target)
    let frames = 0
    let raf = 0
    const settle = () => {
      if (Math.abs(window.scrollY - target) < 2 || frames++ > 40) return
      window.scrollTo(0, target)
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

/** The floating «Назад», shown on every page reached by a tap; it returns to the page before, scrolled where it was. */
export function PhoneBackButton() {
  const navigate = useNavigate()
  const place = useBackButtonPlace()
  useLocation()
  useSyncExternalStore((listener) => { pathListeners.add(listener); return () => pathListeners.delete(listener) }, () => pathAt.join('|'), () => '')
  const delta = backDelta()
  if (delta == null) return null
  return <button type="button" className={`phone-back is-${place}`} onClick={() => navigate(delta)} aria-label={uiText('Назад')}><ArrowLeft size={18} /><span>{uiText('Назад')}</span></button>
}

/**
 * Settings: the place of «Назад» — four corners and a small phone picture where the button moves at once and can be
 * tapped (it does nothing there), so the player checks at once whether the place suits him (owner, 17.10.2026).
 */
export function BackButtonSettings() {
  const place = useBackButtonPlace()
  const [taps, setTaps] = useState(0)
  return <div className="setting-row phone-back-setting">
    <span><strong>{uiText('Кнопка «Назад»')}</strong><small>{uiText('Есть на каждом экране после перехода по меню и возвращает туда же, где вы были. Нажмите кнопку на картинке — удобно ли до неё дотянуться.')}</small></span>
    <div className="phone-back-choice">
      <div className="phone-back-places" role="radiogroup" aria-label={uiText('Где кнопка «Назад»')}>
        {BACK_BUTTON_PLACES.map((entry) => <button type="button" role="radio" aria-checked={place === entry.id} key={entry.id} className={`button small phone-back-place${place === entry.id ? ' primary' : ''}`} onClick={() => setBackButtonPlace(entry.id)}><span className={`phone-back-corner is-${entry.id}`} aria-hidden="true" />{uiText(entry.label)}</button>)}
      </div>
      <div className="phone-back-preview" aria-hidden="true">
        <span className="phone-back-preview-top" />
        <span className="phone-back-preview-line" /><span className="phone-back-preview-line short" /><span className="phone-back-preview-line" />
        <span className="phone-back-preview-tabs" />
        <button type="button" tabIndex={-1} className={`phone-back-preview-button is-${place}`} key={`${place}-${taps}`} onClick={() => setTaps((count) => count + 1)}><ArrowLeft size={11} />{uiText('Назад')}</button>
      </div>
    </div>
  </div>
}
