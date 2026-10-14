import { useCallback, useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { HoverCardPopup } from './HoverCard'

const SHOW_DELAY_MS = 120
/** A finger held this long on the element shows the card. */
export const LONG_PRESS_MS = 380
/** A finger that moves farther than this before then is scrolling, not holding. */
export const LONG_PRESS_SLOP_PX = 10
/** Mouse events a browser makes up after a touch are not a mouse. */
const TOUCH_MOUSE_GAP_MS = 800

/**
 * The app's hover card, instead of the browser's plain `title` tooltip: shown on hover and keyboard focus, styled like
 * the app's panels, drawn into <body> so no parent clips it, kept inside the window (below the anchor, or above when
 * there is no room). Spread `anchorProps` on the element it explains and render `card` anywhere next to it.
 *
 * On a touch screen the card comes with a long press (owner, 13.10.2026: «при удержании пальца на объекте, появляется
 * всплывающее окно … но при удержании и ведении им, окно начинает тоже перетаскиваться»): while it is shown the finger
 * moves nothing — no scrolling, no lifted link — and lifting the finger hides it without opening the link under it.
 */
export function useHoverCard(content: ReactNode | null | undefined) {
  const id = useId()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [held, setHeld] = useState(false)
  const press = useRef<{ x: number; y: number; timer: number } | null>(null)
  const touchAt = useRef(0)
  const swallowClick = useRef(false)

  const show = useCallback((event: { currentTarget: EventTarget }) => {
    if (Date.now() - touchAt.current < TOUCH_MOUSE_GAP_MS) return
    setAnchor(event.currentTarget as HTMLElement)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS)
  }, [])
  const hide = useCallback(() => {
    window.clearTimeout(timer.current)
    setOpen(false)
  }, [])
  const cancelPress = useCallback(() => {
    if (press.current) window.clearTimeout(press.current.timer)
    press.current = null
  }, [])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch') return
    touchAt.current = Date.now()
    cancelPress()
    const target = event.currentTarget
    press.current = {
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => {
        press.current = null
        setAnchor(target)
        setHeld(true)
        setOpen(true)
      }, LONG_PRESS_MS),
    }
  }, [cancelPress])
  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const start = press.current
    if (event.pointerType !== 'touch' || !start) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLOP_PX) cancelPress()
  }, [cancelPress])
  const onPointerEnd = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch') return
    touchAt.current = Date.now()
    cancelPress()
    if (!held) return
    // The press showed the card: lifting the finger only hides it (the click that follows does not open the link).
    swallowClick.current = event.type === 'pointerup'
    setHeld(false)
    setOpen(false)
  }, [cancelPress, held])
  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!swallowClick.current) return
    swallowClick.current = false
    event.preventDefault()
    event.stopPropagation()
  }, [])
  // No system menu or link preview on a held finger.
  const onContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (held || Date.now() - touchAt.current < TOUCH_MOUSE_GAP_MS) event.preventDefault()
  }, [held])

  useEffect(() => () => { window.clearTimeout(timer.current); cancelPress() }, [cancelPress])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    // A held card stays while the finger stays (the page does not scroll then); a hover card goes with a scroll.
    if (!held) window.addEventListener('scroll', hide, true)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('scroll', hide, true) }
  }, [open, hide, held])
  // While the finger holds the card, moving it scrolls nothing and drags nothing.
  useEffect(() => {
    if (!held) return
    const stop = (event: TouchEvent) => { if (event.cancelable) event.preventDefault() }
    const release = () => { setHeld(false); setOpen(false) }
    document.addEventListener('touchmove', stop, { passive: false })
    document.addEventListener('touchend', release)
    document.addEventListener('touchcancel', release)
    return () => {
      document.removeEventListener('touchmove', stop)
      document.removeEventListener('touchend', release)
      document.removeEventListener('touchcancel', release)
    }
  }, [held])

  if (!content) return { anchorProps: {}, card: null }
  return {
    anchorProps: {
      onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide,
      onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd, onClickCapture, onContextMenu,
      'aria-describedby': open ? id : undefined,
    },
    card: open && anchor ? <HoverCardPopup id={id} anchor={anchor}>{content}</HoverCardPopup> : null,
  }
}
