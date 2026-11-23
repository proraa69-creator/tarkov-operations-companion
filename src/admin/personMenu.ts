import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'

/**
 * Who opens the menu on a person in the admin chats (admin/ChatPersonMenu.tsx; owner, 24.11.2026: «нажимаю правой кнопкой,
 * на телефоне зажимаю пальцем»): a right click on the PC, a long press on the phone, the keyboard's menu key. `bind` goes
 * on the person's row; the click that ends a long press does not open the conversation.
 */
export interface PersonMenuTarget { accountId: string; name: string }
/** `trigger`: the person's row, the focus goes back to it when the menu closes. */
export interface PersonMenuState extends PersonMenuTarget { x: number; y: number; sheet: boolean; trigger?: HTMLElement }

/** How long the finger rests on a person before the menu opens. */
const LONG_PRESS_MS = 480
/** A finger that moves farther than this scrolls the list: no menu. */
const MOVE_TOLERANCE_PX = 10

type Bound = {
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void
}

export function usePersonMenu() {
  const [menu, setMenu] = useState<PersonMenuState | null>(null)
  const press = useRef<{ timer: number; x: number; y: number } | null>(null)
  // The click that ends a long press must not open the conversation as well.
  const swallowClick = useRef(false)
  // Android ends a long press in a «contextmenu» of its own: the menu that press opened stays as it is.
  const pressedAt = useRef(0)
  const cancelPress = useCallback(() => {
    if (!press.current) return
    window.clearTimeout(press.current.timer)
    press.current = null
  }, [])
  useEffect(() => cancelPress, [cancelPress])
  const close = useCallback(() => setMenu(null), [])
  const bind = useCallback((target: PersonMenuTarget): Bound => ({
    onContextMenu: (event) => {
      event.preventDefault()
      cancelPress()
      if (Date.now() - pressedAt.current < 1500) return
      const pointer = (event.nativeEvent as Partial<PointerEvent>).pointerType
      const rect = event.currentTarget.getBoundingClientRect()
      // The keyboard's menu key: no pointer position, the menu under the row.
      const keyboard = event.clientX === 0 && event.clientY === 0
      setMenu({ ...target, x: keyboard ? rect.left + 16 : event.clientX, y: keyboard ? rect.bottom : event.clientY, sheet: pointer === 'touch' || pointer === 'pen', trigger: event.currentTarget })
    },
    onPointerDown: (event) => {
      swallowClick.current = false
      if (event.pointerType === 'mouse') return
      cancelPress()
      const x = event.clientX
      const y = event.clientY
      const trigger = event.currentTarget
      const timer = window.setTimeout(() => {
        press.current = null
        swallowClick.current = true
        pressedAt.current = Date.now()
        try { navigator.vibrate?.(12) } catch { /* no vibration */ }
        setMenu({ ...target, x, y, sheet: true, trigger })
      }, LONG_PRESS_MS)
      press.current = { timer, x, y }
    },
    onPointerMove: (event) => {
      const start = press.current
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX) cancelPress()
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
    onClickCapture: (event) => {
      if (!swallowClick.current) return
      swallowClick.current = false
      event.preventDefault()
      event.stopPropagation()
    },
  }), [cancelPress])
  return { menu, close, bind }
}
