import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'

const HOLD_MS = 450
const MOVE_TOLERANCE = 10

/** A tap or a held finger on one element; a scroll cancels both, and the click that follows a hold does nothing (no link opens). */
export function useHold(onTap: () => void, onHold: () => void, holdMs = HOLD_MS) {
  const timer = useRef(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  const held = useRef(false)
  const cancel = () => { window.clearTimeout(timer.current); start.current = null }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return {
    onPointerDown: (event: ReactPointerEvent) => {
      held.current = false
      start.current = { x: event.clientX, y: event.clientY }
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => { held.current = true; start.current = null; onHold() }, holdMs)
    },
    onPointerMove: (event: ReactPointerEvent) => {
      if (start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > MOVE_TOLERANCE) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (event: ReactMouseEvent) => event.preventDefault(),
    onClick: (event: ReactMouseEvent) => {
      if (held.current) { held.current = false; event.preventDefault(); return }
      onTap()
    },
  }
}
