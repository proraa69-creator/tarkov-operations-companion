import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { historyIndex } from '../mobile/backHistory'

/**
 * «Назад» on the PC (owner, 20.10.2026: «как в боссах: перешёл в тактику боя — кнопка назад слева сверху; так везде.
 * Нажал квест, нажал “Показать на карте” — кнопка назад, и ты возвращаешься к списку квестов ровно в то же место. Не на
 * постоянке, не по десяти ссылкам назад»): one step only — to the page the player went INTO something from (another
 * page opened by a link or a button in the content). The sidebar starts afresh: no «Назад» after it. The page left is
 * scrolled back where it was (mobile/backHistory.ts useScrollMemory, on for the PC too).
 */
interface Origin { index: number; path: string }
let origin: Origin | null = null
/** Set by a click in the sidebar just before its navigation: that page is no «go into». */
let sidebarClick = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

export function noteSidebarNavigation() {
  sidebarClick = true
}

/** The page «Назад» returns to, or null. */
export function backOrigin() {
  return origin
}

/** Test seam: forget everything. */
export function resetBackOrigin() {
  origin = null
  sidebarClick = false
  emit()
}

/**
 * Follows the navigation (mounted once, AppShell): a PUSH to another page from the content remembers the page left; a
 * sidebar click or a step back to (or before) that page forgets it. Changes within one page (?quest=…) keep it.
 */
export function useDesktopBackOrigin(enabled: boolean) {
  const location = useLocation()
  const type = useNavigationType()
  const last = useRef<{ index: number; path: string; pathname: string } | null>(null)
  useLayoutEffect(() => {
    const index = historyIndex()
    const here = { index, path: `${location.pathname}${location.search}`, pathname: location.pathname }
    const before = last.current
    last.current = here
    if (!enabled) return
    const fromSidebar = sidebarClick
    sidebarClick = false
    if (fromSidebar) { if (origin) { origin = null; emit() } return }
    if (type === 'POP') {
      if (origin && index <= origin.index) { origin = null; emit() }
      return
    }
    if (type === 'PUSH' && before && before.pathname !== location.pathname) {
      origin = { index: before.index, path: before.path }
      emit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per history entry
  }, [enabled, location.key])
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

/**
 * The button, top left over the page (the same place everywhere, like «Тактика боя»). The boss tactics page keeps its
 * own button there, so this one stays away from it.
 */
export function DesktopBackButton() {
  const navigate = useNavigate()
  const location = useLocation()
  const current = useSyncExternalStore(subscribe, backOrigin, () => null)
  if (!current || /^\/bosses\/[^/]+\/tactics/.test(location.pathname)) return null
  const index = historyIndex()
  if (index <= current.index) return null
  const back = () => {
    const delta = current.index - index
    // A step back in the history restores the page's scroll; without that history the page itself opens.
    if (delta < 0 && window.history.state?.idx !== undefined) navigate(delta)
    else navigate(current.path)
  }
  return <button type="button" className="button desktop-back" onClick={back} aria-label={uiText('Назад')}><ArrowLeft size={16} />{uiText('Назад')}</button>
}
