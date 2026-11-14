import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

/** No closer than the picture as it opens (owner, 15.11.2026: «уменьшить до обычного размера, до стандартного»), and no further than this. */
export const PINCH_MAX_SCALE = 6
interface View { scale: number; x: number; y: number }
const STANDARD: View = { scale: 1, x: 0, y: 0 }
/** Finger travel under which a touch is still a tap. */
const TAP_SLOP = 8

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Two fingers enlarge a picture on a phone and it stays as large as it was left (owner, 15.11.2026: «Увеличил, отпустил пальцы,
 * и размер зафиксировался… не сбрасывается обратно»): back down no smaller than its standard size; one finger moves an enlarged one.
 * Touch only: the mouse keeps its clicks. `resetKey`: another picture opens at its standard size. `wasGesture()` is true right
 * after a pinch or a drag, so the tap that ends one does not close the picture.
 */
export function usePinchZoom(resetKey?: unknown) {
  const [state, setState] = useState<{ key: unknown; view: View }>({ key: resetKey, view: STANDARD })
  // Another picture: its standard size, at once.
  if (state.key !== resetKey) setState({ key: resetKey, view: STANDARD })
  const view = state.key === resetKey ? state.view : STANDARD
  // What the handlers start from, without waiting for a render.
  const viewRef = useRef<{ key: unknown; view: View }>({ key: resetKey, view: STANDARD })
  const setView = (next: View) => { viewRef.current = { key: resetKey, view: next }; setState({ key: resetKey, view: next }) }
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const start = useRef<{ view: View; mid: { x: number; y: number }; dist: number; center: { x: number; y: number } } | null>(null)
  const moved = useRef(false)

  const begin = (element: Element) => {
    const points = [...pointers.current.values()]
    const box = element.getBoundingClientRect()
    const current = viewRef.current.key === resetKey ? viewRef.current.view : STANDARD
    // The picture's own centre, without the move it has: the transform turns round it.
    const center = { x: box.left + box.width / 2 - current.x, y: box.top + box.height / 2 - current.y }
    const mid = points.length > 1 ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 } : points[0]
    const dist = points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0
    start.current = mid ? { view: current, mid, dist, center } : null
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch') return
    if (!pointers.current.size) moved.current = false
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* the pointer is gone already */ }
    begin(event.currentTarget)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch' || !pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const from = start.current
    if (!from) return
    const points = [...pointers.current.values()]
    if (points.length > 1 && from.dist > 0) {
      const mid = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
      const scale = clamp(from.view.scale * Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) / from.dist, 1, PINCH_MAX_SCALE)
      if (Math.abs(scale - from.view.scale) > 0.01 || Math.hypot(mid.x - from.mid.x, mid.y - from.mid.y) > TAP_SLOP) moved.current = true
      // The spot of the picture under the fingers stays under them.
      const localX = (from.mid.x - from.center.x - from.view.x) / from.view.scale
      const localY = (from.mid.y - from.center.y - from.view.y) / from.view.scale
      setView(scale <= 1 ? STANDARD : { scale, x: mid.x - from.center.x - localX * scale, y: mid.y - from.center.y - localY * scale })
      return
    }
    if (from.view.scale <= 1) return
    const dx = event.clientX - from.mid.x
    const dy = event.clientY - from.mid.y
    if (Math.hypot(dx, dy) > TAP_SLOP) moved.current = true
    setView({ scale: from.view.scale, x: from.view.x + dx, y: from.view.y + dy })
  }

  const onPointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    if (!pointers.current.delete(event.pointerId)) return
    // The finger left on the glass goes on moving it from where it is.
    begin(event.currentTarget)
  }

  const zoomed = view.scale > 1
  return {
    zoomed,
    wasGesture: () => moved.current,
    /** Spread on the picture. */
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      style: {
        touchAction: 'none',
        transform: zoomed ? `translate(${view.x}px, ${view.y}px) scale(${view.scale})` : undefined,
        position: zoomed ? 'relative' as const : undefined,
        zIndex: zoomed ? 1 : undefined,
      },
    },
  }
}
