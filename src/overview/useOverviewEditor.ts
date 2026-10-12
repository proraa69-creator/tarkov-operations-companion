import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { EASE_IN_OUT, EASE_OUT, canAnimate } from '../shared/motion'
import { defaultOverviewLayout, FIXED_BLOCKS, isDefaultLayout, loadOverviewLayout, moveBlock, saveOverviewLayout, type OverviewLayout, type OverviewZoneId } from './overviewLayout'

/** The picked-up block grows a little and casts a shadow (feedback); the others slide out of its way. */
const LIFT_SCALE = 1.02
const REFLOW_MS = 240
const SETTLE_MS = 200
/** A press turns into a drag only after this many pixels: a click on the block stays a click. */
const DRAG_THRESHOLD = 4
/** Near the window's top or bottom edge the page scrolls by itself while a block is carried. */
const EDGE = 72
const EDGE_SPEED = 16

interface Box { x: number; y: number; w: number; h: number }

interface Drag {
  id: string
  zone: OverviewZoneId
  pointerId: number
  startX: number
  startY: number
  /** The pointer's place inside the block when it was picked up. */
  grabX: number
  grabY: number
  clientX: number
  clientY: number
  started: boolean
  /** The block's own place in the layout (page coordinates), without the drag transform. */
  home: Box
  /** Every block of the zone, page coordinates, as laid out after the last move. */
  slots: Map<string, Box>
  /** The zone's order before the drag: Esc puts it back. */
  origin: string[]
  frame: number
}

const pageBox = (element: HTMLElement): Box => {
  const rect = element.getBoundingClientRect()
  return { x: rect.left + window.scrollX, y: rect.top + window.scrollY, w: rect.width, h: rect.height }
}

/** Where an element is laid out, ignoring the transform it carries now. */
function layoutBox(element: HTMLElement): Box {
  const transform = element.style.transform
  element.style.transform = 'none'
  const box = pageBox(element)
  element.style.transform = transform
  return box
}

const topInset = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar')) || 68

/** The element's running animations (none where the Web Animations API is missing, as in jsdom). */
const animationsOf = (element: Element) => (typeof element.getAnimations === 'function' ? element.getAnimations() : [])

/** Where the blocks of `zones` are on screen now (the «first» of FLIP). */
function captureRects(elements: Map<string, HTMLElement>, layout: OverviewLayout, zones: OverviewZoneId[]) {
  const before = new Map<string, DOMRect>()
  for (const zone of zones) for (const id of layout[zone]) {
    const element = elements.get(id)
    if (element) before.set(id, element.getBoundingClientRect())
  }
  return before
}

/**
 * «Настроить блоки» on the Overview (src/overview/overviewLayout.ts has the zones): pick a block up with the mouse,
 * carry it, and the blocks of its zone slide out of the way (FLIP with WAAPI, 240 ms on the strong ease-in-out); let
 * it go and it settles into its place (200 ms ease-out). Arrow keys move a focused block one place. Esc puts the
 * carried block back, or leaves the editing mode.
 */
export function useOverviewEditor() {
  const [layout, setLayout] = useState<OverviewLayout>(() => loadOverviewLayout())
  const [editing, setEditing] = useState(false)
  const [lifted, setLifted] = useState<string | null>(null)
  const elements = useRef(new Map<string, HTMLElement>())
  const layoutRef = useRef(layout)
  /** Where the blocks of the changed zones were on screen just before a move (the «first» of FLIP). */
  const pending = useRef<{ zones: OverviewZoneId[]; before: Map<string, DOMRect> } | null>(null)
  const drag = useRef<Drag | null>(null)

  useEffect(() => saveOverviewLayout(layout), [layout])

  /** OverviewBlock registers its element from a layout effect (and removes it when it goes). */
  const register = useCallback((id: string, element: HTMLElement | null) => {
    if (element) elements.current.set(id, element)
    else elements.current.delete(id)
  }, [])

  const measureSlots = useCallback((d: Drag) => {
    d.slots = new Map()
    for (const id of layoutRef.current[d.zone]) {
      const element = elements.current.get(id)
      if (element) d.slots.set(id, id === d.id ? layoutBox(element) : pageBox(element))
    }
    d.home = d.slots.get(d.id) ?? d.home
  }, [])

  /** The carried block under the pointer, wherever its place in the layout is now. */
  const follow = useCallback((d: Drag) => {
    const element = elements.current.get(d.id)
    if (!element) return
    const x = d.clientX + window.scrollX - d.grabX - d.home.x
    const y = d.clientY + window.scrollY - d.grabY - d.home.y
    element.style.transform = `translate(${x}px, ${y}px)${canAnimate() ? ` scale(${LIFT_SCALE})` : ''}`
  }, [])

  const apply = useCallback((next: OverviewLayout, zones: OverviewZoneId[]) => {
    if (next === layoutRef.current) return
    pending.current = { zones, before: captureRects(elements.current, layoutRef.current, zones) }
    layoutRef.current = next
    setLayout(next)
  }, [])

  const reorder = useCallback((zone: OverviewZoneId, id: string, toIndex: number) => {
    apply(moveBlock(layoutRef.current, zone, id, toIndex), [zone])
  }, [apply])

  // FLIP: every block of the changed zones slides from where it was on screen to its new place.
  useLayoutEffect(() => {
    layoutRef.current = layout
    const flip = pending.current
    if (!flip) return
    pending.current = null
    const carried = drag.current?.started ? drag.current.id : null
    const moves: Array<[HTMLElement, number, number]> = []
    for (const zone of flip.zones) for (const id of layout[zone]) {
      const element = elements.current.get(id)
      const before = flip.before.get(id)
      if (!element || !before || id === carried) continue
      for (const animation of animationsOf(element)) animation.cancel()
      const after = element.getBoundingClientRect()
      moves.push([element, before.left - after.left, before.top - after.top])
    }
    const d = drag.current
    if (d?.started) measureSlots(d)
    if (canAnimate()) {
      for (const [element, dx, dy] of moves) {
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
        element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: REFLOW_MS, easing: EASE_IN_OUT })
      }
    }
    if (d?.started) follow(d)
  }, [layout, follow, measureSlots])

  /**
   * The zone place the carried block is over now. The cards of the top row: the nearest one. A column: the carried
   * block passes another one when its leading edge crosses that one's middle (its top going up, its bottom going down),
   * so a tall block is not carried half its height past a short one before the column makes room.
   */
  const retarget = useCallback((d: Drag) => {
    const order = layoutRef.current[d.zone]
    const top = d.clientY + window.scrollY - d.grabY
    const left = d.clientX + window.scrollX - d.grabX
    const current = order.indexOf(d.id)
    let index = current
    if (d.zone === 'stats') {
      let best = Infinity
      order.forEach((id, i) => {
        const slot = d.slots.get(id)
        if (!slot) return
        const distance = Math.hypot(slot.x + slot.w / 2 - left - d.home.w / 2, slot.y + slot.h / 2 - top - d.home.h / 2)
        if (distance < best) { best = distance; index = i }
      })
    } else {
      index = order.filter((id, i) => {
        if (id === d.id) return false
        const slot = d.slots.get(id)
        if (!slot) return i < current
        const middle = slot.y + slot.h / 2
        return i < current ? top >= middle : top + d.home.h > middle
      }).length
    }
    if (index !== current) reorder(d.zone, d.id, index)
  }, [reorder])

  const autoScroll = useCallback((d: Drag) => {
    const step = () => {
      if (drag.current !== d) return
      const top = topInset()
      let speed = 0
      if (d.clientY < top + EDGE) speed = -EDGE_SPEED * Math.min(1, (top + EDGE - d.clientY) / EDGE)
      else if (d.clientY > window.innerHeight - EDGE) speed = EDGE_SPEED * Math.min(1, (d.clientY - window.innerHeight + EDGE) / EDGE)
      if (speed) {
        const before = window.scrollY
        window.scrollBy(0, speed)
        if (window.scrollY !== before) { follow(d); retarget(d) }
      }
      d.frame = requestAnimationFrame(step)
    }
    d.frame = requestAnimationFrame(step)
  }, [follow, retarget])

  /** Let go: the block settles into its place; `restore` (Esc) first puts the zone back in its old order. */
  const finish = useCallback((restore: boolean) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    cancelAnimationFrame(d.frame)
    const element = elements.current.get(d.id)
    if (!d.started || !element) return
    if (restore && d.origin.join() !== layoutRef.current[d.zone].join()) {
      // Every block of the zone, the carried one too, slides home from where it is on screen.
      pending.current = { zones: [d.zone], before: captureRects(elements.current, layoutRef.current, [d.zone]) }
      element.style.transform = ''
      element.style.transformOrigin = ''
      element.style.zIndex = ''
      const restored = { ...layoutRef.current, [d.zone]: d.origin }
      layoutRef.current = restored
      setLayout(restored)
      setLifted(null)
      return
    }
    const from = element.style.transform
    element.style.transform = ''
    setLifted(null)
    if (!canAnimate()) {
      element.style.transformOrigin = ''
      element.style.zIndex = ''
      return
    }
    const settle = element.animate([{ transform: from }, { transform: 'none' }], { duration: SETTLE_MS, easing: EASE_OUT })
    const done = () => { element.style.transformOrigin = ''; element.style.zIndex = '' }
    settle.onfinish = done
    settle.oncancel = done
  }, [])

  const handlers = useCallback((zone: OverviewZoneId, id: string) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || drag.current || FIXED_BLOCKS.has(id)) return
      const element = elements.current.get(id)
      if (!element) return
      for (const animation of animationsOf(element)) animation.finish()
      const rect = element.getBoundingClientRect()
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
      drag.current = {
        id, zone, pointerId: event.pointerId,
        startX: event.clientX, startY: event.clientY, clientX: event.clientX, clientY: event.clientY,
        grabX: event.clientX - rect.left, grabY: event.clientY - rect.top,
        started: false, home: pageBox(element), slots: new Map(), origin: [...layoutRef.current[zone]], frame: 0,
      }
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const d = drag.current
      if (!d || d.id !== id || event.pointerId !== d.pointerId) return
      d.clientX = event.clientX
      d.clientY = event.clientY
      if (!d.started) {
        if (Math.hypot(event.clientX - d.startX, event.clientY - d.startY) < DRAG_THRESHOLD) return
        d.started = true
        const element = elements.current.get(id)
        if (element) {
          element.style.transformOrigin = `${d.grabX}px ${d.grabY}px`
          element.style.zIndex = '30'
        }
        measureSlots(d)
        setLifted(id)
        autoScroll(d)
      }
      follow(d)
      retarget(d)
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => { if (drag.current?.pointerId === event.pointerId) finish(false) },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => { if (drag.current?.pointerId === event.pointerId) finish(false) },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      const step = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : 0
      if (!step || drag.current) return
      event.preventDefault()
      const order = layoutRef.current[zone]
      reorder(zone, id, order.indexOf(id) + step)
    },
  }), [autoScroll, finish, follow, measureSlots, reorder, retarget])

  // Esc: a carried block goes back; otherwise the editing mode ends.
  useEffect(() => {
    if (!editing) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (drag.current) finish(true)
      else setEditing(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, finish])

  // Leaving the editing mode (or the page) drops whatever is being carried.
  useEffect(() => () => finish(false), [editing, finish])

  const reset = useCallback(() => apply(defaultOverviewLayout(), ['stats', 'rows', 'left', 'right']), [apply])

  return useMemo(() => ({
    layout,
    editing,
    lifted,
    isDefault: isDefaultLayout(layout),
    toggleEditing: () => setEditing((value) => !value),
    reset,
    register,
    handlers,
  }), [editing, handlers, layout, lifted, register, reset])
}

export type OverviewEditor = ReturnType<typeof useOverviewEditor>
