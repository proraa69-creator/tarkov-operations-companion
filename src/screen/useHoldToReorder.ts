import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'

/** How long a block is held before it lifts (a click stays a click). */
export const HOLD_MS = 320
/** Moved this far before it lifts: the press was not a hold. */
const SLOP_PX = 8
/** The blocks moving aside and the lifted one landing in its place. */
export const SETTLE_MS = 180

/**
 * The place a lifted block lands: how many of the other blocks' middles its own middle has passed.
 * `centers`: the middles of every block before lifting, top to bottom; `from`: the lifted one; `center`: its middle now.
 */
export function targetIndex(centers: readonly number[], from: number, center: number): number {
  let index = 0
  centers.forEach((middle, at) => { if (at !== from && center > middle) index += 1 })
  return index
}

/** The ids with the one at `from` moved to `to`. */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}

interface Drag {
  id: string
  from: number
  to: number
  startY: number
  dy: number
  /** Every block's top and height before lifting (the list does not move while dragging). */
  boxes: Array<{ top: number; height: number }>
  gap: number
  /** Let go: the block glides into its place, then the list takes the new order. */
  landing: boolean
}

/**
 * Hold a block to lift it, drag it up or down, let go to put it there (report 179, owner 17.11.2026: «по зажатию блока с
 * пресетом можно перенести вверх или вниз. Соблюдай все анимации»). The other blocks move aside as it passes; it lands
 * with a glide. Esc puts it back. Alt + ↑/↓ moves the focused one by a place.
 */
export function useHoldToReorder(ids: readonly string[], onCommit: (ids: string[]) => void, enabled = true) {
  const [drag, setDragState] = useState<Drag | null>(null)
  /** For one frame after the new order is drawn: no transitions, so nothing jumps back. */
  const [settled, setSettled] = useState(false)
  const nodes = useRef(new Map<string, HTMLElement>())
  const hold = useRef<{ id: string; x: number; y: number; timer: number; pointer: number } | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const swallowClick = useRef(false)
  /** The handlers read the drag as it is now, before React draws it. */
  const setDrag = useCallback((next: Drag | null) => { dragRef.current = next; setDragState(next) }, [])

  const cancelHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer)
    hold.current = null
  }

  const finish = useCallback((commit: boolean) => {
    const current = dragRef.current
    if (!current || current.landing) return
    const to = commit ? current.to : current.from
    // the lifted block glides to its slot
    const slot = current.boxes[to]!
    const own = current.boxes[current.from]!
    const dy = to > current.from ? slot.top + slot.height - (own.top + own.height) : slot.top - own.top
    setDrag({ ...current, to, dy, landing: true })
    window.setTimeout(() => {
      setDrag(null)
      if (to !== current.from) {
        setSettled(true)
        onCommit(moved(ids, current.from, to))
      }
    }, SETTLE_MS)
  }, [ids, onCommit, setDrag])

  useEffect(() => {
    if (!settled) return
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setSettled(false)))
    return () => cancelAnimationFrame(frame)
  }, [settled])

  useEffect(() => {
    if (!drag || drag.landing) return
    const move = (event: PointerEvent) => {
      const current = dragRef.current
      if (!current || current.landing) return
      const dy = event.clientY - current.startY
      const own = current.boxes[current.from]!
      const centers = current.boxes.map((box) => box.top + box.height / 2)
      setDrag({ ...current, dy, to: targetIndex(centers, current.from, own.top + own.height / 2 + dy) })
    }
    const up = () => finish(true)
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); finish(false) } }
    // a finger must not scroll the page while it carries a block
    const noScroll = (event: TouchEvent) => event.preventDefault()
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('keydown', key)
    window.addEventListener('touchmove', noScroll, { passive: false })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('keydown', key)
      window.removeEventListener('touchmove', noScroll)
    }
  }, [drag, finish, setDrag])

  useEffect(() => () => cancelHold(), [])

  const lift = (id: string, y: number) => {
    const from = ids.indexOf(id)
    if (from < 0) return
    const boxes = ids.map((entry) => {
      const rect = nodes.current.get(entry)?.getBoundingClientRect()
      return { top: rect?.top ?? 0, height: rect?.height ?? 0 }
    })
    const gap = boxes.length > 1 ? Math.max(0, boxes[1]!.top - boxes[0]!.top - boxes[0]!.height) : 0
    swallowClick.current = true
    try { navigator.vibrate?.(8) } catch { /* not on every device */ }
    setDrag({ id, from, to: from, startY: y, dy: 0, boxes, gap, landing: false })
  }

  /** Props for one block of the list. */
  const itemProps = (id: string) => {
    const index = ids.indexOf(id)
    let style: CSSProperties | undefined
    let state: 'lifted' | 'landing' | 'shifted' | undefined
    if (drag) {
      const own = drag.boxes[drag.from]!
      if (id === drag.id) {
        state = drag.landing ? 'landing' : 'lifted'
        style = { transform: `translateY(${drag.dy}px)${drag.landing ? '' : ' scale(1.02)'}` }
      } else {
        const shift = own.height + drag.gap
        const offset = drag.from < index && index <= drag.to ? -shift : drag.to <= index && index < drag.from ? shift : 0
        state = 'shifted'
        style = { transform: `translateY(${offset}px)` }
      }
    }
    return {
      ref: (node: HTMLElement | null) => { if (node) nodes.current.set(id, node); else nodes.current.delete(id) },
      style: settled ? { transition: 'none' } : style,
      'data-reorder': state,
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        swallowClick.current = false
        if (!enabled || ids.length < 2 || event.button !== 0 || drag) return
        // the tool buttons stay buttons
        if ((event.target as HTMLElement).closest('.screen-preset-tools')) return
        cancelHold()
        const { clientX: x, clientY: y, pointerId: pointer } = event
        hold.current = { id, x, y, pointer, timer: window.setTimeout(() => { hold.current = null; lift(id, y) }, HOLD_MS) }
      },
      onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
        const pending = hold.current
        if (pending && pending.pointer === event.pointerId && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > SLOP_PX) cancelHold()
      },
      onPointerUp: cancelHold,
      onPointerLeave: () => { if (!dragRef.current) cancelHold() },
      onClickCapture: (event: { preventDefault(): void; stopPropagation(): void }) => {
        // the press that lifted the block does not also choose it
        if (swallowClick.current) { swallowClick.current = false; event.preventDefault(); event.stopPropagation() }
      },
      onContextMenu: (event: { preventDefault(): void }) => { if (dragRef.current || hold.current) event.preventDefault() },
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        if (!enabled || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
        const to = index + (event.key === 'ArrowUp' ? -1 : 1)
        if (index < 0 || to < 0 || to >= ids.length) return
        event.preventDefault()
        onCommit(moved(ids, index, to))
      },
    }
  }

  return { itemProps, dragging: drag !== null }
}
