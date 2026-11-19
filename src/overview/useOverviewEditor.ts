import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { EASE_IN_OUT, EASE_OUT, canAnimate } from '../shared/motion'
import { loadOverviewLayout, saveOverviewLayout } from './overviewLayout'
import { completeFree, freeFromZones, GRID, isCard, loadFreeLayout, moveFree, packFree, packedHeight, removeFree, sameFree, saveFreeLayout, SINGLE_BELOW, SNAP, snapX, type FreeLayout, type FreePlace } from './overviewFreeLayout'
import { baseOverviewLayout, withoutHiddenBlocks } from './overviewDefaults'
import { useOverviewDefaults } from './overviewDefaultsStore'

/** Between blocks, as the Overview always had. */
const GAP = 14
/** The picked-up block grows a little and casts a shadow (feedback); the others slide out of its way. */
const LIFT_SCALE = 1.02
const REFLOW_MS = 240
const SETTLE_MS = 200
/** A press turns into a drag only after this many pixels: a click on the block stays a click. */
const DRAG_THRESHOLD = 4
/** Near the window's top or bottom edge the page scrolls by itself while a block is carried. */
const EDGE = 72
const EDGE_SPEED = 16
const NONE: readonly string[] = []

interface Box { x: number; y: number; w: number; h: number }

interface Drag {
  id: string
  pointerId: number
  startX: number
  startY: number
  /** The pointer's place inside the block when it was picked up. */
  grabX: number
  grabY: number
  clientX: number
  clientY: number
  started: boolean
  /** The layout before the drag: Esc puts it back. */
  origin: FreeLayout
  frame: number
  /** What the pointer was captured on. */
  handle: HTMLElement
  /** Takes the window's listeners off. */
  unlisten: () => void
}

const topInset = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar')) || 68

/** The element's running animations (none where the Web Animations API is missing, as in jsdom). */
const animationsOf = (element: Element) => (typeof element.getAnimations === 'function' ? element.getAnimations() : [])

/**
 * «Настроить блоки» on the PC Overview, laid out freely (overviewFreeLayout.ts; owner, 20.11.2026: «все блоки можно перемешать и
 * передвигать как нужно… остальные блоки сдвинутся вниз, которые мешают»). Pick a block up with the mouse and carry it anywhere:
 * over the column it is carried to, it goes above the blocks whose middle it passes, and those it would cover slide down (FLIP with
 * WAAPI, 240 ms on the strong ease-in-out); let it go and it settles (200 ms ease-out). Arrows: up and down past the next block of
 * its columns, left and right by three columns. Esc puts the carried block back, or leaves the editing mode.
 */
export function useOverviewEditor() {
  // «Админ панель» → «Блоки»: the owner's order and hidden blocks for everybody (overviewDefaults.ts), followed live until the
  // player arranges the blocks themselves; hidden blocks stay hidden either way.
  const defaults = useOverviewDefaults()
  const baseZones = useMemo(() => baseOverviewLayout(defaults), [defaults])
  const hidden = defaults?.hidden ?? NONE
  const base = useMemo(() => {
    const zones = freeFromZones(baseZones)
    return completeFree(zones, hidden, zones)
  }, [baseZones, hidden])
  /** The player's own free layout; else their old zones' order (it kept winning over the owner's), else the owner's default. */
  const startOf = useCallback(() => {
    const own = loadFreeLayout(base)
    return completeFree(own ?? freeFromZones(withoutHiddenBlocks(loadOverviewLayout(undefined, baseZones), hidden)), hidden, base)
  }, [base, baseZones, hidden])
  const [layout, setLayout] = useState<FreeLayout>(startOf)
  const [editing, setEditing] = useState(false)
  const [lifted, setLifted] = useState<string | null>(null)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [width, setWidth] = useState(0)
  const [, setTick] = useState(0)
  const elements = useRef(new Map<string, HTMLElement>())
  const container = useRef<HTMLElement | null>(null)
  const layoutRef = useRef(layout)
  /** Where the blocks were on screen just before a move (the «first» of FLIP). */
  const pending = useRef<Map<string, DOMRect> | null>(null)
  const drag = useRef<Drag | null>(null)
  /** The player moved or took off a block: their layout is kept from then on. */
  const touched = useRef(false)

  const single = width < SINGLE_BELOW
  const places = useMemo(() => packFree(layout, (id) => heights[id] ?? 0, GAP, single), [heights, layout, single])
  const placesRef = useRef(places)
  const unit = (width + GAP) / GRID

  useEffect(() => {
    if (!touched.current) return
    saveFreeLayout(sameFree(layout, base) ? null : layout)
  }, [base, layout])

  // The owner changed the defaults: a player without an own layout gets the new one at once (not in the middle of an edit).
  useEffect(() => {
    if (editing) return
    const next = startOf()
    if (sameFree(next, layoutRef.current)) return
    layoutRef.current = next
    setLayout(next)
  }, [editing, startOf])

  // Sizes: the blocks' heights and the Overview's width, measured after every render; the observer brings a render when content
  // grows or shrinks by itself (a list loaded, a picture come).
  const observer = useRef<ResizeObserver | null>(null)
  const frame = useRef(0)
  const observe = useCallback((element: HTMLElement, on: boolean) => {
    if (typeof ResizeObserver === 'undefined') return
    observer.current ??= new ResizeObserver(() => {
      if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; setTick((value) => value + 1) })
    })
    if (on) observer.current.observe(element)
    else observer.current.unobserve(element)
  }, [])
  useEffect(() => () => { observer.current?.disconnect(); cancelAnimationFrame(frame.current) }, [])
  // After every render on purpose: a block's height follows its content; state is set only when a size really changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    let changed = Object.keys(heights).length !== elements.current.size
    const next: Record<string, number> = {}
    for (const [id, element] of elements.current) {
      // a card's own height, without the row's (styleOf stretches it to the tallest card beside it)
      const stretched = element.style.minHeight
      if (stretched) element.style.minHeight = ''
      next[id] = element.offsetHeight
      if (stretched) element.style.minHeight = stretched
      if (Math.abs((heights[id] ?? -1) - next[id]) > 0.5) changed = true
    }
    if (changed) setHeights(next)
    const now = container.current?.clientWidth ?? 0
    if (Math.abs(now - width) > 0.5) setWidth(now)
  })

  /** OverviewBlock registers its element from a layout effect (and removes it when it goes). */
  const register = useCallback((id: string, element: HTMLElement | null) => {
    const known = elements.current.get(id)
    if (known && known !== element) observe(known, false)
    if (element) { elements.current.set(id, element); observe(element, true) } else elements.current.delete(id)
  }, [observe])

  const setContainer = useCallback((element: HTMLElement | null) => {
    if (container.current) observe(container.current, false)
    container.current = element
    if (element) observe(element, true)
  }, [observe])

  /** A block's place in page coordinates, as laid out now (without the drag transform). */
  const pageBoxOf = useCallback((place: FreePlace): Box => {
    const rect = container.current?.getBoundingClientRect()
    const left = (rect?.left ?? 0) + window.scrollX
    const top = (rect?.top ?? 0) + window.scrollY
    const step = ((container.current?.clientWidth ?? 0) + GAP) / GRID
    return { x: left + place.x * step, y: top + place.y, w: place.w * step - GAP, h: place.h }
  }, [])

  /** The carried block under the pointer, wherever its place in the layout is now. */
  const follow = useCallback((d: Drag) => {
    const element = elements.current.get(d.id)
    const place = placesRef.current.find((each) => each.id === d.id)
    if (!element || !place) return
    const home = pageBoxOf(place)
    const x = d.clientX + window.scrollX - d.grabX - home.x
    const y = d.clientY + window.scrollY - d.grabY - home.y
    element.style.transform = `translate(${x}px, ${y}px)${canAnimate() ? ` scale(${LIFT_SCALE})` : ''}`
  }, [pageBoxOf])

  const apply = useCallback((next: FreeLayout) => {
    if (next === layoutRef.current) return
    const before = new Map<string, DOMRect>()
    for (const [id, element] of elements.current) before.set(id, element.getBoundingClientRect())
    pending.current = before
    touched.current = true
    layoutRef.current = next
    setLayout(next)
  }, [])

  // FLIP: every block slides from where it was on screen to its new place.
  useLayoutEffect(() => {
    layoutRef.current = layout
    placesRef.current = places
    const flip = pending.current
    const d = drag.current
    if (d?.started) {
      // Moving an element in the page takes the pointer capture off it: taken again, or the pointer's way out of the window is lost.
      try { if (d.handle.isConnected) d.handle.setPointerCapture?.(d.pointerId) } catch { /* the pointer is gone: its up ends the drag */ }
      follow(d)
    }
    if (!flip) return
    pending.current = null
    if (!canAnimate()) return
    const carried = d?.started ? d.id : null
    for (const [id, element] of elements.current) {
      const before = flip.get(id)
      if (!before || id === carried) continue
      for (const animation of animationsOf(element)) animation.cancel()
      const after = element.getBoundingClientRect()
      const dx = before.left - after.left
      const dy = before.top - after.top
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
      element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: REFLOW_MS, easing: EASE_IN_OUT })
    }
  }, [follow, layout, places])

  /** The columns a block overlaps at column `x`. */
  const overlaps = (place: FreePlace, x: number, w: number) => place.x < x + w && x < place.x + place.w

  /**
   * Where the carried block goes: the column under its left edge (every third), and among the blocks of those columns, above each
   * one whose middle its top passes going up, below each one whose middle its bottom passes going down (so a tall block is not
   * carried half its height past a short one before they trade places). Blocks of other columns keep their places.
   */
  const retarget = useCallback((d: Drag) => {
    const now = layoutRef.current
    const placed = placesRef.current
    const own = placed.find((place) => place.id === d.id)
    if (!own) return
    const rect = container.current?.getBoundingClientRect()
    const step = ((container.current?.clientWidth ?? 0) + GAP) / GRID
    const left = d.clientX - d.grabX - (rect?.left ?? 0)
    const top = d.clientY - d.grabY - (rect?.top ?? 0)
    const x = single || !step ? now.x[d.id] ?? 0 : snapX(left / step, own.w, isCard(d.id))
    const w = own.w
    const others = now.order.filter((id) => id !== d.id)
    const current = now.order.indexOf(d.id)
    const near = placed.filter((place) => place.id !== d.id && place.h > 0 && (single || overlaps(place, x, w)))
    const above = near.filter((place) => {
      const middle = place.y + place.h / 2
      return now.order.indexOf(place.id) < current ? top >= middle : top + own.h > middle
    })
    const last = above.at(-1)
    const index = last ? others.indexOf(last.id) + 1 : near.length ? others.indexOf(near[0]!.id) : current
    apply(moveFree(now, d.id, index, x))
  }, [apply, single])

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

  /** Let go: the block settles into its place; `restore` (Esc) first puts the layout back as it was. */
  const finish = useCallback((restore: boolean) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    d.unlisten()
    cancelAnimationFrame(d.frame)
    const element = elements.current.get(d.id)
    if (!d.started || !element) return
    if (restore && !sameFree(d.origin, layoutRef.current)) {
      element.style.transform = ''
      element.style.transformOrigin = ''
      element.style.zIndex = ''
      apply(d.origin)
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
  }, [apply])

  /** The pointer moved while a block is held. */
  const carry = useCallback((d: Drag, clientX: number, clientY: number) => {
    d.clientX = clientX
    d.clientY = clientY
    if (!d.started) {
      if (Math.hypot(clientX - d.startX, clientY - d.startY) < DRAG_THRESHOLD) return
      d.started = true
      const element = elements.current.get(d.id)
      if (element) {
        element.style.transformOrigin = `${d.grabX}px ${d.grabY}px`
        element.style.zIndex = '30'
      }
      setLifted(d.id)
      autoScroll(d)
    }
    follow(d)
    retarget(d)
  }, [autoScroll, follow, retarget])

  /** Up and down past the next block of its columns; left and right by three columns. */
  const nudge = useCallback((id: string, key: string) => {
    const now = layoutRef.current
    const own = placesRef.current.find((place) => place.id === id)
    if (!own) return false
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if (single) return false
      const step = isCard(id) ? own.w : SNAP
      apply(moveFree(now, id, now.order.indexOf(id), (now.x[id] ?? 0) + (key === 'ArrowLeft' ? -step : step)))
      return true
    }
    if (key !== 'ArrowUp' && key !== 'ArrowDown') return false
    const others = now.order.filter((other) => other !== id)
    // the blocks of its columns from the top (laid in order where they stand as high)
    const rank = (place: FreePlace) => [place.y, now.order.indexOf(place.id)] as const
    const earlier = (a: FreePlace, b: FreePlace) => rank(a)[0] < rank(b)[0] - 0.5 || (Math.abs(rank(a)[0] - rank(b)[0]) <= 0.5 && rank(a)[1] < rank(b)[1])
    const near = placesRef.current.filter((place) => place.id !== id && (single || overlaps(place, own.x, own.w)))
    const passed = key === 'ArrowUp'
      ? near.filter((place) => earlier(place, own)).sort((a, b) => (earlier(a, b) ? 1 : -1))[0]
      : near.filter((place) => earlier(own, place)).sort((a, b) => (earlier(a, b) ? -1 : 1))[0]
    if (passed) apply(moveFree(now, id, others.indexOf(passed.id) + (key === 'ArrowUp' ? 0 : 1), own.x))
    return true
  }, [apply, single])

  const handlers = useCallback((id: string) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || drag.current) return
      const element = elements.current.get(id)
      if (!element) return
      for (const animation of animationsOf(element)) animation.finish()
      const rect = element.getBoundingClientRect()
      const handle = event.currentTarget
      handle.setPointerCapture(event.pointerId)
      event.preventDefault()
      const pointerId = event.pointerId
      // On the window, not on the block: a block moved in the page loses the capture (owner, 07.11.2026: «он зависает»).
      const onMove = (moved: globalThis.PointerEvent) => { if (moved.pointerId === pointerId && drag.current?.handle === handle) carry(drag.current, moved.clientX, moved.clientY) }
      const onEnd = (ended: globalThis.PointerEvent) => { if (ended.pointerId === pointerId && drag.current?.handle === handle) finish(false) }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onEnd)
      window.addEventListener('pointercancel', onEnd)
      drag.current = {
        handle,
        unlisten: () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onEnd)
          window.removeEventListener('pointercancel', onEnd)
        },
        id, pointerId,
        startX: event.clientX, startY: event.clientY, clientX: event.clientX, clientY: event.clientY,
        grabX: event.clientX - rect.left, grabY: event.clientY - rect.top,
        started: false, origin: layoutRef.current, frame: 0,
      }
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (drag.current) return
      if (nudge(id, event.key)) event.preventDefault()
    },
  }), [carry, finish, nudge])

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

  // The cross on a block: it goes off the Overview, the blocks under it come up.
  const remove = useCallback((id: string) => apply(removeFree(layoutRef.current, id)), [apply])

  // «Сбросить»: back to the starting layout (the owner's default for everybody, or the built-in one), removed blocks back too; the old
  // zones' order goes with it.
  const reset = useCallback(() => {
    saveOverviewLayout(baseZones, undefined, baseZones)
    apply(base)
  }, [apply, base, baseZones])

  /** A block's place on the grid: its left, top and width. */
  const styleOf = useCallback((id: string): CSSProperties | undefined => {
    const place = places.find((each) => each.id === id)
    if (!place) return undefined
    const own = heights[id] ?? 0
    return { left: place.x * unit, top: place.y, width: Math.max(0, place.w * unit - GAP), ...(place.h > own + 0.5 ? { minHeight: place.h } : {}) }
  }, [heights, places, unit])

  return useMemo(() => ({
    layout,
    places,
    height: packedHeight(places),
    single,
    editing,
    lifted,
    isDefault: sameFree(layout, base),
    toggleEditing: () => setEditing((value) => !value),
    reset,
    remove,
    register,
    container: setContainer,
    styleOf,
    handlers,
  }), [base, editing, handlers, layout, lifted, places, register, remove, reset, setContainer, single, styleOf])
}

export type OverviewEditor = ReturnType<typeof useOverviewEditor>
